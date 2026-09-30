/**
 * 引擎：观测状态（地点/时间/视角/图层）、帧循环、交互输入与拾取。
 *
 * 每帧重新计算并推送 GPU uniforms（岁差+章动、地平旋转、地球速度 β、
 * 天光强度、银河贴图矩阵），并更新太阳系 attribute、HTML 标签与面板读数。
 */
import * as THREE from 'three';
import { earthBeta } from '../astro/aberration';
import { transposeMat3 } from '../render/projection';
import {
  applyMat3,
  eqdToHorizonMatrix,
  eqjToEqdMatrix,
  gastDeg,
  mulMat3,
  normalize,
  unitToAltaz,
  yearsSinceJ2000,
} from '../astro/coords';
import { findPlace } from '../astro/places';
import { moonGlowFromAltaz } from '../astro/sky';
import { solarSystemInfo, type SolarBodyInfo } from '../astro/solarSystem';
import type { Mat3, ObserverGeo, Vec3 } from '../astro/types';
import { computeFrame, eqjToGalacticMatrix, projectHorizon, type CameraFrame } from '../render/projection';
import { SkyRenderer } from '../render/renderer';
import { Starfield } from '../render/starfield';
import { SolarLayer } from '../render/solarSystem';
import { loadConstellations, type ConstellationLayers } from '../render/constellations';
import { equatorGrid, horizonGrid, horizonLine, makeLineLayer } from '../render/lines';
import { LabelLayer, type NamedStar } from '../render/labels';
import { Panel } from '../ui/panel';
import { InfoCard, type PickHit } from '../ui/infoCard';
import { centerToRadec, parseHash, radecToCenterHor, writeHash } from '../ui/urlState';

export interface SkyState {
  observer: ObserverGeo;
  placeId: string;
  simMs: number;
  speed: number;
  view: {
    alt: number;
    az: number;
    fov: number;
  };
  layers: {
    equatorGrid: boolean;
    horizonGrid: boolean;
    constWest: boolean;
    constZh: boolean;
    labels: boolean;
    milkyway: boolean;
    atmDensity: number;
  };
}

export const SPEED_STEPS = [0, 1, 60, 600, 3600, 86400];

const EQJ_GAL: Mat3 = eqjToGalacticMatrix();

export class Engine {
  state: SkyState;
  renderer: SkyRenderer;
  starfield: Starfield | null = null;
  private solarLayer: SolarLayer;
  private constellations: ConstellationLayers = { western: null, chinese: null };
  private gridLayers: THREE.LineSegments[] = [];
  private labels: LabelLayer;
  private panel: Panel;
  private infoCard: InfoCard;
  private namedStars: NamedStar[] = [];
  private solarInfos: SolarBodyInfo[] = [];
  private raf = 0;
  private lastTick = 0;
  private dragging = false;
  private downX = 0;
  private downY = 0;
  private lastX = 0;
  private lastY = 0;
  private canvas: HTMLCanvasElement;
  /** 本帧矩阵缓存（拾取与标签复用）。 */
  private curEqd: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private curHor: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  private curFrame!: CameraFrame;
  private urlTimer = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.renderer = new SkyRenderer(canvas);
    this.state = {
      observer: { lat: 31.23, lon: 121.47, elevation: 4 },
      placeId: 'shanghai',
      simMs: Date.now(),
      speed: 1,
      view: { alt: 35, az: 180, fov: 75 },
      layers: {
        equatorGrid: false,
        horizonGrid: false,
        constWest: true,
        constZh: false,
        labels: true,
        milkyway: true,
        atmDensity: 0.45,
      },
    };
    this.solarLayer = new SolarLayer(this.scene, this.renderer.uniforms);
    this.labels = new LabelLayer(document.getElementById('labels') as HTMLElement);
    this.panel = new Panel(document.getElementById('panel') as HTMLElement, this.state, {
      onObserver: (id) => this.setPlace(id),
      onTime: (ms) => this.setState({ simMs: ms }),
      onSpeed: (speed) => this.setState({ speed }),
      onLayer: (key, value) => this.applyLayer(key, value),
      onAtm: (d) => this.setState({ layers: { ...this.state.layers, atmDensity: d } }),
      onNow: () => this.setState({ simMs: Date.now() }),
    });
    this.infoCard = new InfoCard(document.getElementById('infocard') as HTMLElement);
    this.renderer.setMilkyWayTexture(`${import.meta.env.BASE_URL}assets/milkyway.png`);
    this.bindInput();
    this.applyUrlState();
    window.addEventListener('hashchange', () => {
      this.applyUrlState();
      this.urlTimer = 0;
    });
  }

  get scene(): THREE.Scene {
    return this.renderer.scene;
  }

  async init(): Promise<void> {
    this.starfield = await Starfield.create(this.scene, this.renderer.uniforms);
    if (this.starfield) {
      await this.loadStarNames();
    } else {
      console.warn('星表数据未生成，请先运行 pnpm stars:download && pnpm stars:build');
    }
    this.constellations = await loadConstellations(this.scene, this.renderer.uniforms);
    this.constellations.western!.visible = this.state.layers.constWest;
    this.constellations.chinese!.visible = this.state.layers.constZh;
    this.gridLayers = [
      makeLineLayer(this.scene, this.renderer.uniforms, equatorGrid(), {
        color: 0x3a5f9a, opacity: 0.4, dash: 0, space: 0,
      }),
      makeLineLayer(this.scene, this.renderer.uniforms, horizonGrid(), {
        color: 0x6a8a5a, opacity: 0.35, dash: 0, space: 2,
      }),
      makeLineLayer(this.scene, this.renderer.uniforms, horizonLine(), {
        color: 0xff9d5c, opacity: 0.85, dash: 1, space: 2,
      }),
    ];
    this.syncLayerVisibility();
  }

  private async loadStarNames(): Promise<void> {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}data/stars/names.json`);
      if (!res.ok) return;
      const names = (await res.json()) as Record<string, { en?: string; zh?: string }>;
      this.namesMap = names;
      this.namedStars = this.starfield!.resolveNamedStars(names);
      this.labels.setNamedStars(this.namedStars);
    } catch {
      /* 名字加载失败不影响渲染 */
    }
  }

  private applyUrlState(): void {
    const u = parseHash();
    if (u.place) this.setPlace(u.place, false);
    if (u.t) {
      const t = Date.parse(u.t);
      if (Number.isFinite(t)) this.state.simMs = t;
    }
    if (u.fov && u.fov > 0.05 && u.fov < 150) this.state.view.fov = u.fov;
    if (u.ra !== undefined && u.dec !== undefined) {
      // 需要矩阵：先按当前时刻算一次
      const date = new Date(this.state.simMs);
      const eqd = eqjToEqdMatrix(date);
      const hor = eqdToHorizonMatrix(gastDeg(date), this.state.observer.lat, this.state.observer.lon);
      const center = radecToCenterHor(u.ra, u.dec, eqd, hor);
      const aa = unitToAltaz(center);
      this.state.view.alt = Math.max(-89, Math.min(89, aa.alt));
      this.state.view.az = aa.az;
    }
  }

  private setPlace(id: string, writeUrl = true): void {
    const p = findPlace(id);
    if (!p) return;
    this.state.placeId = id;
    this.state.observer = { lat: p.lat, lon: p.lon, elevation: p.elevation };
    void writeUrl;
  }

  private applyLayer(key: string, value: boolean): void {
    (this.state.layers as unknown as Record<string, boolean>)[key] = value;
    this.syncLayerVisibility();
  }

  private syncLayerVisibility(): void {
    const l = this.state.layers;
    if (this.gridLayers[0]) this.gridLayers[0].visible = l.equatorGrid;
    if (this.gridLayers[1]) this.gridLayers[1].visible = l.horizonGrid;
    this.gridLayers[2]!.visible = true; // 地平线常显
    if (this.constellations.western) this.constellations.western.visible = l.constWest;
    if (this.constellations.chinese) this.constellations.chinese.visible = l.constZh;
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
    if (patch.simMs !== undefined) {
      this.state.simMs = patch.simMs;
      this.panel.syncTime(patch.simMs);
    }
    this.urlTimer = 0; // 立即刷新 URL
  }

  private tick(dtMs: number): void {
    const s = this.state;
    s.simMs += dtMs * s.speed;
    const date = new Date(s.simMs);

    // 坐标链 uniform
    const eqd = eqjToEqdMatrix(date);
    const gast = gastDeg(date);
    const hor = eqdToHorizonMatrix(gast, s.observer.lat, s.observer.lon);
    const betaEqd = applyMat3(eqd, earthBeta(date));
    this.curEqd = eqd;
    this.curHor = hor;
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
    this.curFrame = frame;
    (u.uRight.value as THREE.Vector3).set(frame.right.x, frame.right.y, frame.right.z);
    (u.uUp.value as THREE.Vector3).set(frame.up.x, frame.up.y, frame.up.z);
    (u.uFwd.value as THREE.Vector3).set(frame.fwd.x, frame.fwd.y, frame.fwd.z);
    u.uRmax.value = frame.rMax;
    u.uAspect.value = frame.aspect;
    u.uPixelScale.value =
      (this.canvas.clientHeight / 900) * Math.max(0.35, Math.min(2.4, s.view.fov / 60)) * 2.4;

    // 太阳系
    this.solarInfos = solarSystemInfo(date, s.observer);
    this.solarLayer.update(this.solarInfos);
    const sun = this.solarInfos.find((b) => b.name === 'Sun')!;
    const moon = this.solarInfos.find((b) => b.name === 'Moon')!;
    {
      // 月盘受光方向（太阳 − 月亮，投影到屏幕平面）
      const dx = sun.unit.x - moon.unit.x;
      const dy = sun.unit.y - moon.unit.y;
      const dz = sun.unit.z - moon.unit.z;
      const litEqd = normalize({ x: dx, y: dy, z: dz });
      const litHor = applyMat3(hor, litEqd);
      const lx = litHor.x * frame.right.x + litHor.y * frame.right.y + litHor.z * frame.right.z;
      const ly = litHor.x * frame.up.x + litHor.y * frame.up.y + litHor.z * frame.up.z;
      const len = Math.hypot(lx, ly) || 1;
      this.solarLayer.moonLitDir.value.set(lx / len, ly / len);
    }

    // 背景 uniform：银河矩阵、天光
    const bg = this.renderer.bgUniforms;
    const horToGal = mulMat3(EQJ_GAL, mulMat3(transposeMat3(eqd), transposeMat3(hor)));
    (bg.uHorToGal.value as THREE.Matrix3).fromArray(toColMajor(horToGal));
    bg.uMilkyOpacity.value = s.layers.milkyway ? 0.78 : 0;
    const sunAltDeg = sun.altaz.alt;
    bg.uSunAltDeg.value = sunAltDeg;
    const sunDirHor = applyMat3(hor, sun.unit);
    (bg.uSunDirHor.value as THREE.Vector3).set(sunDirHor.x, sunDirHor.y, sunDirHor.z);
    const nightFactor = Math.max(0, Math.min(1, -sunAltDeg / 6));
    bg.uSkyGlow.value =
      moonGlowFromAltaz(moon.altaz.alt, moon.illumFraction, s.layers.atmDensity) *
      0.85 *
      nightFactor;

    // 视野中心（EQJ 系，供切片加载）
    const altR = (s.view.alt * Math.PI) / 180;
    const azR = (s.view.az * Math.PI) / 180;
    const centerHor = {
      x: Math.cos(altR) * Math.cos(azR),
      y: Math.cos(altR) * Math.sin(azR),
      z: Math.sin(altR),
    };
    const centerEqj = normalize(
      applyMat3(transposeMat3(hor), applyMat3(transposeMat3(eqd), centerHor)),
    );
    this.starfield?.update(centerEqj, s.view.fov);

    // HTML 标签 + 面板
    this.labels.update({
      eqd,
      hor,
      frame,
      fov: s.view.fov,
      solar: this.solarInfos,
      showStarNames: s.layers.labels,
      showDirections: true,
      showSolarNames: true,
    });
    this.panel.refresh(s);

    // URL 节流（800ms）
    this.urlTimer -= dtMs;
    if (this.urlTimer <= 0) {
      this.urlTimer = 800;
      const rd = centerToRadec(centerHor, eqd, hor);
      const d = new Date(s.simMs);
      writeHash({
        ra: rd.ra,
        dec: rd.dec,
        fov: s.view.fov,
        t: `${d.toISOString().slice(0, 19)}Z`,
        place: s.placeId,
      });
    }

    this.renderer.render();
  }

  // -------------------------------------------------------------------------
  // 拾取
  // -------------------------------------------------------------------------

  private pickAt(clientX: number, clientY: number): void {
    const rect = this.canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    const px = clientX - rect.left;
    const py = clientY - rect.top;
    let best: PickHit | null = null;
    let bestDist = Math.max(10, h * 0.018); // 像素容差

    // 太阳系天体
    for (const b of this.solarInfos) {
      if (b.altaz.alt < -1) continue;
      const pos = projectHorizon(applyMat3(this.curHor, b.unit), this.curFrame);
      if (!pos.visible) continue;
      const sx = ((pos.x + 1) / 2) * w;
      const sy = ((1 - pos.y) / 2) * h;
      const d = Math.hypot(sx - px, sy - py);
      if (d < bestDist) {
        bestDist = d;
        best = { kind: 'solar', info: b };
      }
    }

    // 星（当前已加载可见档）
    if (this.starfield) {
      const eqd = this.curEqd;
      const hor = this.curHor;
      const beta = this.renderer.uniforms.uBeta.value as THREE.Vector3;
      const betaV = { x: beta.x, y: beta.y, z: beta.z };
      const years = this.renderer.uniforms.uYears.value as number;
      const MAS2RAD = (Math.PI / 180) / 3_600_000;
      let bestTyc = 0;
      let bestMag = 0;
      let bestBv = 0;
      let bestVec: { x: number; y: number; z: number } | null = null; // EQJ 星表位置
      let bestHor: { x: number; y: number; z: number } | null = null; // 地平视位置
      this.starfield.pickSource().forEach((x, y, z, mag, bv, pmRa, pmDec, tyc) => {
        if (mag > 9.5) return;
        // 与顶点着色器一致的链路：自行 → 岁差 → 光行差 → 地平
        const ra = Math.atan2(y, x);
        const dec = Math.asin(Math.max(-1, Math.min(1, z)));
        const sa = Math.sin(ra);
        const ca = Math.cos(ra);
        const sd = Math.sin(dec);
        const cd = Math.cos(dec);
        const dA = years * MAS2RAD * pmRa;
        const dD = years * MAS2RAD * pmDec;
        const u0 = {
          x: x + dA * -sa + dD * -sd * ca,
          y: y + dA * ca + dD * -sd * sa,
          z: z + dD * cd,
        };
        const u1 = applyMat3(eqd, u0);
        const ub = u1.x * betaV.x + u1.y * betaV.y + u1.z * betaV.z;
        const nl =
          Math.hypot(u1.x + betaV.x - ub * u1.x, u1.y + betaV.y - ub * u1.y, u1.z + betaV.z - ub * u1.z) || 1;
        const hv = applyMat3(hor, {
          x: (u1.x + betaV.x - ub * u1.x) / nl,
          y: (u1.y + betaV.y - ub * u1.y) / nl,
          z: (u1.z + betaV.z - ub * u1.z) / nl,
        });
        if (hv.z < -0.005) return;
        const pos = projectHorizon(hv, this.curFrame);
        if (!pos.visible) return;
        const sx = ((pos.x + 1) / 2) * w;
        const sy = ((1 - pos.y) / 2) * h;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestDist) {
          bestDist = d;
          bestTyc = tyc;
          bestMag = mag;
          bestBv = bv;
          bestVec = { x, y, z };
          bestHor = hv;
        }
      });
      if (bestVec && bestHor && bestTyc > 0) {
        const t1 = bestTyc >>> 17;
        const t2 = (bestTyc >>> 3) & 0x3fff;
        const t3 = bestTyc & 7;
        const tycStr = `${t1}-${t2}-${t3}`;
        const names = this.namesMap[tycStr] ?? {};
        const rd = unitToRadecOf(bestVec); // J2000 星表坐标
        const aa = unitToAltaz(bestHor);
        best = {
          kind: 'star',
          tyc: tycStr,
          names,
          mag: bestMag,
          bv: bestBv,
          radec: rd,
          altaz: aa,
        };
      }
    }

    if (best) this.infoCard.show(best);
    else this.infoCard.hide();
  }

  private namesMap: Record<string, { en?: string; zh?: string }> = {};

  // -------------------------------------------------------------------------
  // 输入
  // -------------------------------------------------------------------------

  private bindInput(): void {
    const cv = this.canvas;
    cv.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.downX = this.lastX = e.clientX;
      this.downY = this.lastY = e.clientY;
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const s = this.state;
      const k = (s.view.fov / 900) * 1.15;
      let az = s.view.az + (e.clientX - this.lastX) * k;
      const alt = Math.max(-89, Math.min(89, s.view.alt + (e.clientY - this.lastY) * k));
      az = ((az % 360) + 360) % 360;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.setState({ view: { alt, az, fov: s.view.fov } });
    });
    const endDrag = (e: PointerEvent): void => {
      if (this.dragging && Math.hypot(e.clientX - this.downX, e.clientY - this.downY) < 4) {
        this.pickAt(e.clientX, e.clientY);
      }
      this.dragging = false;
    };
    cv.addEventListener('pointerup', endDrag);
    cv.addEventListener('pointercancel', () => {
      this.dragging = false;
    });
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

function unitToRadecOf(v: Vec3): { ra: number; dec: number } {
  const n = Math.hypot(v.x, v.y, v.z) || 1;
  const z = v.z / n;
  let ra = (Math.atan2(v.y, v.x) * 180) / Math.PI;
  if (ra < 0) ra += 360;
  return { ra, dec: (Math.asin(Math.max(-1, Math.min(1, z))) * 180) / Math.PI };
}

function toColMajor(m: Mat3): number[] {
  return [m[0]!, m[3]!, m[6]!, m[1]!, m[4]!, m[7]!, m[2]!, m[5]!, m[8]!];
}
