/**
 * Minimal HEALPix (RING scheme) tiling for slicing faint-star bins by sky
 * region. Pure functions, no dependencies — shared by scripts/build-stars.ts
 * and the front-end tile loader.
 *
 * Layout reference: 12*nside^2 pixels; rings 1..nside-1 are the north cap
 * (ring r holds 4r pixels), rings nside..3*nside are equatorial (4*nside
 * pixels each), rings 3*nside+1..4*nside-1 mirror the north cap in the south.
 * Ring r starts at pixel index 2*r*(r-1) in the north, and the south cap is
 * numbered downward from 12*nside^2 - 1.
 *
 * Equatorial-region arithmetic follows healpy's ang2pix_ring; the polar caps
 * are derived from the ring geometry (ring = jp+jm+1, azimuthal pixel = jp),
 * which reproduces the same partition and is verified by unit tests
 * (full coverage, pixel centers map back to themselves).
 */

const TWO_PI = 2 * Math.PI;

export function healpixNpix(nside: number): number {
  return 12 * nside * nside;
}

/** Ring index (1-based) and pixel-in-ring (0-based) for a pixel. */
function ringCoordinates(nside: number, pix: number): { ring: number; index: number } {
  const ncap = 2 * nside * (nside - 1);
  if (pix < ncap) {
    const ring = Math.floor((1 + Math.sqrt(1 + 2 * pix)) / 2); // 1-based, north cap
    const index = pix - 2 * ring * (ring - 1);
    return { ring, index };
  }
  const nl4 = 4 * nside;
  // Equatorial band spans rings nside..3*nside: (2*nside + 1) rings.
  const equatorialEnd = ncap + (2 * nside + 1) * nl4;
  if (pix < equatorialEnd) {
    const ring = nside + Math.floor((pix - ncap) / nl4);
    const index = (pix - ncap) % nl4;
    return { ring, index };
  }
  // South cap: mirrors the north cap, with azimuth increasing along the
  // global pixel index (verified against astropy-healpix: for nside=2,
  // pixels 44..47 sit at phi = 45, 135, 225, 315 deg like pixels 0..3).
  const ip = 12 * nside * nside - pix - 1;
  const capRing = Math.floor((1 + Math.sqrt(1 + 2 * ip)) / 2);
  const x = ip - 2 * capRing * (capRing - 1);
  return { ring: 4 * nside - capRing, index: 4 * capRing - 1 - x };
}

/**
 * Direction -> HEALPix RING pixel index.
 * z = cos(polar angle) in [-1, 1]; phi = azimuthal angle in [0, 2PI).
 */
export function ang2pixRing(nside: number, z: number, phi: number): number {
  const za = Math.abs(z);
  const ncap = 2 * nside * (nside - 1);
  const nl4 = 4 * nside;
  let tt = (phi / (Math.PI / 2)) % 4;
  if (tt < 0) tt += 4;

  if (za <= 2 / 3) {
    // Equatorial region (healpy arithmetic).
    const temp1 = nside * (0.5 + tt);
    const temp2 = nside * z * 0.75;
    const jp = Math.floor(temp1 - temp2); // index of ascending edge line
    const jm = Math.floor(temp1 + temp2); // index of descending edge line
    const ir = nside + 1 + jp - jm; // ring number counted from z = 2/3
    const kshift = ir % 2 === 0 ? 1 : 0;
    let ip = Math.floor((jp + jm - nside + kshift + 1) / 2); // 0-based in ring
    if (ip >= nl4) ip -= nl4;
    return ncap + nl4 * (ir - 1) + ip;
  }

  // Polar caps.
  const tp = tt - Math.floor(tt);
  const tmp = nside * Math.sqrt(3 * (1 - za));
  let jp = Math.floor(tp * tmp); // index from the ascending edge of the diamond
  let jm = Math.floor((1 - tp) * tmp);
  if (jp >= nside) jp = nside - 1;
  if (jm >= nside) jm = nside - 1;
  const capRing = jp + jm + 1; // 1-based ring within the cap
  // Azimuthal pixel i covers tt in [i/capRing, (i+1)/capRing).
  const i = Math.floor(tt * capRing) % (4 * capRing);
  if (z > 0) {
    // North cap: ring r starts at 2*r*(r-1).
    return 2 * capRing * (capRing - 1) + i;
  }
  // South cap: ring r (1-based from the south pole) occupies
  // [npix - 2*r*(r+1), npix - 2*r*(r+1) + 4r), phi increasing with i
  // (verified against astropy-healpix reference).
  const npix = healpixNpix(nside);
  return npix - 2 * capRing * (capRing + 1) + i;
}

/** Convenience: unit vector (right-handed basis, z = pole) -> RING pixel. */
export function vec2pixRing(nside: number, x: number, y: number, z: number): number {
  const phi = Math.atan2(y, x);
  return ang2pixRing(nside, z, phi < 0 ? phi + TWO_PI : phi);
}

/** Center direction of a RING pixel as a unit vector (same basis as inputs). */
export function pixCenterVec(nside: number, pix: number): [number, number, number] {
  const { ring, index } = ringCoordinates(nside, pix);
  let z: number;
  let phi: number;
  const pixelsInRing = ringPixelCount(nside, ring);
  if (ring < nside) {
    // North cap.
    z = 1 - ((ring * ring) * 4) / (12 * nside * nside);
    phi = (index + 0.5) * (TWO_PI / pixelsInRing);
  } else if (ring <= 3 * nside) {
    // Equatorial.
    z = (2 * nside - ring) / (1.5 * nside);
    // Adjacent rings are staggered by half a pixel in azimuth (astropy-healpix
    // reference: ring=nside centers sit at 22.5deg + k*45deg for nside=2).
    const kshift = (ring + nside) % 2 === 0 ? 0.5 : 0;
    phi = (index + kshift) * (TWO_PI / pixelsInRing);
  } else {
    // South cap.
    const capRing = 4 * nside - ring;
    z = -1 + ((capRing * capRing) * 4) / (12 * nside * nside);
    phi = (index + 0.5) * (TWO_PI / pixelsInRing);
  }
  const stheta = Math.sqrt(Math.max(0, 1 - z * z));
  return [stheta * Math.cos(phi), stheta * Math.sin(phi), z];
}

/** Pixels in each ring (1-based ring number, 1..4*nside-1). */
export function ringPixelCount(nside: number, ring: number): number {
  if (ring < nside) return 4 * ring;
  if (ring <= 3 * nside) return 4 * nside;
  return 4 * (4 * nside - ring);
}
