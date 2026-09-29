/**
 * Star color: B-V color index -> RGB.
 *
 * B-V -> effective temperature via Ballesteros (2012) "Black body color
 * modeling with CIE XYZ and xyY color models",
 * https://arxiv.org/abs/1201.1809 — and Teff -> sRGB via a blackbody
 * approximation (Planckian locus fit in the style of Tanner Helland).
 * Pure function, no dependencies; shared by the tile builder (documentation)
 * and the runtime B-V lookup texture generator.
 */

export function bvToTeff(bv: number): number {
  const x = Math.max(-0.4, Math.min(2.0, bv));
  return 4600 * (1 / (0.92 * x + 1.7) + 1 / (0.92 * x + 0.62 * x * x + 0.67));
}

/** Teff (K) -> linear-ish RGB in [0,1]. */
export function teffToRgb(t: number): [number, number, number] {
  const temp = Math.max(1000, Math.min(40000, t)) / 100;
  let r: number;
  let g: number;
  let b: number;

  if (temp <= 66) {
    r = 255;
    g = 99.4708 * Math.log(temp) - 161.1196;
  } else {
    r = 329.6987 * Math.pow(temp - 60, -0.1332);
    g = 288.1222 * Math.pow(temp - 60, -0.0755);
  }
  if (temp >= 66) {
    b = 255;
  } else if (temp <= 19) {
    b = 0;
  } else {
    b = 138.5177 * Math.log(temp - 10) - 305.0448;
  }

  const clamp = (v: number) => Math.max(0, Math.min(255, v)) / 255;
  return [clamp(r), clamp(g), clamp(b)];
}

export function bvToRgb(bv: number): [number, number, number] {
  return teffToRgb(bvToTeff(bv));
}

/**
 * Build a 1D B-V -> RGB lookup table for the GPU.
 * Covers B-V in [-0.4, 2.0], `size` samples, RGBA8, sRGB-ish gamma 1/2.2
 * applied so the shader can output directly.
 */
export function buildBvLut(
  size = 128,
  range: readonly [number, number] = [-0.4, 2.0],
): Uint8Array {
  const data = new Uint8Array(size * 4);
  for (let i = 0; i < size; i++) {
    const bv = range[0] + ((range[1] - range[0]) * i) / (size - 1);
    const [r, g, b] = bvToRgb(bv);
    // Boost saturation slightly: star colors are subtle against white.
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    const sat = 1.45;
    const mix = (c: number) => Math.max(0, Math.min(1, lum + (c - lum) * sat));
    const gamma = (c: number) => Math.pow(mix(c), 1 / 2.2);
    data[i * 4] = Math.round(gamma(r) * 255);
    data[i * 4 + 1] = Math.round(gamma(g) * 255);
    data[i * 4 + 2] = Math.round(gamma(b) * 255);
    data[i * 4 + 3] = 255;
  }
  return data;
}

export const BV_LUT_RANGE: readonly [number, number] = [-0.4, 2.0];
