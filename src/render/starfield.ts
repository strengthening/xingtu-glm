/**
 * 星点渲染：分档加载（全天档整体 + 暗档 HEALPix 视野切片）与 Points 绘制。
 *
 * 二进制布局见 scripts/build-stars.ts：
 *   [uint32 N][float32×7×N: x,y,z,V,BV,pmRA,pmDE][uint32×N: TYC 编码]
 * GPU 侧用 InterleavedBuffer 直接消费交错数据，不做 CPU 拷贝重排；
 * ids（TYC）留在 CPU 供点选信息卡使用。
 */
import * as THREE from 'three';
import type { Vec3 } from '../astro/types';
import { maxPixRadDeg, pixNestToRadec } from '../astro/healpix';
import type { NamedStar } from './labels';
import { STAR_FRAG, STAR_VERT } from './shaders';

const BASE = import.meta.env.BASE_URL ?? '/';

export interface TierInfo {
  id: string;
  minMag: number;
  maxMag: number;
  healpix: boolean;
}

interface LoadedTile {
  points: THREE.Points;
  ids: Uint32Array;
  lastUse: number;
}

export interface StarPickSource {
  /** 遍历当前已加载可见星（供拾取与星名解析）。 */
  forEach(
    cb: (
      x: number,
      y: number,
      z: number,
      mag: number,
      bv: number,
      pmRa: number,
      pmDec: number,
      tyc: number,
    ) => void,
  ): void;
}

/** 单档星数上限的切片缓存容量（按块数）。 */
const MAX_TILES = 110;

export class Starfield {
  readonly tierDefs: TierInfo[];
  readonly nside: number;
  /** 共享 uniforms（由外部每帧更新矩阵等）。 */
  readonly uniforms: Record<string, THREE.IUniform>;

  private scene: THREE.Scene;
  private whole = new Map<string, { points: THREE.Points; ids: Uint32Array }>();
  private tiles = new Map<string, LoadedTile>();
  private pending = new Set<string>();
  private fetchQueue: string[] = [];
  private activeFetches = 0;
  private centerEqj: Vec3 = { x: 1, y: 0, z: 0 };
  private fovY = 100;
  /** 各档是否启用（由 FOV 决定）。 */
  private tierVisible: boolean[] = [];
  onTilesLoaded?: () => void;

  private constructor(
    scene: THREE.Scene,
    uniforms: Record<string, THREE.IUniform>,
    tierDefs: TierInfo[],
    nside: number,
  ) {
    this.scene = scene;
    this.uniforms = uniforms;
    this.tierDefs = tierDefs;
    this.nside = nside;
    this.tierVisible = tierDefs.map(() => false);
  }

  /** 拉取 meta.json 与全天档。失败（如数据未生成）时返回 null。 */
  static async create(
    scene: THREE.Scene,
    uniforms: Record<string, THREE.IUniform>,
  ): Promise<Starfield | null> {
    const res = await fetch(`${BASE}data/stars/meta.json`);
    if (!res.ok) return null;
    const meta = (await res.json()) as {
      nside: number;
      tiers: TierInfo[];
    };
    const sf = new Starfield(scene, uniforms, meta.tiers, meta.nside);
    for (const tier of meta.tiers.filter((t) => !t.healpix)) {
      const tile = await sf.loadTile(tier.id, null);
      if (tile) {
        scene.add(tile.points);
        sf.whole.set(tier.id, tile);
      }
    }
    return sf;
  }

  private makeGeometry(ab: ArrayBuffer): { geometry: THREE.BufferGeometry; ids: Uint32Array } | null {
    const dv = new DataView(ab);
    const count = dv.getUint32(0, true);
    if (count === 0) return null;
    const floats = new Float32Array(ab, 4, count * 7);
    const ids = new Uint32Array(ab, 4 + count * 28, count);
    const ib = new THREE.InterleavedBuffer(floats, 7);
    ib.setUsage(THREE.StaticDrawUsage);
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geometry.setAttribute('aMag', new THREE.InterleavedBufferAttribute(ib, 1, 3));
    geometry.setAttribute('aBv', new THREE.InterleavedBufferAttribute(ib, 1, 4));
    geometry.setAttribute('aPm', new THREE.InterleavedBufferAttribute(ib, 2, 5));
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    return { geometry, ids };
  }

  private async loadTile(tierId: string, pix: number | null) {
    const url =
      pix === null
        ? `${BASE}data/stars/${tierId}.bin`
        : `${BASE}data/stars/${tierId}/${String(pix).padStart(3, '0')}.bin`;
    const key = pix === null ? tierId : `${tierId}/${pix}`;
    if (this.pending.has(key) || this.tiles.has(key) || this.whole.has(tierId)) return null;
    this.pending.add(key);
    try {
      const res = await fetch(url);
      if (!res.ok) return null;
      const ab = await res.arrayBuffer();
      const made = this.makeGeometry(ab);
      if (!made) return null;
      const points = new THREE.Points(made.geometry, this.materialFor(tierId));
      points.frustumCulled = false;
      return { points, ids: made.ids };
    } catch {
      return null;
    } finally {
      this.pending.delete(key);
    }
  }

  private materials = new Map<string, THREE.ShaderMaterial>();

  private materialFor(tierId: string): THREE.ShaderMaterial {
    let m = this.materials.get(tierId);
    if (!m) {
      m = new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader: STAR_VERT,
        fragmentShader: STAR_FRAG,
        transparent: true,
        depthTest: false,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      this.materials.set(tierId, m);
    }
    return m;
  }

  /** 视角/视场更新：决定启用档位并按需加载视野内切片。 */
  update(centerEqj: Vec3, fovY: number): void {
    this.centerEqj = centerEqj;
    this.fovY = fovY;
    // 档位启用阈值（垂直视场，度）
    const thresholds: Record<string, number> = { t2: 55, t3: 22, t4: 8 };
    this.tierDefs.forEach((t, i) => {
      this.tierVisible[i] = t.healpix ? fovY < (thresholds[t.id] ?? 8) : true;
    });
    for (const [tierId, { points }] of this.whole) {
      points.visible = this.tierVisible[this.tierDefs.findIndex((t) => t.id === tierId)] ?? true;
    }
    const now = performance.now();
    const radiusDeg = (fovY * Math.SQRT2) / 2 + 12;
    const need = this.tilesInCone(centerEqj, radiusDeg);
    for (const t of this.tierDefs.filter((x) => x.healpix)) {
      const enabled = fovY < (thresholds[t.id] ?? 8);
      if (!enabled) continue;
      for (const pix of need) {
        const key = `${t.id}/${pix}`;
        const tile = this.tiles.get(key);
        if (tile) {
          tile.lastUse = now;
          continue;
        }
        this.enqueueTile(t.id, pix);
      }
    }
    // 切片可见性：档启用 且 像素在当前锥内
    const needSet = new Set(need);
    for (const [key, tile] of this.tiles) {
      const [tierId, pixStr] = key.split('/');
      const enabled = this.tierVisible[this.tierDefs.findIndex((t) => t.id === tierId)] ?? false;
      tile.points.visible = enabled && needSet.has(Number(pixStr));
    }
    this.evictLRU();
  }

  /** 视锥圆内的 HEALPix 像素（像素中心距 + 最大像素半径的粗判）。 */
  private tilesInCone(center: Vec3, radiusDeg: number): number[] {
    const out: number[] = [];
    const npix = 12 * this.nside * this.nside;
    const rad = maxPixRadDeg(this.nside);
    const limit = Math.cos(((radiusDeg + rad) * Math.PI) / 180);
    const centers = pixelCenters(this.nside);
    for (let p = 0; p < npix; p++) {
      const c = centers[p]!;
      if (c.x * center.x + c.y * center.y + c.z * center.z >= limit) out.push(p);
    }
    return out;
  }

  private enqueueTile(tierId: string, pix: number): void {
    const key = `${tierId}/${pix}`;
    if (this.pending.has(key) || this.tiles.has(key)) return;
    this.pending.add(key);
    this.fetchQueue.push(key);
    this.pumpQueue();
  }

  private pumpQueue(): void {
    while (this.activeFetches < 6 && this.fetchQueue.length > 0) {
      const key = this.fetchQueue.shift()!;
      this.activeFetches++;
      const [tierId, pixStr] = key.split('/');
      this.loadTile(tierId, Number(pixStr))
        .then((tile) => {
          if (tile) {
            tile.points.visible = true;
            this.scene.add(tile.points);
            this.tiles.set(key, { ...tile, lastUse: performance.now() });
            this.onTilesLoaded?.();
          }
        })
        .finally(() => {
          this.activeFetches--;
          this.pumpQueue();
        });
    }
  }

  private evictLRU(): void {
    if (this.tiles.size <= MAX_TILES) return;
    const entries = [...this.tiles.entries()].sort((a, b) => a[1].lastUse - b[1].lastUse);
    const evictCount = this.tiles.size - MAX_TILES;
    for (let i = 0; i < evictCount; i++) {
      const [key, tile] = entries[i]!;
      this.scene.remove(tile.points);
      tile.points.geometry.dispose();
      this.tiles.delete(key);
    }
  }

  /** 拾取数据源：遍历当前可见档的全部星。 */
  pickSource(): StarPickSource {
    const buffers: { floats: Float32Array; ids: Uint32Array }[] = [];
    for (const [tierId, w] of this.whole) {
      if (this.tierVisible[this.tierDefs.findIndex((t) => t.id === tierId)]) {
        buffers.push({ floats: starFloats(w.points), ids: w.ids });
      }
    }
    for (const [, tile] of this.tiles) {
      if (tile.points.visible) buffers.push({ floats: starFloats(tile.points), ids: tile.ids });
    }
    return {
      forEach(cb) {
        for (const { floats, ids } of buffers) {
          const n = ids.length;
          for (let i = 0; i < n; i++) {
            cb(
              floats[i * 7]!,
              floats[i * 7 + 1]!,
              floats[i * 7 + 2]!,
              floats[i * 7 + 3]!,
              floats[i * 7 + 4]!,
              floats[i * 7 + 5]!,
              floats[i * 7 + 6]!,
              ids[i]!,
            );
          }
        }
      },
    };
  }

  /** 从全天档中解析有名字的星（TYC 字符串 → NamedStar，供标签层）。 */
  resolveNamedStars(names: Record<string, { en?: string; zh?: string }>): NamedStar[] {
    const out: NamedStar[] = [];
    for (const w of this.whole.values()) {
      const floats = starFloats(w.points);
      for (let i = 0; i < w.ids.length; i++) {
        const tyc = w.ids[i]!;
        const key = `${tyc >>> 17}-${(tyc >>> 3) & 0x3fff}-${tyc & 7}`;
        const n = names[key];
        if (!n) continue;
        const name = n.zh ?? n.en;
        if (!name) continue;
        out.push({
          x: floats[i * 7]!,
          y: floats[i * 7 + 1]!,
          z: floats[i * 7 + 2]!,
          mag: floats[i * 7 + 3]!,
          name,
        });
      }
    }
    return out;
  }

  get loadedTileCount(): number {
    return this.tiles.size;
  }
}

function starFloats(points: THREE.Points): Float32Array {
  const attr = points.geometry.getAttribute('position') as THREE.InterleavedBufferAttribute;
  return attr.data.array as Float32Array;
}

/** 各 HEALPix 像素中心方向缓存（按 nside）。 */
const centerCache = new Map<number, { x: number; y: number; z: number }[]>();
function pixelCenters(nside: number): { x: number; y: number; z: number }[] {
  let arr = centerCache.get(nside);
  if (!arr) {
    arr = [];
    const npix = 12 * nside * nside;
    for (let p = 0; p < npix; p++) {
      const rd = pixNestToRadec(nside, p);
      const cd = Math.cos((rd.dec * Math.PI) / 180);
      arr.push({
        x: cd * Math.cos((rd.ra * Math.PI) / 180),
        y: cd * Math.sin((rd.ra * Math.PI) / 180),
        z: Math.sin((rd.dec * Math.PI) / 180),
      });
    }
    centerCache.set(nside, arr);
  }
  return arr;
}
