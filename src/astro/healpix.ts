/**
 * HEALPix NESTED 像素化（Górski et al. 2005, ApJ 622, 759）。
 *
 * 只实现本项目需要的方向：
 * - 天球方向 → nest 像素号（星表切片归属）
 * - nest 像素号 → 中心方向与角半径（视野切片加载）
 *
 * 坐标链路：(z=sinδ, a=α) --HEALPix 投影--> (t, u) --仿射--> 基础面 f + 面内坐标
 * (x, y) --位交织--> nest 编号。nside 必须为 2 的幂。
 */
import { DEG } from './coords';

const PI_2 = Math.PI / 2;
const PI_4 = Math.PI / 4;

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function wrap2pi(a: number): number {
  a %= 2 * Math.PI;
  return a < 0 ? a + 2 * Math.PI : a;
}

/** Morton 位交织：x 占偶数位，y 占奇数位（HEALPix nest 的 Z 序曲线）。 */
function interleaveBits(x: number, y: number): number {
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r |= ((x >>> i) & 1) << (2 * i);
    r |= ((y >>> i) & 1) << (2 * i + 1);
  }
  return r;
}

function deinterleaveX(z: number): number {
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r |= ((z >>> (2 * i)) & 1) << i;
  }
  return r;
}

function deinterleaveY(z: number): number {
  let r = 0;
  for (let i = 0; i < 16; i++) {
    r |= ((z >>> (2 * i + 1)) & 1) << i;
  }
  return r;
}

/**
 * HEALPix 球面投影 (z, a) → (t, u)。
 * 赤道带 |z| ≤ 2/3 为圆柱投影；极区为蝶形投影。
 */
function za2tu(z: number, a: number): { t: number; u: number } {
  if (Math.abs(z) <= 2 / 3) {
    return { t: a, u: (3 * Math.PI * z) / 8 };
  }
  const sgn = z >= 0 ? 1 : -1;
  const sigma = sgn * (2 - Math.sqrt(3 * (1 - Math.abs(z))));
  const aMod = a % PI_2;
  return { t: a - (Math.abs(sigma) - 1) * (aMod - PI_4), u: PI_4 * sigma };
}

/** 逆投影 (t, u) → (z, a)。 */
function tu2za(t: number, u: number): { z: number; a: number } {
  const au = Math.abs(u);
  if (au <= PI_4) {
    return { z: (8 * u) / (3 * Math.PI), a: t };
  }
  const tMod = t % PI_2;
  const a = t - ((au - PI_4) / (au - PI_2)) * (tMod - PI_4);
  const sgn = u >= 0 ? 1 : -1;
  const k = 2 - (4 * au) / Math.PI;
  return { z: sgn * (1 - (k * k) / 3), a };
}

/**
 * 投影 (t, u) → 基础面编号 f 与面内归一化坐标 p, q ∈ [0,1)。
 * p 为东北向、q 为西北向。
 */
function tu2fpq(t: number, u: number): { f: number; p: number; q: number } {
  let tt = (t / PI_4) % 8;
  if (tt < 0) tt += 8;
  tt -= 4;
  const uu = u / PI_4 + 5;
  const pp = clip((uu + tt) / 2, 0, 5);
  const PP = Math.floor(pp);
  const qq = clip((uu - tt) / 2, 3 - PP, 6 - PP);
  const QQ = Math.floor(qq);
  const V = 5 - (PP + QQ);
  if (V < 0) return { f: 0, p: 1, q: 1 }; // 投影边界角点，归属任一面均可
  const H = PP - QQ + 4;
  return { f: 4 * V + ((H >> 1) % 4), p: pp % 1, q: qq % 1 };
}

/** 面内坐标 (f, x, y) → 投影 (t, u)（x/y 中心坐标，可为 0.5 偏移的浮点）。 */
function fxy2tu(nside: number, f: number, x: number, y: number): { t: number; u: number } {
  const fRow = Math.floor(f / 4);
  const f1 = fRow + 2;
  const f2 = 2 * (f % 4) - (fRow % 2) + 1;
  const v = x + y;
  const h = x - y;
  const i = f1 * nside - v - 1;
  const k = f2 * nside + h;
  return { t: (k / nside) * PI_4, u: PI_2 - (i / nside) * PI_4 };
}

/** 赤道坐标（度）→ NESTED 像素号。 */
export function radecToPixNest(nside: number, raDeg: number, decDeg: number): number {
  const z = Math.sin(decDeg * DEG);
  const a = wrap2pi(raDeg * DEG);
  const { t, u } = za2tu(z, a);
  const { f, p, q } = tu2fpq(t, u);
  const x = clip(Math.floor(nside * p), 0, nside - 1);
  const y = clip(Math.floor(nside * q), 0, nside - 1);
  return f * nside * nside + interleaveBits(x, y);
}

/** NESTED 像素号 → 像素中心赤道坐标（度）。整数 (x,y) 格点即菱形中心。 */
export function pixNestToRadec(nside: number, ipix: number): { ra: number; dec: number } {
  const face = Math.floor(ipix / (nside * nside));
  const k = ipix % (nside * nside);
  const x = deinterleaveX(k);
  const y = deinterleaveY(k);
  const { t, u } = fxy2tu(nside, face, x, y);
  const { z, a } = tu2za(t, u);
  return { ra: wrap2pi(a) / DEG, dec: Math.asin(Math.max(-1, Math.min(1, z))) / DEG };
}

/** nside 个像素的最大角半径（度），用于视野与切片的相交判定。 */
export function maxPixRadDeg(nside: number): number {
  // HEALPix 像素最大角直径 ≈ sqrt(π/3)·2/nside 弧度的保守上界，再留 15% 余量
  return ((2 * Math.sqrt(Math.PI / 3)) / nside) * (180 / Math.PI) * 1.15;
}
