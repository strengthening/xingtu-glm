/**
 * SkyRenderer: owns the WebGL context, the render loop and pointer input.
 * Render order (painter's algorithm; nothing uses the depth buffer):
 *   HiPS background -> grids -> constellation lines -> stars -> solar system
 *   -> ground occlusion disk -> DOM overlay labels.
 */
import * as THREE from 'three';
import { SkyCamera } from './projection';
import type { SkyFrame } from '../astro/sky';

export interface DisplayOptions {
  equatorialGrid: boolean;
  horizonGrid: boolean;
  constellationsWestern: boolean;
  constellationsChinese: boolean;
  ground: boolean;
  atmosphere: number; // 0..1
  labels: boolean;
  hips: boolean;
}

export class SkyRenderer {
  renderer: THREE.WebGLRenderer;
  scene = new THREE.Scene();
  camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  skyCamera = new SkyCamera();
  canvas: HTMLCanvasElement;

  onPointerDrag: ((dxPx: number, dyPx: number) => void) | null = null;
  onWheel: ((dy: number, ndcX: number, ndcY: number) => void) | null = null;
  onClick: ((ndcX: number, ndcY: number) => void) | null = null;
  onResize: (() => void) | null = null;

  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private movedSinceDown = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: false,
    });
    this.renderer.setClearColor(0x02040a, 1);
    this.camera.position.z = 5;

    this.attachInput();
    this.resize();
  }

  private attachInput(): void {
    const el = this.canvas;
    el.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.movedSinceDown = 0;
      el.setPointerCapture(e.pointerId);
    });
    el.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastX;
      const dy = e.clientY - this.lastY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.movedSinceDown += Math.abs(dx) + Math.abs(dy);
      this.onPointerDrag?.(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.movedSinceDown < 5) {
        const rect = el.getBoundingClientRect();
        this.onClick?.(
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        );
      }
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        this.onWheel?.(
          e.deltaY,
          ((e.clientX - rect.left) / rect.width) * 2 - 1,
          1 - ((e.clientY - rect.top) / rect.height) * 2,
        );
      },
      { passive: false },
    );
  }

  resize(): void {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.renderer.setPixelRatio(dpr);
    this.renderer.setSize(w, h, false);
    const aspect = w / h;
    this.camera.left = -aspect;
    this.camera.right = aspect;
    this.camera.updateProjectionMatrix();
    this.skyCamera.setAspect(aspect);
    this.onResize?.();
  }

  render(): void {
    this.renderer.render(this.scene, this.camera);
  }

  get pixelRatio(): number {
    return this.renderer.getPixelRatio();
  }

  get width(): number {
    return this.canvas.clientWidth || window.innerWidth;
  }

  get height(): number {
    return this.canvas.clientHeight || window.innerHeight;
  }
}

/** Background color of the deep sky (very dark blue, not pure black). */
export function skyBackgroundCss(frame: SkyFrame, atmosphere: number): string {
  // Twilight glow when the sun is just below the horizon.
  const sunAlt = frame.sunAltDeg;
  if (sunAlt > -8 && atmosphere > 0) {
    const t = Math.min(1, Math.max(0, (sunAlt + 8) / 14));
    const r = Math.round(2 + t * 40 * atmosphere);
    const g = Math.round(4 + t * 24 * atmosphere);
    const b = Math.round(10 + t * 30 * atmosphere);
    return `rgb(${r},${g},${b})`;
  }
  return 'rgb(2,4,10)';
}
