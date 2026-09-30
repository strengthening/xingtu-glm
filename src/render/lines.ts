/**
 * 线条层：星座连线、赤道网格、地平网格、地平线。
 *
 * LINE_VERT 的 uSpace 决定输入坐标系：
 *   0 = EQJ（星座连线、赤道网格，随岁差由 GPU 旋转）
 *   2 = 地平系（地平线、地平网格，相对观测者固定）
 */
import * as THREE from 'three';
import { DEG } from '../astro/coords';
import type { Vec3 } from '../astro/types';
import { LINE_FRAG, LINE_VERT } from './shaders';

export type LineSpace = 0 | 2; // EQJ | 地平

export interface LineOptions {
  color: number;
  opacity: number;
  /** 0 实线（网格）；0.5 细连线；1 地平线加粗语义（宽度受 WebGL 限制仍为 1px）。 */
  dash: 0 | 0.5 | 1;
  space: LineSpace;
}

export function makeLineLayer(
  scene: THREE.Scene,
  sharedUniforms: Record<string, THREE.IUniform>,
  unitVectors: Vec3[],
  opts: LineOptions,
): THREE.LineSegments {
  const n = unitVectors.length;
  const pos = new Float32Array(n * 3);
  const dash = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const v = unitVectors[i]!;
    pos[i * 3] = v.x;
    pos[i * 3 + 1] = v.y;
    pos[i * 3 + 2] = v.z;
    dash[i] = opts.dash;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geometry.setAttribute('aDash', new THREE.BufferAttribute(dash, 1));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
  const material = new THREE.ShaderMaterial({
    uniforms: {
      ...sharedUniforms,
      uLineColor: { value: new THREE.Color(opts.color) },
      uLineOpacity: { value: opts.opacity },
      uSpace: { value: opts.space },
    },
    vertexShader: LINE_VERT,
    fragmentShader: LINE_FRAG,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });
  const lines = new THREE.LineSegments(geometry, material);
  lines.frustumCulled = false;
  scene.add(lines);
  return lines;
}

// ---------------------------------------------------------------------------
// 网格与地平线的几何生成（均为成对的线段顶点序列）
// ---------------------------------------------------------------------------

function altazUnit(altDeg: number, azDeg: number): Vec3 {
  const h = altDeg * DEG;
  const a = azDeg * DEG;
  const ch = Math.cos(h);
  return { x: ch * Math.cos(a), y: ch * Math.sin(a), z: Math.sin(h) };
}

function radecUnit(raDeg: number, decDeg: number): Vec3 {
  const d = decDeg * DEG;
  const r = raDeg * DEG;
  const cd = Math.cos(d);
  return { x: cd * Math.cos(r), y: cd * Math.sin(r), z: Math.sin(d) };
}

/** 沿某个圆（固定 lat 或固定 az）采样成线段对序列。 */
function circleSegments(
  stepDeg: number,
  fn: (t: number) => Vec3,
): Vec3[] {
  const out: Vec3[] = [];
  const n = Math.round(360 / stepDeg);
  for (let i = 0; i < n; i++) {
    const a = i * stepDeg;
    const b = (i + 1) * stepDeg;
    out.push(fn(a), fn(b));
  }
  return out;
}

/** 地平线（alt = 0，观测者固定）。 */
export function horizonLine(): Vec3[] {
  return circleSegments(3, (az) => altazUnit(0, az));
}

/** 地平网格：高度圈 20/40/60 + 方位线每 30°。 */
export function horizonGrid(): Vec3[] {
  const out: Vec3[] = [];
  for (const alt of [20, 40, 60]) {
    out.push(...circleSegments(5, (az) => altazUnit(alt, az)));
  }
  for (let az = 0; az < 360; az += 30) {
    for (let alt = 0; alt < 80; alt += 10) {
      out.push(altazUnit(alt, az), altazUnit(alt + 10, az));
    }
  }
  return out;
}

/** 赤道网格（EQJ）：赤道 + 纬线 ±30/60 + 赤经线每 2h。 */
export function equatorGrid(): Vec3[] {
  const out: Vec3[] = [];
  out.push(...circleSegments(2, (ra) => radecUnit(ra, 0)));
  for (const dec of [-60, -30, 30, 60]) {
    const step = dec === 0 ? 2 : Math.max(2, Math.round(2 / Math.cos(dec * DEG)));
    out.push(...circleSegments(step, (ra) => radecUnit(ra, dec)));
  }
  for (let ra = 0; ra < 360; ra += 30) {
    for (let dec = -80; dec < 80; dec += 10) {
      out.push(radecUnit(ra, dec), radecUnit(ra, dec + 10));
    }
  }
  return out;
}
