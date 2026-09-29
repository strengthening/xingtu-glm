/**
 * Sun, Moon and planets. Positions are recomputed on the CPU every frame
 * (nine bodies, cheap), rotated into the horizontal frame, and drawn as a
 * small dynamic Points buffer: glowing point for planets, a bright disk for
 * the Sun, and a disk with an approximate phase terminator for the Moon.
 */
import * as THREE from 'three';
import { solarSystemBodies, type BodyInfo } from '../astro/solarSystem';
import type { Mat3, Observer, Vec3 } from '../astro/types';
import type { SkyCamera } from './projection';
import { mulMat3, transposeMat3, mat3FromAstroRotation } from '../astro/coords';
import * as Astro from 'astronomy-engine';
import type { SkyFrame } from '../astro/sky';

const BODY_VERTEX = /* glsl */ `
attribute vec3 dir;      // horizontal-frame direction
attribute float size;    // device px
attribute vec3 color;
attribute float kind;    // 0 glow point, 1 sun disk, 2 moon disk

uniform vec3 uCamCenter;
uniform vec3 uCamUp;
uniform vec3 uCamRight;
uniform float uScaleTan;
uniform float uAspect;

varying vec3 vColor;
varying float vKind;

void main() {
  vec3 h = dir;
  vColor = color;
  vKind = kind;
  float z = dot(h, uCamCenter);
  if (z <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  float sinTheta = sqrt(max(0.0, 1.0 - z * z));
  float r = (sinTheta / (1.0 + z)) / uScaleTan;
  float px = dot(h, uCamRight) / sinTheta * r;
  float py = dot(h, uCamUp) / sinTheta * r;
  gl_Position = vec4(px / uAspect, py, 0.0, 1.0);
  gl_PointSize = size;
}
`;

const BODY_FRAGMENT = /* glsl */ `
precision mediump float;
uniform float uSunScreenX;  // sun x offset on screen relative to the moon (>0 right)
uniform float uPhase;       // moon illuminated fraction 0..1
varying vec3 vColor;
varying float vKind;

void main() {
  vec2 q = gl_PointCoord - 0.5;
  float t = length(q) * 2.0;
  if (vKind < 0.5) {
    // Planet: core + halo glow.
    float core = exp(-t * t * 9.0);
    float halo = exp(-t * t * 2.2) * 0.35;
    float a = core + halo;
    if (a < 0.01) discard;
    gl_FragColor = vec4(mix(vColor, vec3(1.0), core * 0.5), a);
  } else if (vKind < 1.5) {
    // Sun: bright disk with soft edge and wide glow.
    float disk = 1.0 - smoothstep(0.55, 1.0, t);
    float glow = exp(-t * t * 1.2) * 0.5;
    float a = disk + glow;
    if (a < 0.01) discard;
    gl_FragColor = vec3(1.0, 0.96, 0.86) * a;
  } else {
    // Moon: disk with an approximate terminator.
    float disk = 1.0 - smoothstep(0.88, 1.0, t);
    if (disk <= 0.0) discard;
    // c: -1 full, 0 quarter, +1 new. x is measured toward the sun side.
    float c = 1.0 - 2.0 * clamp(uPhase, 0.0, 1.0);
    float x = q.x * (uSunScreenX >= 0.0 ? 1.0 : -1.0);
    float lit = smoothstep(-0.03, 0.03, x - c);
    float shade = mix(0.28, 1.0, lit);
    gl_FragColor = vec4(vColor * shade * disk, disk);
  }
}
`;

export class SolarSystemRenderer {
  group = new THREE.Group();
  bodies: BodyInfo[] = [];
  /** Bodies with directions rotated into the horizontal frame, for picking/labels. */
  bodiesHor: { info: BodyInfo; dirHor: Vec3 }[] = [];

  private points: THREE.Points;
  private material: THREE.ShaderMaterial;
  private heightPx = 800;
  private pixelRatio = 1;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: BODY_VERTEX,
      fragmentShader: BODY_FRAGMENT,
      uniforms: {
        uCamCenter: { value: new THREE.Vector3() },
        uCamUp: { value: new THREE.Vector3() },
        uCamRight: { value: new THREE.Vector3() },
        uScaleTan: { value: 1 },
        uAspect: { value: 1 },
        uSunScreenX: { value: 1 },
        uPhase: { value: 0.5 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const n = 9;
    const dirAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    const geo = new THREE.BufferGeometry();
    // THREE needs a `position` attribute to issue the draw call; alias `dir`.
    geo.setAttribute('position', dirAttr);
    geo.setAttribute('dir', dirAttr);
    geo.setAttribute('size', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('kind', new THREE.BufferAttribute(new Float32Array(n), 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.group.add(this.points);
  }

  setViewport(heightPx: number, pixelRatio: number): void {
    this.heightPx = heightPx;
    this.pixelRatio = pixelRatio;
  }

  update(frame: SkyFrame, camera: SkyCamera): void {
    const date = frame.date;
    const observer: Observer = frame.observer;
    this.bodies = solarSystemBodies(date, observer);
    // EQD -> HOR = (EQJ->HOR) * (EQD->EQJ)
    const time = Astro.MakeTime(date);
    const eqdToHor: Mat3 = mulMat3(
      frame.rotEqjToHor,
      transposeMat3(mat3FromAstroRotation(Astro.Rotation_EQJ_EQD(time))),
    );

    const geo = this.points.geometry;
    const dir = geo.getAttribute('dir') as THREE.BufferAttribute;
    const size = geo.getAttribute('size') as THREE.BufferAttribute;
    const color = geo.getAttribute('color') as THREE.BufferAttribute;
    const kind = geo.getAttribute('kind') as THREE.BufferAttribute;

    this.bodiesHor = [];
    let sunScreenX = 1;
    this.bodies.forEach((b, i) => {
      const d = b.dirEqd;
      const h: Vec3 = [
        eqdToHor[0]! * d[0] + eqdToHor[1]! * d[1] + eqdToHor[2]! * d[2],
        eqdToHor[3]! * d[0] + eqdToHor[4]! * d[1] + eqdToHor[5]! * d[2],
        eqdToHor[6]! * d[0] + eqdToHor[7]! * d[1] + eqdToHor[8]! * d[2],
      ];
      this.bodiesHor.push({ info: b, dirHor: h });

      const diskPx = (b.angularDiameterDeg / camera.fovDeg) * this.heightPx;
      if (b.key === 'sun') {
        size.setX(i, Math.max(30, diskPx) * this.pixelRatio);
        kind.setX(i, 1);
        color.setXYZ(i, 1, 0.97, 0.86);
      } else if (b.key === 'moon') {
        size.setX(i, Math.max(24, diskPx) * this.pixelRatio);
        kind.setX(i, 2);
        color.setXYZ(i, 0.98, 0.96, 0.9);
      } else {
        const glow = Math.max(3.0, 10.0 - b.magnitude * 0.6);
        size.setX(i, glow * 1.6 * this.pixelRatio);
        kind.setX(i, 0);
        // Warm gas giants, cool inner rocky planets (rough flavor).
        if (b.key === 'mars') color.setXYZ(i, 1.0, 0.72, 0.55);
        else if (b.key === 'jupiter' || b.key === 'saturn') color.setXYZ(i, 1.0, 0.9, 0.72);
        else if (b.key === 'venus') color.setXYZ(i, 1.0, 0.96, 0.86);
        else color.setXYZ(i, 0.85, 0.9, 1.0);
      }
      if (b.key !== 'sun') {
        // On-screen x offset of the sun relative to this body, for phase.
        void h;
      }
    });
    dir.needsUpdate = true;
    size.needsUpdate = true;
    color.needsUpdate = true;
    kind.needsUpdate = true;
    geo.setDrawRange(0, this.bodies.length);

    // Sun's screen-x sign relative to the moon (for the terminator).
    const sun = this.bodiesHor.find((b) => b.info.key === 'sun');
    const moon = this.bodiesHor.find((b) => b.info.key === 'moon');
    if (sun && moon) {
      const sx = dot(sun.dirHor, camera.rightHor) - dot(moon.dirHor, camera.rightHor);
      sunScreenX = sx >= 0 ? 1 : -1;
    }

    const u = this.material.uniforms;
    (u.uCamCenter!.value as THREE.Vector3).set(...camera.centerHor);
    (u.uCamUp!.value as THREE.Vector3).set(...camera.upHor);
    (u.uCamRight!.value as THREE.Vector3).set(...camera.rightHor);
    u.uScaleTan!.value = camera.scaleTan;
    u.uAspect!.value = camera.aspect;
    u.uSunScreenX!.value = sunScreenX;
    u.uPhase!.value = moon ? moon.info.phase : 0.5;
  }
}

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
