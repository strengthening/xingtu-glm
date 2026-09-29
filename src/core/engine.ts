/**
 * Engine: application state (observer, time, display options) plus the main
 * loop that recomputes the SkyFrame and drives every render module.
 */
import type { Observer } from '../astro/types';
import type { Vec3 } from '../astro/types';
import * as THREE from 'three';
import { computeSkyFrame, type SkyFrame } from '../astro/sky';
import { horVectorFromHorizontal } from '../astro/coords';
import { SkyRenderer, skyBackgroundCss, type DisplayOptions } from '../render/renderer';
import { StarCatalog } from '../data/starCatalog';
import {
  buildEquatorialGrid,
  buildHorizonGrid,
  updateLineMaterial,
} from '../render/lines';
import { HorizonSystem, CARDINALS, cardinalDirHor } from '../render/horizon';
import { ConstellationRenderer } from '../render/constellations';
import { SolarSystemRenderer } from '../render/solarSystem';
import { LabelRenderer } from '../render/labels';
import { HipsBackground } from '../render/hips';
import { PanoramaBackground } from '../render/panorama';

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

  equatorialGrid = buildEquatorialGrid();
  horizonGrid = buildHorizonGrid();
  horizon = new HorizonSystem();
  constellations = new ConstellationRenderer();
  solarSystem = new SolarSystemRenderer();
  hips = new HipsBackground();
  panorama = new PanoramaBackground();
  labelRenderer: LabelRenderer | null = null;
  pickHandler: ((ndcX: number, ndcY: number) => void) | null = null;
  optionsChanged: (() => void) | null = null;

  private cardinalDirs = CARDINALS.map((c) => ({
    label: c.label,
    dir: cardinalDirHor(c.az),
  }));

  constructor(canvas: HTMLCanvasElement, observer: Observer, startDate: Date) {
    this.renderer = new SkyRenderer(canvas);
    this.observer = observer;
    this.simTime = startDate;
    this.frame = computeSkyFrame(startDate, observer);

    this.renderer.onPointerDrag = (dx, dy) => this.drag(dx, dy);
    this.renderer.onWheel = (dy, ndcX, ndcY) => this.zoom(dy, ndcX, ndcY);
    this.renderer.onClick = (x, y) => this.pickHandler?.(x, y);
    window.addEventListener('resize', () => this.renderer.resize());

    // Initial view: south-southwest, 40 deg up, wide field.
    this.renderer.skyCamera.setCenter(horVectorFromHorizontal(40, 200));
    this.renderer.skyCamera.setFov(90);
  }

  async init(): Promise<void> {
    await this.catalog.init();
    this.renderer.scene.add(this.catalog.group);
    await this.panorama.load();
    this.renderer.scene.add(this.panorama.group);

    this.renderer.scene.add(this.equatorialGrid);
    this.renderer.scene.add(this.horizonGrid);

    await this.constellations.load();
    this.renderer.scene.add(this.constellations.western);
    this.renderer.scene.add(this.constellations.chinese);

    this.renderer.scene.add(this.solarSystem.group);
    this.renderer.scene.add(this.horizon.group);

    this.labelRenderer = new LabelRenderer(document.getElementById('overlay')!);
    await this.labelRenderer.load();

    this.applyOptions();
  }

  applyOptions(): void {
    this.equatorialGrid.visible = this.options.equatorialGrid;
    this.horizonGrid.visible = this.options.horizonGrid;
    this.constellations.western.visible = this.options.constellationsWestern;
    this.constellations.chinese.visible = this.options.constellationsChinese;
    this.horizon.setVisible(this.options.ground);
    this.panorama.setVisible(this.options.hips);
    this.optionsChanged?.();
  }

  /** 0..1 sky glow from moonlight (twilight tint is handled by the clear color). */
  skyBrightness(): number {
    const { moonAltDeg, moonIllum, sunAltDeg } = this.frame;
    let b = 0;
    if (moonAltDeg > 0) {
      b = Math.max(b, (moonAltDeg / 90) * moonIllum * 0.5);
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
    const loop = () => {
      const dtMs = performance.now() - this.lastReal;
      this.lastReal = performance.now();
      if (this.timeRate !== 0 && Number.isFinite(this.timeRate)) {
        this.simTime = new Date(this.simTime.getTime() + dtMs * this.timeRate);
      }
      this.updateFrame();
      this.renderer.render();
      requestAnimationFrame(loop);
    };
    this.lastReal = performance.now();
    requestAnimationFrame(loop);
  }

  private lastReal = performance.now();

  updateFrame(): void {
    const frame = computeSkyFrame(this.simTime, this.observer);
    this.frame = frame;
    const camera = this.renderer.skyCamera;

    // Twilight / night background color.
    this.renderer.renderer.setClearColor(
      new THREE.Color(skyBackgroundCss(frame, this.options.atmosphere)),
    );

    // Star field + tile streaming.
    this.catalog.material.updatePerFrame({
      frame,
      camera,
      atmosphere: this.options.atmosphere,
      skyBrightness: this.skyBrightness(),
      pixelRatio: this.renderer.pixelRatio,
    });
    this.catalog.ensureVisible(camera.centerHor, camera.fovDeg, frame.rotEqjToHor);

    // Milky Way panorama background (local asset; HiPS kept as an online option).
    this.panorama.update(frame, camera, this.skyBrightness());

    // Grids.
    if (this.equatorialGrid.visible) {
      updateLineMaterial(
        this.equatorialGrid.material as never,
        frame,
        camera,
        true,
      );
    }
    if (this.horizonGrid.visible) {
      updateLineMaterial(
        this.horizonGrid.material as never,
        frame,
        camera,
        false,
      );
    }

    // Constellations, solar system, horizon.
    this.constellations.update(frame, camera);
    this.solarSystem.setViewport(this.renderer.height, this.renderer.pixelRatio);
    this.solarSystem.update(frame, camera);
    this.horizon.update(camera);

    // DOM labels.
    if (this.labelRenderer) {
      this.labelRenderer.update(
        frame,
        camera,
        this.renderer.width,
        this.renderer.height,
        { labels: this.options.labels, ground: this.options.ground },
        this.solarSystem.bodiesHor.map((b) => ({
          name: b.info.label,
          dirHor: b.dirHor,
        })),
        this.options.ground ? this.cardinalDirs : [],
      );
    }
  }
}
