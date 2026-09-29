/**
 * Sun, Moon and planet apparent positions (topocentric, of-date, aberrated),
 * in the same coordinate chain as the star field so everything lines up.
 */
import * as Astro from 'astronomy-engine';
import type { Observer, Vec3 } from './types';
import { normalize } from './coords';
import { makeAstroObserver } from './aberration';

const KM_PER_AU = 1.495978707e8;

export type BodyKey =
  | 'sun'
  | 'moon'
  | 'mercury'
  | 'venus'
  | 'mars'
  | 'jupiter'
  | 'saturn'
  | 'uranus'
  | 'neptune';

export interface BodyInfo {
  key: BodyKey;
  /** Chinese + Latin label for UI. */
  label: string;
  /** Topocentric apparent RA/Dec of date, degrees. */
  raDeg: number;
  decDeg: number;
  /** Unit vector in the of-date equatorial (EQD) frame. */
  dirEqd: Vec3;
  /** Distance from Earth in AU. */
  distAu: number;
  /** Apparent equatorial angular diameter, degrees. */
  angularDiameterDeg: number;
  /** Apparent visual magnitude. */
  magnitude: number;
  /** Illuminated fraction of the disk (Sun = 1). */
  phase: number;
  /** Elongation from the Sun in degrees (Sun/Moon = null). */
  elongationDeg: number | null;
}

const BODY_DEFS: {
  key: BodyKey;
  body: Astro.Body;
  label: string;
  radiusKm: number;
}[] = [
  { key: 'sun', body: Astro.Body.Sun, label: '太阳 Sun', radiusKm: 696_000 },
  { key: 'moon', body: Astro.Body.Moon, label: '月亮 Moon', radiusKm: 1_737.4 },
  { key: 'mercury', body: Astro.Body.Mercury, label: '水星 Mercury', radiusKm: 2_439.7 },
  { key: 'venus', body: Astro.Body.Venus, label: '金星 Venus', radiusKm: 6_051.8 },
  { key: 'mars', body: Astro.Body.Mars, label: '火星 Mars', radiusKm: 3_389.5 },
  { key: 'jupiter', body: Astro.Body.Jupiter, label: '木星 Jupiter', radiusKm: 69_911 },
  { key: 'saturn', body: Astro.Body.Saturn, label: '土星 Saturn', radiusKm: 58_232 },
  { key: 'uranus', body: Astro.Body.Uranus, label: '天王星 Uranus', radiusKm: 25_362 },
  { key: 'neptune', body: Astro.Body.Neptune, label: '海王星 Neptune', radiusKm: 24_622 },
];

export function solarSystemBodies(date: Date, observer: Observer): BodyInfo[] {
  const astroObserver = makeAstroObserver(observer);
  const time = Astro.MakeTime(date);
  return BODY_DEFS.map((def) => {
    // Topocentric apparent equatorial coordinates of date (includes light-time,
    // aberration and parallax).
    const eq = Astro.Equator(def.body, date, astroObserver, true, true);
    const dir: Vec3 = [eq.vec.x, eq.vec.y, eq.vec.z];
    const distAu = eq.dist;
    const angularDiameterDeg =
      (2 * Math.atan((def.radiusKm / KM_PER_AU) / distAu) * 180) / Math.PI;
    const illum = Astro.Illumination(def.body, time);
    let magnitude: number;
    if (def.key === 'sun') magnitude = -26.74;
    else if (def.key === 'moon') {
      magnitude = -12.7 + 0.026 * (illum.phase_angle ?? 0) + 4e-9 * (illum.phase_angle ?? 0) ** 6;
    } else magnitude = illum.mag;
    const elongationDeg =
      def.key === 'sun' ? null : Astro.Elongation(def.body, time).elongation;
    return {
      key: def.key,
      label: def.label,
      raDeg: eq.ra * 15,
      decDeg: eq.dec,
      dirEqd: normalize(dir),
      distAu,
      angularDiameterDeg,
      magnitude,
      phase: def.key === 'sun' ? 1 : illum.phase_fraction,
      elongationDeg,
    };
  });
}
