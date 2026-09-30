/**
 * 坐标变换核心：角度工具、赤道 ↔ 地平、岁差（经 astronomy-engine）、自行。
 *
 * 约定：
 * - 赤道系单位向量：x → 春分点，z → 北天极。
 * - 地平系单位向量：x → 北，y → 东，z → 天顶。
 * - 方位角从正北起算、顺时针（经东）为正。
 * - 对外角度一律用度；弧度只在函数内部出现。
 */
import { Rotation_EQJ_EQD, SiderealTime } from 'astronomy-engine';
import type { Altaz, Mat3, Radec, Vec3 } from './types';

export const DEG = Math.PI / 180;
export const J2000_EPOCH_MS = Date.UTC(2000, 0, 1, 12, 0, 0);

/** 自 J2000 起算的儒略年数（用于自行；UT 与 TT 之差约 1 分钟，对自行可忽略）。 */
export function yearsSinceJ2000(date: Date): number {
  return (date.getTime() - J2000_EPOCH_MS) / (365.25 * 86400_000);
}

export function deg2rad(d: number): number {
  return d * DEG;
}

export function rad2deg(r: number): number {
  return r / DEG;
}

export function norm(v: Vec3): number {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

export function normalize(v: Vec3): Vec3 {
  const n = norm(v);
  return { x: v.x / n, y: v.y / n, z: v.z / n };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return {
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  };
}

/** 行主序 → 列主序（gl.uniformMatrix3fv / THREE.Matrix3.elements 直接可用）。 */
export function toArrayColumnMajor(m: Mat3): Float32Array {
  return new Float32Array([
    m[0]!, m[3]!, m[6]!,
    m[1]!, m[4]!, m[7]!,
    m[2]!, m[5]!, m[8]!,
  ]);
}

/** 赤道坐标（度）→ 赤道系单位向量。 */
export function radecToUnit(rd: Radec): Vec3 {
  const a = rd.ra * DEG;
  const d = rd.dec * DEG;
  const cd = Math.cos(d);
  return { x: cd * Math.cos(a), y: cd * Math.sin(a), z: Math.sin(d) };
}

/** 赤道系单位向量 → 赤道坐标（度）。 */
export function unitToRadec(v: Vec3): Radec {
  const u = normalize(v);
  let ra = rad2deg(Math.atan2(u.y, u.x));
  if (ra < 0) ra += 360;
  return { ra, dec: rad2deg(Math.asin(Math.max(-1, Math.min(1, u.z)))) };
}

/** 地平系单位向量 → 地平坐标（度）。 */
export function unitToAltaz(v: Vec3): Altaz {
  const u = normalize(v);
  const alt = rad2deg(Math.asin(Math.max(-1, Math.min(1, u.z))));
  let az = rad2deg(Math.atan2(u.y, u.x));
  if (az < 0) az += 360;
  return { alt, az };
}

/** 地平坐标（度）→ 地平系单位向量。 */
export function altazToUnit(aa: Altaz): Vec3 {
  const a = aa.az * DEG;
  const h = aa.alt * DEG;
  const ch = Math.cos(h);
  return { x: ch * Math.cos(a), y: ch * Math.sin(a), z: Math.sin(h) };
}

/** 格林尼治视恒星时（度，含章动）。引擎返回值为小时，需 ×15。 */
export function gastDeg(date: Date): number {
  return SiderealTime(date) * 15;
}

/**
 * J2000 平赤道（EQJ）→ 观测时刻真赤道（EQD）旋转矩阵（行主序，一维长度 9）。
 * 内部为 IAU 岁差 + 章动，精度远优于本项目亚角秒目标。u_eqd = M · u_eqj。
 * 注意：引擎 rot[j][i] 的首下标为列，此处转置为行主序存储。
 */
export function eqjToEqdMatrix(date: Date): Mat3 {
  const r = Rotation_EQJ_EQD(date).rot;
  return [
    r[0]![0]!, r[1]![0]!, r[2]![0]!,
    r[0]![1]!, r[1]![1]!, r[2]![1]!,
    r[0]![2]!, r[1]![2]!, r[2]![2]!,
  ];
}

/**
 * 真赤道（EQD）单位向量 → 地平系单位向量的旋转矩阵（行主序）。
 * gast 为格林尼治视恒星时（度）；lat/lon 为观测者纬度/经度（度，东经为正）。
 *
 * 推导：时角 H = LST − α = A − α，其中 A = gast + lon。用
 *   cosδcosH = cosA·x + sinA·y，cosδsinH = sinA·x − cosA·y，sinδ = z
 * 代入地平分量 N = cosφsinδ − sinφcosδcosH，E = −cosδsinH，Z = sinφsinδ + cosφcosδcosH。
 */
export function eqdToHorizonMatrix(gast: number, lat: number, lon: number): Mat3 {
  const A = (gast + lon) * DEG;
  const cA = Math.cos(A);
  const sA = Math.sin(A);
  const sf = Math.sin(lat * DEG);
  const cf = Math.cos(lat * DEG);
  return [
    -sf * cA, -sf * sA, cf, // 北
    -sA, cA, 0, // 东
    cf * cA, cf * sA, sf, // 天顶
  ];
}

/**
 * 按线性自行外推单位球上的位置（切平面一阶近似，亚角秒级足够）。
 * Tycho-2 惯例：pmRaMas 已含 cosδ 因子（即 μα·cosδ），两者单位均为 mas/年。
 */
export function applyProperMotion(
  u: Vec3,
  pmRaMas: number,
  pmDecMas: number,
  years: number,
): Vec3 {
  const MAS2RAD = DEG / 3_600_000;
  const dAlpha = pmRaMas * years * MAS2RAD; // 切向角位移（东向）
  const dDelta = pmDecMas * years * MAS2RAD; // 切向角位移（北向）
  // 赤道切向基：eA 东（dα 方向），eD 北（dδ 方向）
  const ra = Math.atan2(u.y, u.x);
  const dec = Math.asin(Math.max(-1, Math.min(1, u.z)));
  const cA = Math.cos(ra);
  const sA = Math.sin(ra);
  const cD = Math.cos(dec);
  const sD = Math.sin(dec);
  return {
    x: u.x + -sA * dAlpha + -sD * cA * dDelta,
    y: u.y + cA * dAlpha + -sD * sA * dDelta,
    z: u.z + 0 + cD * dDelta,
  };
}
