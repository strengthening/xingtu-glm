/**
 * 太阳系天体渲染：太阳（亮核+光晕）、月亮（含月相 terminator）、行星圆盘。
 * 每帧由 engine 传入 solarSystemInfo 结果，直接重写 attribute。
 */
import * as THREE from 'three';
import type { SolarBodyInfo } from '../astro/solarSystem';
import { SOLAR_FRAG, SOLAR_VERT } from './shaders';

const BODY_COLORS: Record<string, [number, number, number]> = {
  Sun: [1.0, 0.96, 0.88],
  Moon: [0.92, 0.92, 0.95],
  Mercury: [0.72, 0.71, 0.69],
  Venus: [1.0, 0.96, 0.86],
  Mars: [1.0, 0.6, 0.44],
  Jupiter: [1.0, 0.87, 0.72],
  Saturn: [0.96, 0.88, 0.7],
  Uranus: [0.64, 0.85, 0.9],
  Neptune: [0.55, 0.66, 1.0],
};

const BODY_KIND: Record<string, number> = {
  Sun: 0,
  Moon: 1,
};

export class SolarLayer {
  readonly points: THREE.Points;
  private geo: THREE.BufferGeometry;
  private dirAttr: THREE.BufferAttribute;
  private diamAttr: THREE.BufferAttribute;
  private colorAttr: THREE.BufferAttribute;
  private kindAttr: THREE.BufferAttribute;
  private illumAttr: THREE.BufferAttribute;
  private magAttr: THREE.BufferAttribute;
  readonly moonLitDir: { value: THREE.Vector2 };

  constructor(
    scene: THREE.Scene,
    uniforms: Record<string, THREE.IUniform>,
  ) {
    const n = 9;
    this.geo = new THREE.BufferGeometry();
    this.dirAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.diamAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.colorAttr = new THREE.BufferAttribute(new Float32Array(n * 3), 3);
    this.kindAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.illumAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.magAttr = new THREE.BufferAttribute(new Float32Array(n), 1);
    this.dirAttr.setUsage(THREE.DynamicDrawUsage);
    this.diamAttr.setUsage(THREE.DynamicDrawUsage);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    this.kindAttr.setUsage(THREE.DynamicDrawUsage);
    this.illumAttr.setUsage(THREE.DynamicDrawUsage);
    this.magAttr.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('position', this.dirAttr); // 占位，SOLAR_VERT 用 aDir
    this.geo.setAttribute('aDir', this.dirAttr);
    this.geo.setAttribute('aDiam', this.diamAttr);
    this.geo.setAttribute('aColor', this.colorAttr);
    this.geo.setAttribute('aKind', this.kindAttr);
    this.geo.setAttribute('aIllum', this.illumAttr);
    this.geo.setAttribute('aMag', this.magAttr);
    this.geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 2);
    this.moonLitDir = { value: new THREE.Vector2(1, 0) };
    const material = new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uMoonLitDir: this.moonLitDir },
      vertexShader: SOLAR_VERT,
      fragmentShader: SOLAR_FRAG,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.points = new THREE.Points(this.geo, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 5;
    scene.add(this.points);
  }

  update(infos: SolarBodyInfo[]): void {
    const dir = this.dirAttr.array as Float32Array;
    const diam = this.diamAttr.array as Float32Array;
    const col = this.colorAttr.array as Float32Array;
    const kind = this.kindAttr.array as Float32Array;
    const illum = this.illumAttr.array as Float32Array;
    const mag = this.magAttr.array as Float32Array;
    for (let i = 0; i < infos.length && i < 9; i++) {
      const b = infos[i]!;
      dir[i * 3] = b.unit.x;
      dir[i * 3 + 1] = b.unit.y;
      dir[i * 3 + 2] = b.unit.z;
      diam[i] = Math.max(b.angularDiameter, 0.02);
      const c = BODY_COLORS[b.name] ?? [1, 1, 1];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
      kind[i] = BODY_KIND[b.name] ?? 2;
      illum[i] = b.illumFraction;
      mag[i] = b.mag;
    }
    this.dirAttr.needsUpdate = true;
    this.diamAttr.needsUpdate = true;
    this.colorAttr.needsUpdate = true;
    this.kindAttr.needsUpdate = true;
    this.illumAttr.needsUpdate = true;
    this.magAttr.needsUpdate = true;
  }

  setVisible(v: boolean): void {
    this.points.visible = v;
  }
}
