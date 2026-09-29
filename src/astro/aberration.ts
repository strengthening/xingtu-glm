/**
 * Observer velocity for stellar aberration, expressed as beta = v/c in the
 * ICRS (EQJ) frame.
 *
 * Includes the dominant annual term (Earth heliocentric orbital motion,
 * ~29.8 km/s -> 20.5" aberration) and the diurnal term (Earth rotation at the
 * observer's latitude, up to 0.465 km/s -> 0.32" at the equator).
 *
 * First-order aberration applied downstream: n' = n + beta - (beta.n) n
 * which is accurate to ~beta^2 ~ 1 mas. Good enough for sub-arcsecond goals.
 */
import * as Astro from 'astronomy-engine';
import type { Observer, Vec3 } from './types';
import { cross } from './coords';

/** Speed of light in AU/day. */
const C_AU_PER_DAY = 173.14463268466918;

/** Earth angular rotation rate, rad/s (sidereal day = 86164.0905 s). */
const OMEGA_EARTH = (2 * Math.PI) / 86164.0905;

const SECONDS_PER_DAY = 86400;

/** Earth heliocentric velocity in AU/day, ICRS frame, via central difference. */
export function earthVelocityEqj(time: Astro.AstroTime): Vec3 {
  const dt = 0.5; // days
  const t1 = new Astro.AstroTime(time.ut - dt);
  const t2 = new Astro.AstroTime(time.ut + dt);
  const p1 = Astro.HelioVector(Astro.Body.Earth, t1);
  const p2 = Astro.HelioVector(Astro.Body.Earth, t2);
  const inv = SECONDS_PER_DAY / (2 * dt * SECONDS_PER_DAY); // per day
  return [
    (p2.x - p1.x) * inv,
    (p2.y - p1.y) * inv,
    (p2.z - p1.z) * inv,
  ];
}

/**
 * Total observer beta (v/c) in ICRS: annual + diurnal terms.
 * Valid near `time` (within hours); call refresh from the render loop as
 * time advances.
 */
export function observerBetaEqj(time: Astro.AstroTime, observer: Observer): Vec3 {
  const vEarth = earthVelocityEqj(time); // AU/day

  // Observer geocentric position in ICRS, AU.
  const robs = Astro.ObserverVector(time, makeAstroObserver(observer), false);
  // Rotation carries the observer eastward: v = omega x r, omega ~ +z (celestial north).
  const rVec: Vec3 = [robs.x, robs.y, robs.z];
  const wVec: Vec3 = [0, 0, OMEGA_EARTH * SECONDS_PER_DAY]; // rad*AU/day... see note
  const vRot = cross(wVec, rVec); // AU/day * (rad/day? -> rad AU/day, small-angle fine)

  return [
    (vEarth[0] + vRot[0]) / C_AU_PER_DAY,
    (vEarth[1] + vRot[1]) / C_AU_PER_DAY,
    (vEarth[2] + vRot[2]) / C_AU_PER_DAY,
  ];
}

export function makeAstroObserver(observer: Observer): Astro.Observer {
  return new Astro.Observer(observer.latitude, observer.longitude, observer.elevation);
}
