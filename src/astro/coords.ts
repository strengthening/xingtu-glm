/**
 * Coordinate math on the unit celestial sphere.
 *
 * Conventions match astronomy-engine frames:
 *  - EQJ / ICRS(J2000): +x vernal equinox, +z celestial north.
 *  - HOR (local horizontal): +x south, +y east, +z zenith
 *    (altitude = asin(z), azimuth = atan2(y, -x), north through east).
 *
 * All spherical coordinates are in degrees.
 */
import type * as Astro from 'astronomy-engine';
import type { EquatorialCoord, HorizontalCoord, Mat3, Vec3 } from './types';

const DEG = Math.PI / 180;

export function unitVectorFromRaDec(raDeg: number, decDeg: number): Vec3 {
  const ra = raDeg * DEG;
  const dec = decDeg * DEG;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

export function raDecFromUnitVector(v: Vec3): EquatorialCoord {
  const x = v[0];
  const y = v[1];
  const z = v[2];
  const r = Math.hypot(x, y);
  const ra = Math.atan2(y, x) / DEG;
  return { ra: (ra + 360) % 360, dec: Math.atan2(z, r) / DEG };
}

export function horizontalFromHorVector(v: Vec3): HorizontalCoord {
  const altitude = Math.asin(clamp1(v[2])) / DEG;
  let azimuth = Math.atan2(v[1], -v[0]) / DEG;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

export function horVectorFromHorizontal(altDeg: number, azDeg: number): Vec3 {
  const alt = altDeg * DEG;
  const az = azDeg * DEG;
  const [ca, sa] = [Math.cos(alt), Math.sin(alt)];
  // +x south, +y east: az=0 (north) -> (-sin0, cos0)... north = -x, east = +y.
  return [-ca * Math.cos(az), ca * Math.sin(az), sa];
}

export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

/** C = A * B, i.e. apply B first, then A. */
export function mulMat3(a: Mat3, b: Mat3): Mat3 {
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out[r * 3 + c] =
        a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
    }
  }
  return out as unknown as Mat3;
}

export function transposeMat3(m: Mat3): Mat3 {
  return [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];
}

/**
 * Convert an astronomy-engine RotationMatrix to our row-major Mat3.
 * astronomy-engine multiplies as v' = M^T v with M = rot (2D), so we flatten
 * with a transpose: result[r*3+c] = rot[c][r].
 */
export function mat3FromAstroRotation(r: Astro.RotationMatrix): Mat3 {
  const a = r.rot;
  return [
    a[0]![0]!,
    a[1]![0]!,
    a[2]![0]!,
    a[0]![1]!,
    a[1]![1]!,
    a[2]![1]!,
    a[0]![2]!,
    a[1]![2]!,
    a[2]![2]!,
  ];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function normalize(v: Vec3): Vec3 {
  const n = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / n, v[1] / n, v[2] / n];
}

export function clamp1(x: number): number {
  return Math.max(-1, Math.min(1, x));
}

/** Angular separation between two unit vectors, in degrees. */
export function angularSeparation(a: Vec3, b: Vec3): number {
  return Math.acos(clamp1(dot(a, b))) / DEG;
}
