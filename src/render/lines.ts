/**
 * Line passes on the unit sphere: equatorial grid, horizon grid,
 * constellation lines. Two flavors of materials — vertices in J2000 (EQJ) or
 * already in the horizontal frame — both projecting via the shared
 * stereographic shader.
 */
import * as THREE from 'three';
import { LINE_EQJ_VERTEX, LINE_HOR_VERTEX, LINE_FRAGMENT } from './shaders';
import { setCommonUniforms, threeUniformsFromCommon } from './starfield';
import type { SkyFrame } from '../astro/sky';
import type { SkyCamera } from './projection';
import type { Vec3 } from '../astro/types';
import { unitVectorFromRaDec } from '../astro/coords';

function lineMaterial(eqj: boolean, color: number, opacity: number): THREE.ShaderMaterial {
  const uniforms: Record<string, THREE.IUniform> = eqj
    ? threeUniformsFromCommon()
    : {
        uCamCenter2: { value: new THREE.Vector3() },
        uCamUp2: { value: new THREE.Vector3() },
        uCamRight2: { value: new THREE.Vector3() },
        uScaleTan2: { value: 1 },
        uAspect2: { value: 1 },
      };
  uniforms.uLineColor = {
    value: new THREE.Vector4(
      ((color >> 16) & 0xff) / 255,
      ((color >> 8) & 0xff) / 255,
      (color & 0xff) / 255,
      opacity,
    ),
  };
  return new THREE.ShaderMaterial({
    vertexShader: eqj ? LINE_EQJ_VERTEX : LINE_HOR_VERTEX,
    fragmentShader: LINE_FRAGMENT,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

/** Update the per-frame uniforms of a line material. */
export function updateLineMaterial(
  material: THREE.ShaderMaterial,
  frame: SkyFrame,
  camera: SkyCamera,
  eqj: boolean,
): void {
  if (eqj) {
    setCommonUniforms(material.uniforms, frame, camera);
  } else {
    const u = material.uniforms;
    (u.uCamCenter2!.value as THREE.Vector3).set(...camera.centerHor);
    (u.uCamUp2!.value as THREE.Vector3).set(...camera.upHor);
    (u.uCamRight2!.value as THREE.Vector3).set(...camera.rightHor);
    u.uScaleTan2!.value = camera.scaleTan;
    u.uAspect2!.value = camera.aspect;
  }
}

function segmentsFromDirs(dirs: Vec3[]): THREE.BufferGeometry {
  const floats = new Float32Array(dirs.length * 3);
  dirs.forEach((d, i) => {
    floats[i * 3] = d[0];
    floats[i * 3 + 1] = d[1];
    floats[i * 3 + 2] = d[2];
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(floats, 3));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
  return geo;
}

/** Great-circle polyline subdivided every ~1.5 degrees. */
function arcPoints(a: Vec3, b: Vec3, maxDeg: number): Vec3[] {
  const dotv = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  const angle = Math.acos(dotv);
  const steps = Math.max(2, Math.ceil((angle * 180) / Math.PI / maxDeg));
  const pts: Vec3[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const x = a[0] * (1 - t) + b[0] * t;
    const y = a[1] * (1 - t) + b[1] * t;
    const z = a[2] * (1 - t) + b[2] * t;
    const n = Math.hypot(x, y, z);
    pts.push([x / n, y / n, z / n]);
  }
  return pts;
}

/** Build the equatorial grid: parallels + meridians (J2000 frame). */
export function buildEquatorialGrid(): THREE.LineSegments {
  const material = lineMaterial(true, 0x3a6ea5, 0.5);
  const dirs: Vec3[] = [];
  // Parallels every 30 deg, plus the equator handled separately below.
  for (let dec = -60; dec <= 60; dec += 30) {
    if (dec === 0) continue;
    const n = 180;
    for (let i = 0; i < n; i++) {
      const ra1 = (i / n) * 360;
      const ra2 = ((i + 1) / n) * 360;
      dirs.push(unitVectorFromRaDec(ra1, dec), unitVectorFromRaDec(ra2, dec));
    }
  }
  // Equator brighter (separate object not needed: same color).
  {
    const n = 240;
    for (let i = 0; i < n; i++) {
      dirs.push(unitVectorFromRaDec((i / n) * 360, 0), unitVectorFromRaDec(((i + 1) / n) * 360, 0));
    }
  }
  // Meridians every 30 deg (2h).
  for (let ra = 0; ra < 360; ra += 30) {
    for (let dec = -88; dec < 88; dec += 4) {
      dirs.push(unitVectorFromRaDec(ra, dec), unitVectorFromRaDec(ra, dec + 4));
    }
  }
  const geo = segmentsFromDirs(dirs);
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  lines.renderOrder = 4;
  return lines;
}

/** Horizon/altitude grid in the horizontal frame. */
export function buildHorizonGrid(): THREE.LineSegments {
  const material = lineMaterial(false, 0x5a8a4a, 0.45);
  const dirs: Vec3[] = [];
  const hor = (alt: number, az: number): Vec3 => {
    const a = (alt * Math.PI) / 180;
    const z = (az * Math.PI) / 180;
    const ca = Math.cos(a);
    return [-ca * Math.cos(z), ca * Math.sin(z), Math.sin(a)];
  };
  // Altitude circles every 30 deg up to ±60, plus horizon itself.
  for (const alt of [-60, -30, 0, 30, 60]) {
    const n = 240;
    for (let i = 0; i < n; i++) {
      dirs.push(hor(alt, (i / n) * 360), hor(alt, ((i + 1) / n) * 360));
    }
  }
  // Azimuth meridians every 30 deg.
  for (let az = 0; az < 360; az += 30) {
    for (let alt = -84; alt < 84; alt += 4) {
      dirs.push(hor(alt, az), hor(alt + 4, az));
    }
  }
  const geo = segmentsFromDirs(dirs);
  const lines = new THREE.LineSegments(geo, material);
  lines.frustumCulled = false;
  lines.renderOrder = 4;
  return lines;
}

export { arcPoints, lineMaterial, segmentsFromDirs };
