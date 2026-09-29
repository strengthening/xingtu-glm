/**
 * Milky Way panorama background: a local equirectangular image in galactic
 * coordinates, rendered on the unit sphere with the shared stereographic
 * projection so it always lines up with the star field.
 *
 * Image: "ESO - Milky Way" by ESO/S. Brunier (GigaGalaxy Zoom),
 * CC BY 4.0, via Wikimedia Commons — served from /assets/milkyway.jpg.
 *
 * The tile-based CDS HiPS renderer (hips.ts) is kept as an online option;
 * this panorama works fully offline and loads instantly.
 */
import * as THREE from 'three';
import { mat3FromAstroRotation, mulMat3, transposeMat3 } from '../astro/coords';
import type { Vec3 } from '../astro/types';
import type { SkyCamera } from './projection';
import { setCommonUniforms, threeUniformsFromCommon } from './starfield';
import type { SkyFrame } from '../astro/sky';
import * as Astro from 'astronomy-engine';

const VERTEX = /* glsl */ `
attribute vec2 uv2;
varying vec2 vUv;
uniform mat3 uRotEqjToHor;
uniform vec3 uBeta;
uniform float uYears;
uniform vec3 uCamCenter;
uniform vec3 uCamUp;
uniform vec3 uCamRight;
uniform float uScaleTan;
uniform float uAspect;
void main() {
  vUv = uv2;
  vec3 h = uRotEqjToHor * position;
  float z = dot(h, uCamCenter);
  if (z <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  float sinTheta = sqrt(max(0.0, 1.0 - z * z));
  float r = (sinTheta / (1.0 + z)) / uScaleTan;
  float px = dot(h, uCamRight) / sinTheta * r;
  float py = dot(h, uCamUp) / sinTheta * r;
  gl_Position = vec4(px / uAspect, py, 0.0, 1.0);
}
`;

const FRAGMENT = /* glsl */ `
precision mediump float;
uniform sampler2D uMap;
uniform float uOpacity;
uniform float uSkyDim;   // 1 = night, 0 = washed out by sky glow
varying vec2 vUv;
void main() {
  vec3 c = texture2D(uMap, vUv).rgb;
  gl_FragColor = vec4(c * uOpacity * uSkyDim, uOpacity * uSkyDim);
}
`;

export class PanoramaBackground {
  group = new THREE.Group();
  private material: THREE.ShaderMaterial;
  private mesh: THREE.Mesh | null = null;
  ready = false;

  constructor() {
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      uniforms: {
        ...threeUniformsFromCommon(),
        uMap: { value: null },
        uOpacity: { value: 0.62 },
        uSkyDim: { value: 1 },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.group.renderOrder = 1;
  }

  async load(): Promise<void> {
    try {
      const texture = await new THREE.TextureLoader().loadAsync(
        '/assets/milkyway.jpg',
      );
      texture.colorSpace = THREE.SRGBColorSpace;

      // Build a lon/lat grid in galactic coordinates, rotated to J2000.
      const galToEqj = transposeMat3(mat3FromAstroRotation(Astro.Rotation_EQJ_GAL()));
      void mulMat3;
      const LON = 96;
      const LAT = 48;
      const positions: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];
      for (let j = 0; j <= LAT; j++) {
        const lat = (j / LAT) * 180 - 90; // -90..90
        const latRad = (lat * Math.PI) / 180;
        for (let i = 0; i <= LON; i++) {
          const lon = (i / LON) * 360 - 180; // -180..180, u=0.5 -> lon 0 (galactic center)
          const lonRad = (lon * Math.PI) / 180;
          const gal: Vec3 = [
            Math.cos(latRad) * Math.cos(lonRad),
            Math.cos(latRad) * Math.sin(lonRad),
            Math.sin(latRad),
          ];
          const eqj: Vec3 = [
            galToEqj[0]! * gal[0] + galToEqj[1]! * gal[1] + galToEqj[2]! * gal[2],
            galToEqj[3]! * gal[0] + galToEqj[4]! * gal[1] + galToEqj[5]! * gal[2],
            galToEqj[6]! * gal[0] + galToEqj[7]! * gal[1] + galToEqj[8]! * gal[2],
          ];
          positions.push(eqj[0], eqj[1], eqj[2]);
          uvs.push(i / LON, j / LAT);
        }
      }
      const stride = LON + 1;
      for (let j = 0; j < LAT; j++) {
        for (let i = 0; i < LON; i++) {
          const a = j * stride + i;
          indices.push(a, a + 1, a + stride, a + 1, a + stride + 1, a + stride);
        }
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      geo.setAttribute('uv2', new THREE.Float32BufferAttribute(uvs, 2));
      geo.setIndex(indices);
      geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
      this.material.uniforms.uMap!.value = texture;
      this.mesh = new THREE.Mesh(geo, this.material);
      this.mesh.frustumCulled = false;
      this.mesh.renderOrder = 1;
      this.group.add(this.mesh);
      this.ready = true;
    } catch {
      // Offline first run: the sky simply renders without the panorama.
    }
  }

  update(frame: SkyFrame, camera: SkyCamera, skyBrightness: number): void {
    if (!this.mesh) return;
    setCommonUniforms(this.material.uniforms, frame, camera);
    this.material.uniforms.uSkyDim!.value = Math.max(0, 1 - skyBrightness * 1.4);
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }
}
