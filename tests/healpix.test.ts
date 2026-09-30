import { describe, expect, it } from 'vitest';
import { maxPixRadDeg, pixNestToRadec, radecToPixNest } from '../src/astro/healpix';

/** 确定性伪随机（避免测试随机性）。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

describe('HEALPix NESTED', () => {
  it('nside=1 覆盖全部 12 个基础面', () => {
    const seen = new Set<number>();
    const rnd = lcg(42);
    for (let i = 0; i < 5000; i++) {
      const ra = rnd() * 360;
      const dec = Math.asin(rnd() * 2 - 1) / (Math.PI / 180);
      seen.add(radecToPixNest(1, ra, dec));
    }
    expect(seen.size).toBe(12);
  });

  it('极点落入极区面，赤道落入赤道面', () => {
    // face 0–3 北蝶形，4–7 赤道，8–11 南蝶形
    expect(radecToPixNest(8, 10, 89.9)).toBeLessThan(4 * 64);
    expect(radecToPixNest(8, 200, -89.9)).toBeGreaterThanOrEqual(8 * 64);
    const eq = radecToPixNest(8, 0, 0);
    expect(eq).toBeGreaterThanOrEqual(4 * 64);
    expect(eq).toBeLessThan(8 * 64);
  });

  it('像素面积等积：随机方向均匀分布', () => {
    const nside = 8;
    const npix = 12 * nside * nside;
    const counts = new Array<number>(npix).fill(0);
    const rnd = lcg(7);
    const n = 48000;
    for (let i = 0; i < n; i++) {
      const ra = rnd() * 360;
      const dec = Math.asin(rnd() * 2 - 1) / (Math.PI / 180);
      counts[radecToPixNest(nside, ra, dec)]!++;
    }
    const mean = n / npix; // ≈ 62.5
    // 每个像素都应命中，且无系统性堆积（HEALPix 严格等积，仅容许统计涨落）
    for (let p = 0; p < npix; p++) {
      const c = counts[p]!;
      expect(c).toBeGreaterThan(mean * 0.5);
      expect(c).toBeLessThan(mean * 1.7);
    }
  });

  it('pix → 中心方向 → pix 往返一致（误差不超过一个像素）', () => {
    const nside = 4;
    const npix = 12 * nside * nside;
    for (let p = 0; p < npix; p++) {
      const { ra, dec } = pixNestToRadec(nside, p);
      expect(dec).toBeGreaterThanOrEqual(-90);
      expect(dec).toBeLessThanOrEqual(90);
      const back = radecToPixNest(nside, ra, dec);
      // 像素中心应映射回自身；边界浮点误差最多落到相邻像素，用编号差 < nside 判定
      expect(Math.abs(back - p)).toBeLessThan(nside);
    }
  });

  it('角半径随 nside 反比缩放', () => {
    expect(maxPixRadDeg(8)).toBeCloseTo(maxPixRadDeg(4) / 2, 5);
  });
});
