/** Shared types for the astronomy layer. No Three.js allowed in src/astro. */

/** Geographic observer: degrees, north/east positive, meters above sea level. */
export interface Observer {
  latitude: number;
  longitude: number;
  elevation: number;
}

export interface GeoPlace {
  id: string;
  name: string;
  latitude: number;
  longitude: number;
  elevation: number;
  hemisphere: 'north' | 'south';
}

/** Equatorial spherical coordinates in degrees. */
export interface EquatorialCoord {
  ra: number;
  dec: number;
}

/** Horizontal coordinates in degrees; azimuth measured from north through east. */
export interface HorizontalCoord {
  altitude: number;
  azimuth: number;
}

/** Immutable 3-vector. */
export type Vec3 = readonly [number, number, number];

/** Row-major 3x3 matrix: m[row * 3 + col]. */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];
