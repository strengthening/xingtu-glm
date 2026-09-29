/**
 * Horizon system: the horizon circle, the ground occlusion disk, and the
 * cardinal-direction anchors (rendered as DOM labels by the label pass).
 *
 * In the stereographic projection, "below the horizon" (theta > 90 deg)
 * covers the plane outside the circle r = 1/scaleTan (in NDC half-height
 * units) — the ground is a full-screen quad whose fragment shader discards
 * the inside of that circle.
 */
import * as THREE from 'three';
import type { SkyCamera } from './projection';
import type { Vec3 } from '../astro/types';

export const GROUND_VERTEX = /* glsl */ `
varying vec2 vNdc;
void main() {
  vNdc = position.xy;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

export const GROUND_FRAGMENT = /* glsl */ `
precision mediump float;
varying vec2 vNdc;
uniform float uAspect;
uniform float uHorizonR;   // horizon circle radius in NDC units (half-height=1)
uniform float uGroundOpacity;
uniform vec3 uGroundColor;
void main() {
  float r = length(vec2(vNdc.x * uAspect, vNdc.y));
  float edge = uHorizonR;
  if (r < edge - 0.012) discard;
  float glow = exp(-max(0.0, r - edge) * 10.0) * 0.35;
  float alpha = uGroundOpacity + glow;
  gl_FragColor = vec4(uGroundColor + vec3(0.06, 0.04, 0.02) * glow, alpha);
}
`;

export class HorizonSystem {
  group = new THREE.Group();
  private ground: THREE.Mesh;
  private circle: THREE.LineLoop;

  constructor() {
    const material = new THREE.ShaderMaterial({
      vertexShader: GROUND_VERTEX,
      fragmentShader: GROUND_FRAGMENT,
      uniforms: {
        uAspect: { value: 1 },
        uHorizonR: { value: 1 },
        uGroundOpacity: { value: 0.88 },
        uGroundColor: { value: new THREE.Color(0x05070c) },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const quad = new THREE.PlaneGeometry(2.02, 2.02);
    this.ground = new THREE.Mesh(quad, material);
    this.ground.frustumCulled = false;
    this.ground.renderOrder = 40;

    // Horizon circle: unit circle scaled by the horizon radius each frame.
    const circleGeo = new THREE.BufferGeometry();
    const pts: number[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI * 2;
      pts.push(Math.cos(a), Math.sin(a), 0);
    }
    circleGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    const circleMat = new THREE.LineBasicMaterial({
      color: 0x8fb8d8,
      transparent: true,
      opacity: 0.55,
      depthTest: false,
      depthWrite: false,
    });
    this.circle = new THREE.LineLoop(circleGeo, circleMat);
    this.circle.frustumCulled = false;
    this.circle.renderOrder = 39;

    this.group.add(this.circle, this.ground);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  update(camera: SkyCamera): void {
    const horizonR = 1 / camera.scaleTan; // tan(45 deg) / tan(fov/4)
    const u = (this.ground.material as THREE.ShaderMaterial).uniforms;
    u.uAspect!.value = camera.aspect;
    u.uHorizonR!.value = horizonR;
    this.circle.scale.set(horizonR, horizonR, 1);
    // When the horizon circle is far outside the viewport (looking up with a
    // narrow FOV) the quad still covers the screen; the discard handles it.
  }
}

/** Cardinal/intercardinal directions for DOM labels. */
export const CARDINALS: { az: number; label: string }[] = [
  { az: 0, label: '北 N' },
  { az: 45, label: '东北 NE' },
  { az: 90, label: '东 E' },
  { az: 135, label: '东南 SE' },
  { az: 180, label: '南 S' },
  { az: 225, label: '西南 SW' },
  { az: 270, label: '西 W' },
  { az: 315, label: '西北 NW' },
];

export function cardinalDirHor(azDeg: number): Vec3 {
  const az = (azDeg * Math.PI) / 180;
  return [-Math.cos(az), Math.sin(az), 0.035]; // slightly above the horizon
}
