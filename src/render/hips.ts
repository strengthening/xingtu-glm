/**
 * HiPS all-sky survey background (the Milky Way panorama).
 *
 * Tiles come from the CDS HiPS server at alasky.cds.unistra.fr (Mellinger
 * all-sky color mosaic; credit Alex Mellinger — non-commercial use with
 * attribution, see README). Tiles are drawn as subdivided quads on the unit
 * sphere with the shared stereographic projection, so the background always
 * matches the star field exactly.
 *
 * Order levels 2/3/4 are switched by FOV: 2 covers wide fields (~19 MB at
 * order 3 for narrow), and only tiles overlapping the view disk are fetched.
 */
import * as THREE from 'three';
import { pixCornersVec, pixCenterVec } from '../astro/healpix';
import type { Mat3, Vec3 } from '../astro/types';
import type { SkyCamera } from './projection';
import { setCommonUniforms, threeUniformsFromCommon } from './starfield';
import type { SkyFrame } from '../astro/sky';

const HIPS_BASE = 'https://alasky.cds.unistra.fr/P/Mellinger';

const HIPS_VERTEX = /* glsl */ `
attribute vec2 uv2;
varying vec2 vUv;
${'' /* common uniforms injected below */}
uniform mat3 uRotEqjToHor;
uniform vec3 uBeta;
uniform float uYears;
uniform vec3 uCamCenter;
uniform vec3 uCamUp;
uniform vec3 uCamRight;
uniform float uScaleTan;
uniform float uAspect;

void main() {
  vUv = uv2;
  vec3 h = uRotEqjToHor * position;
  float z = dot(h, uCamCenter);
  if (z <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float sinTheta = sqrt(max(0.0, 1.0 - z * z));
  float r = (sinTheta / (1.0 + z)) / uScaleTan;
  float px = dot(h, uCamRight) / sinTheta * r;
  float py = dot(h, uCamUp) / sinTheta * r;
  gl_Position = vec4(px / uAspect, py, 0.0, 1.0);
}
`;

const HIPS_FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  vec4 c = texture2D(uMap, vUv);
  gl_FragColor = vec4(c.rgb * uOpacity, uOpacity * 0.9);
}
`;

interface TileMesh {
  key: string;
  mesh: THREE.Mesh;
}

function slerp(a: Vec3, b: Vec3, t: number): Vec3 {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  d = Math.max(-1, Math.min(1, d));
  const omega = Math.acos(d);
  if (omega < 1e-6) return a;
  const s = Math.sin(omega);
  const ka = Math.sin((1 - t) * omega) / s;
  const kb = Math.sin(t * omega) / s;
  return [a[0] * ka + b[0] * kb, a[1] * ka + b[1] * kb, a[2] * ka + b[2] * kb];
}

/** Bilinear spherical interpolation inside a quad. */
function quadPoint(
  c0: Vec3, c1: Vec3, c2: Vec3, c3: Vec3,
  u: number, v: number,
): Vec3 {
  const a = slerp(c0, c1, u);
  const b = slerp(c3, c2, u);
  return slerp(a, b, v);
}

export class HipsBackground {
  group = new THREE.Group();
  visible = true;
  private material: THREE.ShaderMaterial;
  private tiles = new Map<string, TileMesh>();
  private inflight = new Set<string>();
  private order = -1;
  private textureLoader = new THREE.TextureLoader();
  private maxTiles = 40;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: HIPS_VERTEX,
      fragmentShader: HIPS_FRAGMENT,
      uniforms: {
        ...threeUniformsFromCommon(),
        uMap: { value: null },
        uOpacity: { value: 0.55 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.group.renderOrder = 1;
  }

  setOpacity(o: number): void {
    this.material.uniforms.uOpacity!.value = o;
  }

  private buildTile(order: number, pix: number, texture: THREE.Texture): void {
    const nside = 1 << order;
    const corners = pixCornersVec(nside, pix);
    // Corners: N, E, S, W -> arrange CCW quad: N(c0), E(c1), S(c2), W(c3)
    const [cN, cE, cS, cW] = corners;
    const GRID = 6;
    const positions: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];
    for (let j = 0; j <= GRID; j++) {
      for (let i = 0; i <= GRID; i++) {
        const u = i / GRID;
        const v = j / GRID;
        const p = quadPoint(cW!, cN!, cS!, cE!, u, v);
        positions.push(p[0], p[1], p[2]);
        uvs.push(u, v);
      }
    }
    const stride = GRID + 1;
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const a = j * stride + i;
        indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
    geo.setIndex(indices);
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const mesh = new THREE.Mesh(geo, this.materialFor(texture));
    mesh.frustumCulled = false;
    mesh.renderOrder = 1;
    const key = `${order}/${pix}`;
    this.group.add(mesh);
    this.tiles.set(key, { key, mesh });
  }

  private materialCache: THREE.ShaderMaterial[] = [];
  private materialFor(texture: THREE.Texture): THREE.ShaderMaterial {
    // One material per texture: clone the shared material and bind uMap.
    const m = this.material.clone();
    m.uniforms.uMap = { value: texture };
    this.materialCache.push(m);
    return m;
  }

  private async loadTile(order: number, pix: number): Promise<void> {
    const key = `${order}/${pix}`;
    if (this.tiles.has(key) || this.inflight.has(key)) return;
    this.inflight.add(key);
    try {
      const url = `${HIPS_BASE}/${order}/${pix}/${pix}.jpg`;
      const texture = await this.textureLoader.loadAsync(url);
      texture.colorSpace = THREE.SRGBColorSpace;
      if (this.order === order) this.buildTile(order, pix, texture);
      else texture.dispose();
    } catch {
      // offline / rate limit: skip silently
    } finally {
      this.inflight.delete(key);
    }
  }

  private clearTiles(): void {
    for (const t of this.tiles.values()) {
      this.group.remove(t.mesh);
      t.mesh.geometry.dispose();
    }
    this.tiles.clear();
    for (const m of this.materialCache) m.dispose();
    this.materialCache = [];
  }

  update(frame: SkyFrame, camera: SkyCamera): void {
    if (!this.visible) return;
    setCommonUniforms(this.material.uniforms, frame, camera);
    for (const m of this.materialCache) {
      setCommonUniforms(m.uniforms, frame, camera);
    }

    const fov = camera.fovDeg;
    const order = fov > 90 ? 2 : fov > 25 ? 3 : 4;
    if (order !== this.order) {
      this.order = order;
      this.clearTiles();
    }

    // Tiles overlapping the view disk: cheap center test with a margin of
    // one tile diameter (corner-accurate tests run only at tile build time).
    const nside = 1 << order;
    const npix = 12 * nside * nside;
    const tileRadiusDeg = 60 / nside; // generous upper bound of a tile's radius
    const radiusDeg = fov / 2 + tileRadiusDeg;
    const cosR = Math.cos((radiusDeg * Math.PI) / 180);
    const m: Mat3 = frame.rotEqjToHor;
    const c = camera.centerHor;
    const centerEqj: Vec3 = [
      m[0]! * c[0] + m[3]! * c[1] + m[6]! * c[2],
      m[1]! * c[0] + m[4]! * c[1] + m[7]! * c[2],
      m[2]! * c[0] + m[5]! * c[1] + m[8]! * c[2],
    ];
    let loading = 0;
    const wanted: string[] = [];
    for (let pix = 0; pix < npix; pix++) {
      const v = pixCenterVec(nside, pix);
      if (v[0] * centerEqj[0] + v[1] * centerEqj[1] + v[2] * centerEqj[2] <= cosR) {
        continue;
      }
      const key = `${order}/${pix}`;
      wanted.push(key);
      if (!this.tiles.has(key) && loading < 8) {
        loading++;
        void this.loadTile(order, pix);
      }
    }
    // Evict tiles that left the view.
    for (const [key, tile] of this.tiles) {
      if (!wanted.includes(key) && this.tiles.size > this.maxTiles) {
        this.group.remove(tile.mesh);
        tile.mesh.geometry.dispose();
        this.tiles.delete(key);
      }
    }
  }
}
