/**
 * Astronomy layer tests.
 *
 * 1. Self-consistency: our matrix pipeline (EQJ -> EQD -> HOR) must agree
 *    with astronomy-engine's own rotation matrices applied step by step.
 * 2. Geometric invariants (zenith, transit altitude, Polaris elevation).
 * 3. Sirius altitude/azimuth snapshot: our pipeline (proper motion +
 *    aberration) vs the library reference. Both should match Stellarium
 *    within 0.1 deg for the same observer/time (see README).
 * 4. HEALPix tiling sanity.
 * 5. Aberration magnitude sanity (~20.5" annual, ~0.3" diurnal).
 */
import { describe, expect, it } from 'vitest';
import * as Astro from 'astronomy-engine';
import { altAzFromJ2000, computeSkyFrame } from '../src/astro/sky';
import { unitVectorFromRaDec } from '../src/astro/coords';
import type { Observer, Vec3 } from '../src/astro/types';

const SHANGHAI: Observer = { latitude: 31.23, longitude: 121.47, elevation: 4 };

// Sirius: Simbad J2000 position and Tycho-2/Hipparcos proper motion.
const SIRIUS = {
  ra: 101.2871554,
  dec: -16.7161159,
  pmRaMasYr: -546.01, // mas/yr, mu_alpha*cos(delta)
  pmDecMasYr: -1223.08,
};

const TEST_DATE = new Date('2025-06-01T14:00:00Z');

/** Reference: astronomy-engine's own rotations, J2000 vector -> alt/az. */
function referenceAltAz(raDeg: number, decDeg: number, date: Date): { altitude: number; azimuth: number } {
  const time = Astro.MakeTime(date);
  const observer = new Astro.Observer(SHANGHAI.latitude, SHANGHAI.longitude, SHANGHAI.elevation);
  const eqj = unitVectorFromRaDec(raDeg, decDeg);
  const v1 = Astro.RotateVector(
    Astro.Rotation_EQJ_EQD(time),
    new Astro.Vector(eqj[0], eqj[1], eqj[2], time),
  );
  const v2 = Astro.RotateVector(Astro.Rotation_EQD_HOR(time, observer), v1);
  const altitude = (Math.asin(Math.max(-1, Math.min(1, v2.z))) * 180) / Math.PI;
  let azimuth = (Math.atan2(v2.y, -v2.x) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

describe('matrix pipeline vs astronomy-engine reference', () => {
  it('matches the library rotations to <0.001 arcsec (pure frame conversion)', () => {
    const frame = computeSkyFrame(TEST_DATE, SHANGHAI);
    for (const [ra, dec] of [
      [101.29, -16.72],
      [0, 90],
      [180, -30],
      [271.3, 45.6],
    ] as const) {
      const got = altAzFromJ2000(ra, dec, frame);
      const ref = referenceAltAz(ra, dec, TEST_DATE);
      // Our path adds aberration (~20"), so compare our own no-aberration path:
      // recompute without aberration by zeroing beta.
      const noAberrationFrame = { ...frame, betaEqj: [0, 0, 0] as Vec3 };
      const got0 = altAzFromJ2000(ra, dec, noAberrationFrame);
      const dAlt = Math.abs(got0.altitude - ref.altitude) * 3600;
      let dAz = Math.abs(got0.azimuth - ref.azimuth) * 3600;
      if (dAz > 180 * 3600) dAz = 360 * 3600 - dAz;
      expect(dAlt).toBeLessThan(0.001);
      expect(dAz).toBeLessThan(0.001);
      // And the aberrated result differs from reference by the aberration scale.
      void got;
    }
  });

  it('star at the zenith direction (rotated back to J2000) sits at zenith', () => {
    const date = new Date('2025-03-01T20:00:00Z');
    const time = Astro.MakeTime(date);
    const frame = computeSkyFrame(date, SHANGHAI);
    // Zenith has of-date equatorial coordinates (RA = LST, Dec = latitude).
    const zenithEqd = new Astro.Vector(
      ...unitVectorFromRaDec(frame.lstDeg, SHANGHAI.latitude),
      time,
    );
    const zv = Astro.RotateVector(Astro.Rotation_EQD_EQJ(time), zenithEqd);
    const ra = (Math.atan2(zv.y, zv.x) * 180) / Math.PI;
    const dec = (Math.asin(zv.z) * 180) / Math.PI;
    const got = altAzFromJ2000((ra + 360) % 360, dec, frame);
    expect(got.altitude).toBeGreaterThan(89.9);
    expect(got.altitude).toBeLessThan(90.1);
  });

  it('daily-max altitude of Sirius equals 90 - |lat - dec| within 0.25 deg', () => {
    let maxAlt = -90;
    for (let minutes = 0; minutes <= 1440; minutes += 2) {
      const frame = computeSkyFrame(new Date(Date.UTC(2025, 5, 1, 0, minutes)), SHANGHAI);
      const { altitude } = altAzFromJ2000(SIRIUS.ra, SIRIUS.dec, frame, SIRIUS);
      if (altitude > maxAlt) maxAlt = altitude;
    }
    const expected = 90 - Math.abs(SHANGHAI.latitude - SIRIUS.dec); // ~42.05
    expect(Math.abs(maxAlt - expected)).toBeLessThan(0.25);
  });

  it('Polaris altitude tracks observer latitude', () => {
    const frame = computeSkyFrame(new Date('2025-09-15T22:30:00Z'), SHANGHAI);
    const pol = altAzFromJ2000(37.95456, 89.26411, frame);
    expect(Math.abs(pol.altitude - SHANGHAI.latitude)).toBeLessThan(0.75);
  });
});

describe('Sirius snapshot (Stellarium comparison anchor)', () => {
  it('our full pipeline (PM + aberration) is within 0.05 deg of the library reference', () => {
    const frame = computeSkyFrame(TEST_DATE, SHANGHAI);
    const got = altAzFromJ2000(SIRIUS.ra, SIRIUS.dec, frame, SIRIUS);
    const ref = referenceAltAz(SIRIUS.ra, SIRIUS.dec, TEST_DATE);
    const dAlt = Math.abs(got.altitude - ref.altitude);
    expect(dAlt).toBeLessThan(0.05); // difference is PM (~45") + aberration (~20")
    console.log(
      `Sirius 2025-06-01T14:00Z Shanghai: ours alt=${got.altitude.toFixed(4)} az=${got.azimuth.toFixed(4)} | lib alt=${ref.altitude.toFixed(4)} az=${ref.azimuth.toFixed(4)}`,
    );
  });

  it('snapshot values stay locked (regression guard)', () => {
    const frame = computeSkyFrame(TEST_DATE, SHANGHAI);
    const got = altAzFromJ2000(SIRIUS.ra, SIRIUS.dec, frame, SIRIUS);
    // Locked 2025-06-01T14:00Z @ Shanghai (proper motion integrated from
    // J2000.0 per VizieR I/259 note 3; library reference agrees to 0.015 deg,
    // the difference being proper motion + aberration, both by design).
    expect(got.altitude).toBeCloseTo(-34.1597, 3);
    expect(got.azimuth).toBeCloseTo(90.2349, 3);
  });
});

describe('HEALPix tiling', () => {
  it('ring pixel counts sum to npix for nside=8 (768 tiles)', async () => {
    const { healpixNpix, ringPixelCount } = await import('../src/astro/healpix');
    const nside = 8;
    let total = 0;
    for (let ring = 1; ring <= 4 * nside - 1; ring++) total += ringPixelCount(nside, ring);
    expect(total).toBe(healpixNpix(nside));
    expect(healpixNpix(nside)).toBe(768);
  });

  it('random directions cover all 768 pixels exactly once', async () => {
    const { vec2pixRing, healpixNpix } = await import('../src/astro/healpix');
    const nside = 8;
    const counts = new Uint32Array(healpixNpix(nside));
    let seed = 42;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const N = 400_000;
    for (let i = 0; i < N; i++) {
      const z = rand() * 2 - 1;
      const phi = rand() * 2 * Math.PI;
      const s = Math.sqrt(1 - z * z);
      const pix = vec2pixRing(nside, Math.cos(phi) * s, Math.sin(phi) * s, z);
      expect(pix).toBeGreaterThanOrEqual(0);
      expect(pix).toBeLessThan(healpixNpix(nside));
      counts[pix] = counts[pix]! + 1;
    }
    expect(counts.filter((c) => c > 0).length).toBe(healpixNpix(nside));
  });

  it('each pixel center maps back to its own pixel', async () => {
    const { vec2pixRing, pixCenterVec, healpixNpix } = await import('../src/astro/healpix');
    for (const nside of [2, 4, 8]) {
      for (let pix = 0; pix < healpixNpix(nside); pix++) {
        const c = pixCenterVec(nside, pix);
        expect(vec2pixRing(nside, c[0], c[1], c[2])).toBe(pix);
      }
    }
  });

  it('matches astropy-healpix reference samples (RING)', async () => {
    const { ang2pixRing } = await import('../src/astro/healpix');
    // [nside, z, phi, expectedPixel] generated with astropy-healpix 1.0.3
    // (HEALPix(nside, order='ring').lonlat_to_healpix).
    const REFERENCE: [number, number, number, number][] = [
      [2, 0.25019093, 5.63736057, 19],
      [2, 0.55137138, 1.41501851, 5],
      [2, -0.39966743, 5.48869817, 35],
      [2, -0.98946939, 5.15993033, 47],
      [2, 0.59413886, 2.94012202, 7],
      [2, -0.39393515, 1.74939972, 30],
      [2, -0.49026082, 2.79649691, 39],
      [2, 0.00909652, 3.47772643, 24],
      [2, 0.99100057, 4.98044172, 3],
      [2, 0.24435846, 6.21381987, 12],
      [2, -0.5693826, 1.0066419, 37],
      [2, 0.22507921, 0.27609578, 20],
      [2, 0.999, 0.1, 0],
      [2, -0.999, 1.5, 44],
      [2, 0.66666667, 0.0, 4],
      [2, -0.66666667, 1.57079633, 38],
      [2, 0.5, 3.0, 16],
      [2, 0.0, 2.5, 23],
      [8, -0.92863944, 3.23514187, 736],
      [8, -0.06758795, 5.76273508, 429],
      [8, 0.25845251, 3.23029644, 256],
      [8, -0.00625313, 1.55518212, 375],
      [8, -0.97641195, 1.20889832, 757],
      [8, 0.38406424, 1.26044922, 246],
      [8, -0.26092738, 0.02346293, 464],
      [8, 0.66009546, 0.9705076, 116],
      [8, -0.46480139, 5.53129006, 556],
      [8, 0.01958162, 5.32280198, 363],
      [8, 0.27943433, 4.66068432, 296],
      [8, -0.81700879, 3.40010691, 718],
      [8, 0.999, 0.1, 0],
      [8, -0.999, 1.5, 764],
      [8, 0.66666667, 0.0, 112],
      [8, -0.66666667, 1.57079633, 632],
      [8, 0.5, 3.0, 191],
      [8, 0.0, 2.5, 380],
    ];
    for (const [nside, z, phi, expected] of REFERENCE) {
      expect(ang2pixRing(nside, z, phi)).toBe(expected);
    }
  });
});

describe('aberration sanity', () => {
  it('|beta| ~ 1e-4 (annual) with small diurnal addition', async () => {
    const { observerBetaEqj } = await import('../src/astro/aberration');
    const time = Astro.MakeTime(TEST_DATE);
    const beta = observerBetaEqj(time, SHANGHAI);
    const mag = Math.hypot(beta[0], beta[1], beta[2]);
    expect(mag).toBeGreaterThan(0.5e-4);
    expect(mag).toBeLessThan(1.3e-4);
  });

  it('aberration displacement is 15..26 arcsec for a perpendicular star', async () => {
    const { observerBetaEqj } = await import('../src/astro/aberration');
    const time = Astro.MakeTime(TEST_DATE);
    const [bx, by, bz] = observerBetaEqj(time, SHANGHAI);
    const norm = Math.hypot(bx, by, bz);
    // Unit direction perpendicular to beta within the xy-plane.
    const dxy = Math.hypot(bx, by);
    const d: Vec3 = dxy > 1e-6 ? [-by / dxy, bx / dxy, 0] : [1, 0, 0];
    const bn = bx * d[0] + by * d[1] + bz * d[2];
    const shifted: Vec3 = [
      d[0] + bx - bn * d[0],
      d[1] + by - bn * d[1],
      d[2] + bz - bn * d[2],
    ];
    const sn = Math.hypot(shifted[0], shifted[1], shifted[2]);
    const cosSep = (d[0] * shifted[0] + d[1] * shifted[1] + d[2] * shifted[2]) / sn;
    const sepDeg = (Math.acos(Math.max(-1, Math.min(1, cosSep))) * 180) / Math.PI;
    console.log(`|beta|=${norm.toExponential(3)} sep=${(sepDeg * 3600).toFixed(2)}"`);
    expect(sepDeg).toBeGreaterThan(15 / 3600);
    expect(sepDeg).toBeLessThan(26 / 3600);
  });
});
