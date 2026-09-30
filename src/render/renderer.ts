/**
 * Three.js 渲染器封装：场景、共享 uniforms、背景 pass、星点层挂载。
 *
 * 渲染顺序：背景（银河 + 天光）→ 线条层 → 星点 → 太阳系天体。
 * 全部材质关闭深度测试（天球元素无遮挡语义，由绘制顺序决定合成）。
 */
import * as THREE from 'three';
import { BG_FRAG, BG_VERT } from './shaders';

export class SkyRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  /** 所有天体材质共享的 uniform（同一引用，engine 每帧更新）。 */
  readonly uniforms: Record<string, THREE.IUniform>;
  readonly bgUniforms: Record<string, THREE.IUniform>;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setClearColor(0x000000, 1);
    this.renderer.autoClear = true;
    this.scene = new THREE.Scene();

    this.uniforms = {
      uEqd: { value: new THREE.Matrix3() },
      uHor: { value: new THREE.Matrix3() },
      uBeta: { value: new THREE.Vector3() },
      uYears: { value: 0 },
      uRight: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3() },
      uFwd: { value: new THREE.Vector3() },
      uRmax: { value: 1 },
      uAspect: { value: 1 },
      uAtm: { value: 0.5 },
      uKv: { value: 0.22 },
      uPixelScale: { value: 2.2 },
      uMagLimit: { value: 12.5 },
      uViewportH: { value: 800 },
    };

    this.bgUniforms = {
      uMilky: { value: new THREE.Texture() },
      uMilkyOpacity: { value: 0.55 },
      uHorToGal: { value: new THREE.Matrix3() },
      uRight: this.uniforms.uRight,
      uUp: this.uniforms.uUp,
      uFwd: this.uniforms.uFwd,
      uRmax: this.uniforms.uRmax,
      uAspect: this.uniforms.uAspect,
      uSkyGlow: { value: 0 },
      uSunDirHor: { value: new THREE.Vector3(0, 0, -1) },
      uSunAltDeg: { value: -45 },
      uAtm: this.uniforms.uAtm,
    };

    this.addBackgroundPass();
    this.resize();
  }

  /** 全屏背景 pass（大三角形覆盖 NDC）。 */
  private addBackgroundPass(): void {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      'aNdc',
      new THREE.Float32BufferAttribute([-1, -1, 3, -1, -1, 3], 2),
    );
    const material = new THREE.ShaderMaterial({
      uniforms: this.bgUniforms,
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      depthTest: false,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = -10;
    this.scene.add(mesh);
  }

  /** 设置银河全景贴图（equirectangular）。 */
  setMilkyWayTexture(url: string): void {
    new THREE.TextureLoader().load(url, (tex) => {
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = THREE.RepeatWrapping;
      tex.minFilter = THREE.LinearFilter;
      this.bgUniforms.uMilky.value = tex;
    });
  }

  resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    this.uniforms.uViewportH.value = h * dpr;
  }

  render(): void {
    this.renderer.render(this.scene, new THREE.Camera()); // 相机矩阵未用（自定义投影）
  }
}
