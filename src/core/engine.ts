/**
 * Engine: application state (observer, time, display options) plus the main
 * loop that recomputes the SkyFrame and drives every render module.
 */
import type { Observer } from '../astro/types';
import { computeSkyFrame, type SkyFrame } from '../astro/sky';
import { horVectorFromHorizontal } from '../astro/coords';
import { SkyRenderer, type DisplayOptions } from '../render/renderer';
import { StarCatalog } from '../data/starCatalog';
import type { Vec3 } from '../astro/types';

export interface EngineCallbacks {
  onFrame?: (frame: SkyFrame) => void;
  onPick?: (ndcX: number, ndcY: number) => void;
}

const DEFAULT_OPTIONS: DisplayOptions = {
  equatorialGrid: false,
  horizonGrid: false,
  constellationsWestern: true,
  constellationsChinese: false,
  ground: true,
  atmosphere: 0.35,
  labels: true,
  hips: true,
};

export class Engine {
  renderer: SkyRenderer;
  catalog = new StarCatalog();
  options: DisplayOptions = { ...DEFAULT_OPTIONS };
  /** Milliseconds of simulated time per real second. */
  timeRate = 1;
  simTime: Date;
  observer: Observer;
  frame: SkyFrame;
  modules: { update(frame: SkyFrame): void }[] = [];
  pickHandler: ((ndcX: number, ndcY: number) => void) | null = null;

  private lastRealTime = performance.now();

  constructor(canvas: HTMLCanvasElement, observer: Observer, startDate: Date) {
    this.renderer = new SkyRenderer(canvas);
    this.observer = observer;
    this.simTime = startDate;
    this.frame = computeSkyFrame(startDate, observer);

    // Pointer interaction.
    this.renderer.onPointerDrag = (dx, dy) => this.drag(dx, dy);
    this.renderer.onWheel = (dy, ndcX, ndcY) => this.zoom(dy, ndcX, ndcY);
    this.renderer.onClick = (x, y) => this.pickHandler?.(x, y);
    window.addEventListener('resize', () => this.renderer.resize());

    // Initial view: aim south-southwest, 40 deg up, wide field.
    this.renderer.skyCamera.setCenter(horVectorFromHorizontal(40, 200));
    this.renderer.skyCamera.setFov(90);
  }

  async init(): Promise<void> {
    await this.catalog.init();
    this.renderer.scene.add(this.catalog.group);
    this.modules.push({
      update: (frame) => {
        this.catalog.material.updatePerFrame({
          frame,
          camera: this.renderer.skyCamera,
          atmosphere: this.options.atmosphere,
          skyBrightness: this.skyBrightness(),
          pixelRatio: this.renderer.pixelRatio,
        });
        this.catalog.ensureVisible(
          this.renderer.skyCamera.centerHor,
          this.renderer.skyCamera.fovDeg,
          frame.rotEqjToHor,
        );
      },
    });
  }

  /** 0..1 sky glow from moonlight (and twilight handled by background). */
  skyBrightness(): number {
    const { moonAltDeg, moonIllum, sunAltDeg } = this.frame;
    let b = 0;
    if (moonAltDeg > 0) {
      b = Math.max(b, (moonAltDeg / 90) * moonIllum * 0.55);
    }
    if (sunAltDeg > -6) {
      b = Math.max(b, Math.min(1, (sunAltDeg + 6) / 12));
    }
    return b * this.options.atmosphere;
  }

  drag(dxPx: number, dyPx: number): void {
    const cam = this.renderer.skyCamera;
    // Vertical and horizontal pixel scales coincide (fov is vertical).
    const degPerPx = cam.fovDeg / this.renderer.height;
    const c = cam.centerHor;
    const alt = (Math.asin(Math.max(-1, Math.min(1, c[2]))) * 180) / Math.PI;
    let az = (Math.atan2(c[1], -c[0]) * 180) / Math.PI;
    if (az < 0) az += 360;
    // "Grab the sky": dragging right moves stars right (azimuth increases),
    // dragging down moves stars down (altitude decreases).
    az += dxPx * degPerPx;
    let newAlt = alt + dyPx * degPerPx;
    if (newAlt > 89) newAlt = 89;
    if (newAlt < -89) newAlt = -89;
    cam.setCenter(horVectorFromHorizontal(newAlt, (az + 360) % 360));
  }

  zoom(dy: number, ndcX: number, ndcY: number): void {
    const cam = this.renderer.skyCamera;
    const before = cam.unproject(ndcX, ndcY);
    const factor = Math.exp(dy * 0.0015);
    cam.setFov(cam.fovDeg * factor);
    // Keep the point under the cursor anchored.
    const after = cam.unproject(ndcX, ndcY);
    const delta: Vec3 = [
      after[0] - before[0],
      after[1] - before[1],
      after[2] - before[2],
    ];
    if (Math.hypot(delta[0], delta[1], delta[2]) > 1e-9) {
      cam.setCenter([
        cam.centerHor[0] - delta[0],
        cam.centerHor[1] - delta[1],
        cam.centerHor[2] - delta[2],
      ]);
    }
  }

  setObserver(observer: Observer): void {
    this.observer = observer;
  }

  setSimTime(date: Date): void {
    this.simTime = date;
  }

  start(): void {
    const loop = (now: number) => {
      const dtMs = now - this.lastRealTime;
      this.lastRealTime = now;
      if (this.timeRate !== 0) {
        this.simTime = new Date(
          this.simTime.getTime() + dtMs * this.timeRate,
        );
      }
      this.frame = computeSkyFrame(this.simTime, this.observer);
      for (const m of this.modules) m.update(this.frame);
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
}
