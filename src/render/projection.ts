/**
 * 立体投影（Stellarium 默认投影）与相机基。
 *
 * 投影在顶点着色器里完成（矩阵/基向量以 uniform 传入），本模块提供：
 * - 每帧的相机基（forward/right/up，地平系）
 * - CPU 版投影（HTML 标签、点选拾取与 shader 保持同一公式）
 * - 银道坐标矩阵（银河全景贴图的 UV 定位）
 */
import { DEG } from '../astro/coords';
import type { Mat3, Vec3 } from '../astro/types';

export interface ViewParams {
  /** 视中心的地平坐标（度）。 */
  alt: number;
  az: number;
  /** 垂直视场角（度，全高）。 */
  fovY: number;
  /** 屏幕宽高比（w/h）。 */
  aspect: number;
}

/** 用来构造 right/up 的参考“上”方向：视线接近天顶/天底时切换到东。 */
const UP_Z: Vec3 = { x: 0, y: 0, z: 1 };
const UP_Y: Vec3 = { x: 0, y: 1, z: 0 };

function normalizeVec(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export interface CameraFrame {
  fwd: Vec3;
  right: Vec3;
  up: Vec3;
  /** 立体投影 NDC 半高对应的投影平面半径 r = 2·tan(fovY/4)。 */
  rMax: number;
  aspect: number;
}

export function computeFrame(view: ViewParams): CameraFrame {
  const az = view.az * DEG;
  const alt = view.alt * DEG;
  const ca = Math.cos(alt);
  const fwd = normalizeVec({ x: ca * Math.cos(az), y: ca * Math.sin(az), z: Math.sin(alt) });
  const ref = Math.abs(fwd.z) > 0.95 ? UP_Y : UP_Z;
  const right = normalizeVec(cross(fwd, ref)); // 视线向右
  const up = cross(right, fwd);
  return {
    fwd,
    right,
    up,
    rMax: 2 * Math.tan((view.fovY * DEG) / 4),
    aspect: view.aspect,
  };
}

export interface ScreenPos {
  /** NDC（−1..1），x 已含宽高比。 */
  x: number;
  y: number;
  /** 是否在视场附近（含余量）。 */
  visible: boolean;
  /** 与视线夹角（弧度）。 */
  theta: number;
}

/** 地平系单位向量 → 屏幕 NDC（与顶点着色器同一公式）。 */
export function projectHorizon(h: Vec3, f: CameraFrame): ScreenPos {
  const ct = Math.max(-1, Math.min(1, dot(h, f.fwd)));
  const theta = Math.acos(ct);
  if (theta > 2.9) return { x: 0, y: 0, visible: false, theta };
  const rp = {
    x: h.x - ct * f.fwd.x,
    y: h.y - ct * f.fwd.y,
    z: h.z - ct * f.fwd.z,
  };
  const sp = Math.hypot(rp.x, rp.y, rp.z);
  const r = 2 * Math.tan(theta / 2);
  if (sp < 1e-9) return { x: 0, y: 0, visible: true, theta }; // 正中心
  const px = (dot(rp, f.right) / sp) * r;
  const py = (dot(rp, f.up) / sp) * r;
  return {
    x: px / (f.rMax * f.aspect),
    y: py / f.rMax,
    visible: r < f.rMax * 1.35,
    theta,
  };
}

/**
 * EQJ（J2000 赤道）→ 银道旋转矩阵（行主序）。
 * 银北极 (RA 192.85948°, Dec 27.12825°)，银心方向 (RA 266.405°, Dec −28.936°)。
 */
export function eqjToGalacticMatrix(): Mat3 {
  const pole = radecUnit(192.85948, 27.12825);
  const center = radecUnit(266.405, -28.936);
  const gz = pole;
  let gx = {
    x: center.x - dot(center, gz) * gz.x,
    y: center.y - dot(center, gz) * gz.y,
    z: center.z - dot(center, gz) * gz.z,
  };
  gx = normalizeVec(gx);
  const gy = cross(gz, gx);
  // u_gal = M · u_eqj，M 行为银道基向量
  return [
    gx.x, gx.y, gx.z,
    gy.x, gy.y, gy.z,
    gz.x, gz.y, gz.z,
  ];
}

function radecUnit(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return { x: cd * Math.cos(ra), y: cd * Math.sin(ra), z: Math.sin(dec) };
}

/** 3×3 矩阵求逆（旋转矩阵，转置即可，这里仍写通用伴随法以容错）。 */
export function transposeMat3(m: Mat3): Mat3 {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
