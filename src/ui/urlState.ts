/**
 * URL 状态分享：把视角（赤经/赤纬）、FOV、时间、地点编码进 hash，可恢复。
 * 例：#ra=101.3&dec=-16.7&fov=60&t=2026-01-10T14:00Z&place=shanghai
 */
import { radecToUnit, unitToRadec } from '../astro/coords';
import type { Mat3, Vec3 } from '../astro/types';

export interface UrlState {
  ra?: number;
  dec?: number;
  fov?: number;
  t?: string;
  place?: string;
}

export function parseHash(): UrlState {
  const out: UrlState = {};
  const hash = location.hash.replace(/^#/, '');
  if (!hash) return out;
  for (const part of hash.split('&')) {
    const [k, v] = part.split('=');
    if (!k || v === undefined) continue;
    switch (k) {
      case 'ra':
        out.ra = Number(v);
        break;
      case 'dec':
        out.dec = Number(v);
        break;
      case 'fov':
        out.fov = Number(v);
        break;
      case 't':
        out.t = decodeURIComponent(v);
        break;
      case 'place':
        out.place = v;
        break;
    }
  }
  return out;
}

/** 视角中心（地平系向量）→ 当前时刻的赤经赤纬。 */
export function centerToRadec(centerHor: Vec3, eqd: Mat3, hor: Mat3): { ra: number; dec: number } {
  // hor 是 EQD→地平，其逆 = 转置；再 EQD→EQJ = eqd 转置
  const t = (m: Mat3): Mat3 => [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
  const apply = (m: Mat3, v: Vec3): Vec3 => ({
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  });
  return unitToRadec(apply(t(eqd), apply(t(hor), centerHor)));
}

/** 赤经赤纬 → 视角中心（地平系向量）。 */
export function radecToCenterHor(ra: number, dec: number, eqd: Mat3, hor: Mat3): Vec3 {
  const u = radecToUnit({ ra, dec });
  const apply = (m: Mat3, v: Vec3): Vec3 => ({
    x: m[0]! * v.x + m[1]! * v.y + m[2]! * v.z,
    y: m[3]! * v.x + m[4]! * v.y + m[5]! * v.z,
    z: m[6]! * v.x + m[7]! * v.y + m[8]! * v.z,
  });
  return apply(hor, apply(eqd, u));
}

export function writeHash(state: UrlState): void {
  const parts: string[] = [];
  if (state.ra !== undefined) parts.push(`ra=${state.ra.toFixed(3)}`);
  if (state.dec !== undefined) parts.push(`dec=${state.dec.toFixed(3)}`);
  if (state.fov !== undefined) parts.push(`fov=${state.fov.toFixed(2)}`);
  if (state.t) parts.push(`t=${encodeURIComponent(state.t)}`);
  if (state.place) parts.push(`place=${state.place}`);
  const hash = parts.length > 0 ? `#${parts.join('&')}` : '';
  history.replaceState(null, '', location.pathname + location.search + hash);
}
