/**
 * SkyCamera: the view state (center direction in the horizontal frame + FOV)
 * and the stereographic projection shared by every render pass and by the
 * CPU-side projection used for DOM labels and picking.
 *
 * Stereographic projection (Stellarium's default): the unit sphere is viewed
 * from inside; a direction at angular distance theta from the view center is
 * drawn at planar radius tan(theta/2), so the vertical half-FOV maps to
 * tan(fov/4). Lens spans up to ~300 degrees without tearing.
 */
import type { Mat3, Vec3 } from '../astro/types';
import { cross, normalize } from '../astro/coords';

export interface SkyCameraState {
  /** Center direction in the horizontal frame (unit vector). */
  centerHor: Vec3;
  /** Vertical field of view in degrees. */
  fovDeg: number;
}

export class SkyCamera {
  centerHor: Vec3 = [0, 0, 1];
  fovDeg = 90;
  /** Full display width / height. */
  aspect = 1;
  /** Basis vectors in the horizontal frame, recomputed on update(). */
  rightHor: Vec3 = [1, 0, 0];
  upHor: Vec3 = [0, 1, 0];

  constructor() {
    this.updateBasis();
  }

  setCenter(centerHor: Vec3): void {
    this.centerHor = normalize(centerHor);
    this.updateBasis();
  }

  setFov(fovDeg: number): void {
    this.fovDeg = Math.min(300, Math.max(0.04, fovDeg));
  }

  setAspect(aspect: number): void {
    this.aspect = aspect;
  }

  private updateBasis(): void {
    // right = center x worldUp (east-ish); degenerate near zenith/nadir.
    const c = this.centerHor;
    const upWorld: Vec3 = [0, 0, 1];
    let r = cross(upWorld, c);
    if (Math.hypot(r[0], r[1], r[2]) < 1e-6) {
      r = [1, 0, 0]; // looking straight up/down: pick arbitrary azimuth
    }
    this.rightHor = normalize(r);
    this.upHor = normalize(cross(c, this.rightHor));
  }

  /** tan(fov/4): NDC half-height corresponds to this planar radius. */
  get scaleTan(): number {
    return Math.tan((this.fovDeg * Math.PI) / 180 / 4);
  }

  /**
   * Project a direction in the horizontal frame to NDC-ish coordinates
   * (x in [-aspect, aspect], y in [-1, 1]); returns null when the direction
   * is behind the camera (>90 deg from center) or outside the viewport.
   */
  project(dirHor: Vec3): { x: number; y: number } | null {
    const z = dot3(dirHor, this.centerHor);
    if (z <= 0.002) return null; // stereographic covers exactly a hemisphere
    const sinTheta = Math.sqrt(Math.max(0, 1 - z * z));
    const r = (sinTheta / (1 + z)) / this.scaleTan;
    const px = (dot3(dirHor, this.rightHor) / sinTheta) * r;
    const py = (dot3(dirHor, this.upHor) / sinTheta) * r;
    if (Math.abs(px) > this.aspect + 0.05 || Math.abs(py) > 1.05) return null;
    return { x: px, y: py };
  }

  /** Screen pixel position (CSS pixels) for a horizontal direction. */
  projectToPixels(
    dirHor: Vec3,
    widthPx: number,
    heightPx: number,
  ): { x: number; y: number } | null {
    const p = this.project(dirHor);
    if (!p) return null;
    return {
      x: (p.x / this.aspect + 1) * 0.5 * widthPx,
      y: (1 - p.y) * 0.5 * heightPx,
    };
  }

  /**
   * Inverse: NDC point -> horizontal-frame direction (the inverse
   * stereographic), used for click picking.
   */
  unproject(ndcX: number, ndcY: number): Vec3 {
    // NDC -> planar coordinates with half-height = 1.
    const px = ndcX * this.aspect;
    const py = ndcY;
    const r = Math.hypot(px, py);
    if (r < 1e-9) return this.centerHor;
    const theta = 2 * Math.atan(r * this.scaleTan);
    const sinTheta = Math.sin(theta);
    const dir: Vec3 = [
      this.centerHor[0] * Math.cos(theta) +
        (this.rightHor[0] * px + this.upHor[0] * py) / r * sinTheta,
      this.centerHor[1] * Math.cos(theta) +
        (this.rightHor[1] * px + this.upHor[1] * py) / r * sinTheta,
      this.centerHor[2] * Math.cos(theta) +
        (this.rightHor[2] * px + this.upHor[2] * py) / r * sinTheta,
    ];
    return normalize(dir);
  }

  /** NDC -> pixels helper for pointer events. */
  static eventToNdc(
    offsetX: number,
    offsetY: number,
    widthPx: number,
    heightPx: number,
  ): [number, number] {
    return [(offsetX / widthPx) * 2 - 1, 1 - (offsetY / heightPx) * 2];
  }
}

/** Apply a row-major 3x3 matrix to a vector (kept local; avoids imports). */
export function applyMat3(m: Mat3, v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[1]! * v[1] + m[2]! * v[2],
    m[3]! * v[0] + m[4]! * v[1] + m[5]! * v[2],
    m[6]! * v[0] + m[7]! * v[1] + m[8]! * v[2],
  ];
}

function dot3(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
