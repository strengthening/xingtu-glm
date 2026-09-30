/**
 * 色指数 B−V → sRGB（线性分量 0..1）。
 * 锚点取自 Mitchell Charity《What color are the stars?》色表的代表采样，
 * 分段线性插值，超出 [-0.40, 2.00] 截断。仅用于视觉着色，非测色标准。
 */

interface BvColor {
  bv: number;
  r: number;
  g: number;
  b: number;
}

const ANCHORS: readonly BvColor[] = [
  { bv: -0.4, r: 0.61, g: 0.69, b: 1.0 }, // O 型蓝
  { bv: 0.0, r: 0.79, g: 0.84, b: 1.0 },
  { bv: 0.3, r: 0.98, g: 0.99, b: 1.0 },
  { bv: 0.58, r: 1.0, g: 0.96, b: 0.92 },
  { bv: 0.81, r: 1.0, g: 0.82, b: 0.63 }, // K 型橙
  { bv: 1.4, r: 1.0, g: 0.69, b: 0.44 },
  { bv: 2.0, r: 1.0, g: 0.6, b: 0.4 }, // M 型红橙
];

/** 输出长度 3 的线性 RGB。 */
export function bvToRgb(bv: number): [number, number, number] {
  const first = ANCHORS[0]!;
  const last = ANCHORS[ANCHORS.length - 1]!;
  if (bv <= first.bv) return [first.r, first.g, first.b];
  if (bv >= last.bv) return [last.r, last.g, last.b];
  for (let i = 1; i < ANCHORS.length; i++) {
    const a = ANCHORS[i - 1]!;
    const b = ANCHORS[i]!;
    if (bv <= b.bv) {
      const t = (bv - a.bv) / (b.bv - a.bv);
      return [a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t];
    }
  }
  return [last.r, last.g, last.b]; // 不可达
}
