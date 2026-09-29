/**
 * StarField: manages one THREE.Points draw per loaded star bin/tile, all
 * sharing a single ShaderMaterial (uniforms updated once per frame).
 */
import * as THREE from 'three';
import {
  COMMON_UNIFORMS_GLSL,
  STAR_VERTEX,
  STAR_FRAGMENT,
} from './shaders';
import type { SkyFrame } from '../astro/sky';
import { buildBvLut, BV_LUT_RANGE } from '../astro/color';
import type { SkyCamera } from './projection';

export interface FrameUniforms {
  frame: SkyFrame;
  camera: SkyCamera;
  /** 0..1 atmospheric density slider. */
  atmosphere: number;
  /** Sky brightness 0..1 from moonlight (raises limiting magnitude). */
  skyBrightness: number;
  /** Pixel ratio for point sizes. */
  pixelRatio: number;
}

export class StarMaterial extends THREE.ShaderMaterial {
  constructor() {
    const lut = new THREE.DataTexture(
      buildBvLut(128, BV_LUT_RANGE),
      128,
      1,
      THREE.RGBAFormat,
    );
    lut.minFilter = THREE.LinearFilter;
    lut.magFilter = THREE.LinearFilter;
    lut.needsUpdate = true;
    super({
      vertexShader: STAR_VERTEX,
      fragmentShader: STAR_FRAGMENT,
      uniforms: {
        ...threeUniformsFromCommon(),
        uStarScale: { value: 9 },
        uLimitMag: { value: 12 },
        uExtinctionK: { value: 0.22 },
        uBvLut: { value: lut },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
  }

  updatePerFrame(u: FrameUniforms): void {
    const m = this.uniforms;
    setCommonUniforms(m, u.frame, u.camera);
    m.uStarScale!.value = 9.0 * u.pixelRatio;
    m.uExtinctionK!.value = 0.22 * u.atmosphere;
    // Sky glow from moonlight lowers the visible limit by up to 2.2 mag.
    m.uLimitMag!.value = this.limitBase - u.skyBrightness * 2.2;
  }

  /** The faintest magnitude currently loaded (set by the catalog loader). */
  limitBase = 6.5;

  setBinLimit(limitMag: number): void {
    this.limitBase = limitMag;
  }
}

/** Build a Points object from an interleaved float32 buffer (stride 7). */
export function makeStarPoints(
  buffer: ArrayBuffer,
  material: THREE.ShaderMaterial,
  key: string,
): THREE.Points {
  const floats = new Float32Array(buffer);
  const geometry = new THREE.BufferGeometry();
  const interleaved = new THREE.InterleavedBuffer(floats, 7);
  geometry.setAttribute(
    'position',
    new THREE.InterleavedBufferAttribute(interleaved, 3, 0),
  );
  geometry.setAttribute(
    'mag',
    new THREE.InterleavedBufferAttribute(interleaved, 1, 3),
  );
  geometry.setAttribute(
    'bv',
    new THREE.InterleavedBufferAttribute(interleaved, 1, 4),
  );
  geometry.setAttribute(
    'pm',
    new THREE.InterleavedBufferAttribute(interleaved, 2, 5),
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(0, 0, 0),
    10, // large: never frustum-culled (we cull in-shader)
  );
  const points = new THREE.Points(geometry, material);
  points.name = key;
  points.frustumCulled = false;
  return points;
}

// ---------------------------------------------------------------------------
// Shared uniform plumbing
// ---------------------------------------------------------------------------

export function threeUniformsFromCommon(): Record<string, THREE.IUniform> {
  return {
    uRotEqjToHor: { value: new THREE.Matrix3() },
    uBeta: { value: new THREE.Vector3() },
    uYears: { value: 0 },
    uCamCenter: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3() },
    uScaleTan: { value: 1 },
    uAspect: { value: 1 },
  };
}

export function setCommonUniforms(
  uniforms: Record<string, THREE.IUniform>,
  frame: SkyFrame,
  camera: SkyCamera,
): void {
  const rot = frame.rotEqjToHor;
  (uniforms.uRotEqjToHor!.value as THREE.Matrix3).set(
    rot[0],
    rot[1],
    rot[2],
    rot[3],
    rot[4],
    rot[5],
    rot[6],
    rot[7],
    rot[8],
  );
  (uniforms.uBeta!.value as THREE.Vector3).set(...frame.betaEqj);
  uniforms.uYears!.value = frame.yearsSinceEpoch;
  (uniforms.uCamCenter!.value as THREE.Vector3).set(...camera.centerHor);
  (uniforms.uCamUp!.value as THREE.Vector3).set(...camera.upHor);
  (uniforms.uCamRight!.value as THREE.Vector3).set(...camera.rightHor);
  uniforms.uScaleTan!.value = camera.scaleTan;
  uniforms.uAspect!.value = camera.aspect;
}

export { COMMON_UNIFORMS_GLSL };
