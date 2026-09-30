/**
 * 引擎：观测状态（地点/时间/视角/图层）、帧循环、交互输入。
 *
 * 每帧重新计算并推送 GPU uniforms：
 *   岁差+章动矩阵、地平旋转矩阵、地球速度 β、天光强度、银河贴图矩阵。
 * 时间支持加速/暂停（speed 为相对实时的倍率，0 = 暂停）。
 */
import * as THREE from 'three';
import { earthBeta } from '../astro/aberration';
import {
  applyMat3,
  eqdToHorizonMatrix,
  eqjToEqdMatrix,
  gastDeg,
  mulMat3,
  normalize,
  yearsSinceJ2000,
} from '../astro/coords';
import { moonGlowFromAltaz, sunAlt } from '../astro/sky';
import { solarSystemInfo } from '../astro/solarSystem';
import type { Mat3, ObserverGeo, Vec3 } from '../astro/types';
import { computeFrame, eqjToGalacticMatrix, transposeMat3 } from '../render/projection';
import { SkyRenderer } from '../render/renderer';
import { Starfield } from '../render/starfield';

export interface SkyState {
  observer: ObserverGeo;
  /** 模拟时刻（内部存 ms）。 */
  simMs: number;
  /** 时间流速（× 实时；0 = 暂停）。 */
  speed: number;
  view: {
    alt: number;
    az: number;
    fov: number; // 垂直视场（度）
  };
  layers: {
    milkyway: boolean;
    atmDensity: number; // 0..1
  };
}

export const DEFAULT_SPEED = 1;
export const SPEED_STEPS = [0, 1, 60, 600, 3600, 86400];

const EQJ_GAL: Mat3 = eqjToGalacticMatrix();

export class Engine {
  state: SkyState;
  renderer: SkyRenderer;
  starfield: Starfield | null = null;
  /** 视角中心（EQJ 系）缓存，供切片加载。 */
  private centerEqj: Vec3 = { x: 0, y: 0, z: 1 };
  private raf = 0;
  private lastTick = 0;
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  private canvas: HTMLCanvasElement;

  onStateChange?: (s: SkyState) => void;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new SkyRenderer(canvas);
    this.state = {
      observer: { lat: 31.23, lon: 121.47, elevation: 4 },
      simMs: Date.now(),
      speed: DEFAULT_SPEED,
      view: { alt: 35, az: 180, fov: 75 },
      layers: { milkyway: true, atmDensity: 0.45 },
    };
    this.bindInput();
    this.renderer.setMilkyWayTexture(`${import.meta.env.BASE_URL}assets/milkyway.png`);
  }

  async init(): Promise<void> {
    this.starfield = await Starfield.create(this.scene, this.renderer.uniforms);
    if (!this.starfield) {
      console.warn('星表数据未生成（public/data/stars/），请先运行 pnpm stars:download && pnpm stars:build');
    }
  }

  get scene(): THREE.Scene {
    return this.renderer.scene;
  }

  start(): void {
    this.lastTick = performance.now();
    const loop = (now: number) => {
      const dtMs = now - this.lastTick;
      this.lastTick = now;
      this.tick(dtMs);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }

  setState(patch: Partial<SkyState>): void {
    if (patch.observer) this.state.observer = patch.observer;
    if (patch.speed !== undefined) this.state.speed = patch.speed;
    if (patch.view) Object.assign(this.state.view, patch.view);
    if (patch.layers) Object.assign(this.state.layers, patch.layers);
    if (patch.simMs !== undefined) this.state.simMs = patch.simMs;
    this.onStateChange?.(this.state);
  }

  private tick(dtMs: number): void {
    const s = this.state;
    s.simMs += dtMs * s.speed;
    const date = new Date(s.simMs);

    // 坐标链 uniform
    const eqd = eqjToEqdMatrix(date);
    const gast = gastDeg(date);
    const hor = eqdToHorizonMatrix(gast, s.observer.lat, s.observer.lon);
    const betaEqj = earthBeta(date);
    const betaEqd = applyMat3(eqd, betaEqj);
    const u = this.renderer.uniforms;
    (u.uEqd.value as THREE.Matrix3).fromArray(toColMajor(eqd));
    (u.uHor.value as THREE.Matrix3).fromArray(toColMajor(hor));
    (u.uBeta.value as THREE.Vector3).set(betaEqd.x, betaEqd.y, betaEqd.z);
    u.uYears.value = yearsSinceJ2000(date);
    u.uAtm.value = s.layers.atmDensity;

    // 相机基
    const frame = computeFrame({
      alt: s.view.alt,
      az: s.view.az,
      fovY: s.view.fov,
      aspect: this.canvas.clientWidth / Math.max(1, this.canvas.clientHeight),
    });
    (u.uRight.value as THREE.Vector3).set(frame.right.x, frame.right.y, frame.right.z);
    (u.uUp.value as THREE.Vector3).set(frame.up.x, frame.up.y, frame.up.z);
    (u.uFwd.value as THREE.Vector3).set(frame.fwd.x, frame.fwd.y, frame.fwd.z);
    u.uRmax.value = frame.rMax;
    u.uAspect.value = frame.aspect;
    u.uPixelScale.value =
      (this.canvas.clientHeight / 900) * Math.max(0.35, Math.min(2.4, s.view.fov / 60)) * 2.4;

    // 背景 uniform：银河矩阵、天光
    const bg = this.renderer.bgUniforms;
    const horToGal = mulMat3(EQJ_GAL, mulMat3(transposeMat3(eqd), transposeMat3(hor)));
    (bg.uHorToGal.value as THREE.Matrix3).fromArray(toColMajor(horToGal));
    bg.uMilkyOpacity.value = s.layers.milkyway ? 0.62 : 0;
    const sunAltDeg = sunAlt(date, s.observer);
    bg.uSunAltDeg.value = sunAltDeg;
    const sunInfo = solarSystemInfo(date, s.observer);
    const sun = sunInfo.find((b) => b.name === 'Sun')!;
    const moon = sunInfo.find((b) => b.name === 'Moon')!;
    const sunDirHor = applyMat3(hor, sun.unit);
    (bg.uSunDirHor.value as THREE.Vector3).set(sunDirHor.x, sunDirHor.y, sunDirHor.z);
    const nightFactor = Math.max(0, Math.min(1, (0 - sunAltDeg) / 6)); // 太阳落山程度
    bg.uSkyGlow.value =
      moonGlowFromAltaz(moon.altaz.alt, moon.illumFraction, s.layers.atmDensity) *
      0.85 *
      nightFactor;

    // 视野中心（EQJ 系，供切片加载）
    const centerHor = {
      x: Math.cos((s.view.alt * Math.PI) / 180) * Math.cos((s.view.az * Math.PI) / 180),
      y: Math.cos((s.view.alt * Math.PI) / 180) * Math.sin((s.view.az * Math.PI) / 180),
      z: Math.sin((s.view.alt * Math.PI) / 180),
    };
    this.centerEqj = normalize(
      applyMat3(transposeMat3(hor), applyMat3(transposeMat3(eqd), centerHor)),
    );

    this.starfield?.update(this.centerEqj, s.view.fov);
    this.renderer.render();
  }

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const s = this.state;
      const k = (s.view.fov / 900) * 1.15;
      let az = s.view.az + (e.clientX - this.lastX) * k;
      const alt = Math.max(
        -89,
        Math.min(89, s.view.alt + (e.clientY - this.lastY) * k),
      );
      az = ((az % 360) + 360) % 360;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.setState({ view: { alt, az, fov: s.view.fov } });
    });
    const endDrag = (): void => {
      this.dragging = false;
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', endDrag);
    cv.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        const s = this.state;
        const factor = Math.exp(e.deltaY * 0.0012);
        const fov = Math.max(0.08, Math.min(120, s.view.fov * factor));
        this.setState({ view: { ...s.view, fov } });
      },
      { passive: false },
    );
    window.addEventListener('resize', () => this.renderer.resize());
  }
}

/** 行主序 Mat3 → 列主序数组（THREE.Matrix3.fromArray 期望列主序）。 */
function toColMajor(m: Mat3): number[] {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
