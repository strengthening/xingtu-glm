/**
 * SkyFrame: everything derived from (date, observer) that the renderer needs.
 * CPU-side math in float64; matrices are handed to the GPU once per update.
 */
import * as Astro from 'astronomy-engine';
import type { Mat3, Vec3 } from './types';
import {
  mat3FromAstroRotation,
  mulMat3,
  unitVectorFromRaDec,
} from './coords';
import { makeAstroObserver, observerBetaEqj } from './aberration';
import type { Observer } from './types';

/**
 * Epoch of Tycho-2 catalog positions. The published mean positions are
 * already propagated to J2000.0 by the catalog's own proper motions
 * (VizieR I/259 ReadMe, note 3), so proper motion integrates from 2000.0,
 * not from the 1991.25 mean epoch of observation.
 */
export const CATALOG_EPOCH_YEARS = 2000.0;

export interface SkyFrame {
  date: Date;
  observer: Observer;
  /** J2000/ICRS unit vector -> local horizontal frame (x south, y east, z up). */
  rotEqjToHor: Mat3;
  /** Observer velocity / c in ICRS, for first-order aberration in the shader. */
  betaEqj: Vec3;
  /** Years elapsed since CATALOG_EPOCH_YEARS, for proper motion. */
  yearsSinceEpoch: number;
  /** Local apparent sidereal time in degrees. */
  lstDeg: number;
  /** Sun altitude (deg) and fraction of the lunar disk illuminated, for sky glow. */
  sunAltDeg: number;
  moonIllum: number;
  moonAltDeg: number;
}

export function computeSkyFrame(date: Date, observer: Observer): SkyFrame {
  const time = Astro.MakeTime(date);
  const astroObserver = makeAstroObserver(observer);

  const eqdToHor = Astro.Rotation_EQD_HOR(time, astroObserver);
  const eqjToEqd = Astro.Rotation_EQJ_EQD(time);
  const rotEqjToHor = mulMat3(
    mat3FromAstroRotation(eqdToHor),
    mat3FromAstroRotation(eqjToEqd),
  );

  const gastHours = Astro.SiderealTime(time);
  const lstDeg = (gastHours * 15 + observer.longitude) % 360;

  const sunEqd = Astro.Equator(Astro.Body.Sun, date, astroObserver, true, true);
  const sunHor = Astro.Horizon(date, astroObserver, sunEqd.ra, sunEqd.dec, undefined);
  const moonEqd = Astro.Equator(Astro.Body.Moon, date, astroObserver, true, true);
  const moonHor = Astro.Horizon(date, astroObserver, moonEqd.ra, moonEqd.dec, undefined);

  return {
    date,
    observer,
    rotEqjToHor,
    betaEqj: observerBetaEqj(time, observer),
    yearsSinceEpoch:
      date.getTime() / (365.25 * 86400_000) + 1970 - CATALOG_EPOCH_YEARS,
    lstDeg,
    sunAltDeg: sunHor.altitude,
    moonAltDeg: moonHor.altitude,
    moonIllum: Astro.Illumination(Astro.Body.Moon, time).phase_fraction,
  };
}

/** J2000 RA/Dec (deg) -> apparent horizontal coordinates, for tests and picking. */
export function altAzFromJ2000(
  raDeg: number,
  decDeg: number,
  frame: SkyFrame,
  properMotion: { pmRaMasYr: number; pmDecMasYr: number } | null = null,
): { altitude: number; azimuth: number } {
  let v = unitVectorFromRaDec(raDeg, decDeg);
  if (properMotion) {
    // Apply proper motion in the tangent plane.
    const years = frame.yearsSinceEpoch;
    const MAS_TO_RAD = (Math.PI / 180) / 3.6e6;
    const pmRaRad = properMotion.pmRaMasYr * MAS_TO_RAD * years;
    const pmDecRad = properMotion.pmDecMasYr * MAS_TO_RAD * years;
    const east: Vec3 = [-v[1], v[0], 0];
    const north: Vec3 = [
      -v[0] * v[2],
      -v[1] * v[2],
      v[0] * v[0] + v[1] * v[1],
    ];
    v = [
      v[0] + pmRaRad * east[0] + pmDecRad * north[0],
      v[1] + pmRaRad * east[1] + pmDecRad * north[1],
      v[2] + pmRaRad * east[2] + pmDecRad * north[2],
    ];
    const n = Math.hypot(v[0], v[1], v[2]);
    v = [v[0] / n, v[1] / n, v[2] / n];
  }
  // Aberration (first order).
  const b = frame.betaEqj;
  const bn = b[0] * v[0] + b[1] * v[1] + b[2] * v[2];
  let w: Vec3 = [v[0] + b[0] - bn * v[0], v[1] + b[1] - bn * v[1], v[2] + b[2] - bn * v[2]];
  const nw = Math.hypot(w[0], w[1], w[2]);
  w = [w[0] / nw, w[1] / nw, w[2] / nw];
  // To horizontal frame.
  const m = frame.rotEqjToHor;
  const h: Vec3 = [
    m[0] * w[0] + m[1] * w[1] + m[2] * w[2],
    m[3] * w[0] + m[4] * w[1] + m[5] * w[2],
    m[6] * w[0] + m[7] * w[1] + m[8] * w[2],
  ];
  const altitude = (Math.asin(Math.max(-1, Math.min(1, h[2]))) * 180) / Math.PI;
  let azimuth = (Math.atan2(h[1], -h[0]) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}
