/**
 * Star catalog runtime loader.
 *
 * Bright bins load once at startup. Faint sliced bins (HEALPix nside=8 RING)
 * stream in only for the tiles that overlap the current view, and are evicted
 * (LRU) when the field of view widens again.
 */
import * as THREE from 'three';
import { makeStarPoints, StarMaterial } from '../render/starfield';
import { pixCenterVec, healpixNpix } from '../astro/healpix';
import type { Mat3, Vec3 } from '../astro/types';

const NSIDE = 8;
const TILE_MARGIN_DEG = 8; // tiles slightly larger than the view disk
const MAX_TILES_PER_BIN = 48;

interface BinDef {
  key: string;
  lo: number | null;
  hi: number | null;
  allSky: boolean;
  stars: number;
}

export interface CatalogManifest {
  generated: string;
  bins: BinDef[];
  totalStars: number;
}

interface LoadedTile {
  key: string;
  points: THREE.Points;
  lastUsed: number;
}

export class StarCatalog {
  manifest: CatalogManifest | null = null;
  material = new StarMaterial();
  private root: THREE.Group = new THREE.Group();
  private loaded = new Map<string, LoadedTile>();
  private inflight = new Set<string>();
  private useCounter = 0;
  private allSkyLoaded = new Set<string>();
  onLoaded: (() => void) | null = null;

  get group(): THREE.Group {
    return this.root;
  }

  async init(): Promise<void> {
    const res = await fetch('/data/index.json');
    this.manifest = (await res.json()) as CatalogManifest;
    const allSky = this.manifest.bins.filter((b) => b.allSky);
    await Promise.all(allSky.map((b) => this.loadTile(b.key, null)));
    this.updateLimit();
  }

  private async loadTile(binKey: string, pix: number | null): Promise<void> {
    const name = pix === null ? binKey : `${binKey}/${String(pix).padStart(4, '0')}`;
    if (this.loaded.has(name) || this.inflight.has(name)) return;
    this.inflight.add(name);
    try {
      const [binRes, idsRes] = await Promise.all([
        fetch(`/data/${name}.bin`),
        fetch(`/data/${name}.ids`),
      ]);
      if (!binRes.ok) return;
      const binBuf = await binRes.arrayBuffer();
      void idsRes; // ids fetched eagerly so they are warm in the HTTP cache for picking
      const points = makeStarPoints(binBuf, this.material, name);
      points.renderOrder = 10;
      this.root.add(points);
      this.loaded.set(name, { key: name, points, lastUsed: ++this.useCounter });
      this.updateLimit();
      this.onLoaded?.();
    } catch {
      // Network hiccup: tile simply stays missing; view still works.
    } finally {
      this.inflight.delete(name);
    }
  }

  /**
   * Ensure the tiles covering the view disk (center in the horizontal frame)
   * are loaded, using the EQJ->HOR rotation to test overlap on the sphere.
   */
  ensureVisible(centerHor: Vec3, fovDeg: number, rotEqjToHor: Mat3): void {
    if (!this.manifest) return;
    const sliced = this.manifest.bins.filter((b) => !b.allSky);
    for (const bin of sliced) {
      // Narrower bins require narrower fields of view.
      const hi = bin.hi ?? 15;
      const lo = bin.lo ?? 0;
      const binMid = (hi + lo) / 2;
      const maxFov = bin.key.endsWith('3') ? 30 : 8;
      if (fovDeg > maxFov) continue;
      void binMid;
      const radiusDeg = fovDeg / 2 + TILE_MARGIN_DEG;
      const cosR = Math.cos((radiusDeg * Math.PI) / 180);
      // View center back into J2000 frame: v_eqj = R^T * v_hor.
      const m = rotEqjToHor;
      const centerEqj: Vec3 = [
        m[0]! * centerHor[0] + m[3]! * centerHor[1] + m[6]! * centerHor[2],
        m[1]! * centerHor[0] + m[4]! * centerHor[1] + m[7]! * centerHor[2],
        m[2]! * centerHor[0] + m[5]! * centerHor[1] + m[8]! * centerHor[2],
      ];
      const npix = healpixNpix(NSIDE);
      let loading = 0;
      for (let pix = 0; pix < npix; pix++) {
        const c = pixCenterVec(NSIDE, pix);
        const d =
          c[0] * centerEqj[0] + c[1] * centerEqj[1] + c[2] * centerEqj[2];
        if (d > cosR) {
          const name = `${bin.key}/${String(pix).padStart(4, '0')}`;
          const hit = this.loaded.get(name);
          if (hit) {
            hit.lastUsed = ++this.useCounter;
          } else if (loading < 12) {
            loading++;
            void this.loadTile(bin.key, pix);
          }
        }
      }
    }
    this.evict();
  }

  private evict(): void {
    for (const bin of this.manifest?.bins ?? []) {
      if (bin.allSky) continue;
      const tiles = [...this.loaded.values()].filter((t) =>
        t.key.startsWith(bin.key + '/'),
      );
      const maxFov = bin.key.endsWith('3') ? 30 : 8;
      // Eviction happens indirectly: when the FOV is wide, tiles stop being
      // touched; drop the stalest beyond the cap.
      const excess = tiles.length - MAX_TILES_PER_BIN;
      if (excess > 0) {
        tiles.sort((a, b) => a.lastUsed - b.lastUsed);
        for (const tile of tiles.slice(0, excess)) {
          this.root.remove(tile.points);
          tile.points.geometry.dispose();
          this.loaded.delete(tile.key);
        }
      }
      void maxFov;
    }
  }

  private updateLimit(): void {
    let limit = 6.5;
    for (const name of this.loaded.keys()) {
      const bin = name.split('/')[0]!;
      const def = this.manifest?.bins.find((b) => b.key === bin);
      if (def?.hi != null) limit = Math.max(limit, def.hi);
      else if (def) limit = Math.max(limit, 15);
    }
    this.material.setBinLimit(limit);
  }

  /**
   * Find the loaded star nearest to a J2000 direction, within a tolerance in
   * degrees. Used by click-picking.
   */
  *starsWithin(): Generator<{ points: THREE.Points; name: string }> {
    for (const tile of this.loaded.values()) {
      yield { points: tile.points, name: tile.key };
    }
  }

  get loadedCount(): number {
    return this.loaded.size;
  }
}
