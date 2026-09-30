/**
 * HTML 标签层：亮星名（默认 mag<2，放大显示更多）、方位标记、太阳系天体名。
 * 每帧用 CPU 投影（与顶点着色器同一公式）更新 div 池。
 */
import { applyMat3 } from '../astro/coords';
import type { Mat3, Vec3 } from '../astro/types';
import { projectHorizon, type CameraFrame } from './projection';
import type { SolarBodyInfo } from '../astro/solarSystem';

export interface NamedStar {
  x: number;
  y: number;
  z: number;
  mag: number;
  name: string;
}

interface LabelEntry {
  dir: Vec3; // 地平系单位向量
  text: string;
  cls: string;
  priority: number;
}

const DIRS_8: { az: number; text: string }[] = [
  { az: 0, text: '北' },
  { az: 45, text: '东北' },
  { az: 90, text: '东' },
  { az: 135, text: '东南' },
  { az: 180, text: '南' },
  { az: 225, text: '西南' },
  { az: 270, text: '西' },
  { az: 315, text: '西北' },
];

const MAX_LABELS = 90;

export class LabelLayer {
  private container: HTMLElement;
  private pool: HTMLDivElement[] = [];
  private namedStars: NamedStar[] = [];

  constructor(container: HTMLElement) {
    this.container = container;
    for (let i = 0; i < MAX_LABELS; i++) {
      const div = document.createElement('div');
      div.className = 'star-label';
      div.style.display = 'none';
      container.appendChild(div);
      this.pool.push(div);
    }
  }

  setNamedStars(stars: NamedStar[]): void {
    this.namedStars = stars;
  }

  /** 每帧更新。eqd/hor 为当前矩阵；namedStars 是 EQJ 向量。 */
  update(opts: {
    eqd: Mat3;
    hor: Mat3;
    frame: CameraFrame;
    fov: number;
    solar: SolarBodyInfo[];
    showStarNames: boolean;
    showDirections: boolean;
    showSolarNames: boolean;
  }): void {
    const { eqd, hor, frame, fov, solar } = opts;
    const entries: LabelEntry[] = [];

    // 方位标记（地平系，固定）
    if (opts.showDirections) {
      for (const d of DIRS_8) {
        const a = (d.az * Math.PI) / 180;
        entries.push({
          dir: { x: Math.cos(a), y: Math.sin(a), z: Math.sin((-0.8 * Math.PI) / 180) },
          text: d.text,
          cls: 'dir-marker',
          priority: 10,
        });
      }
    }

    // 太阳系天体名
    if (opts.showSolarNames) {
      for (const b of solar) {
        if (b.altaz.alt < -1) continue;
        entries.push({
          dir: applyMat3(hor, b.unit),
          text: b.label,
          cls: 'star-label solar-label',
          priority: 20,
        });
      }
    }

    // 亮星名：FOV 越小显示越多
    if (opts.showStarNames && this.namedStars.length > 0) {
      const magLimit = fov > 60 ? 2.0 : fov > 25 ? 3.2 : fov > 10 ? 4.5 : 6.0;
      for (const s of this.namedStars) {
        if (s.mag > magLimit) continue;
        entries.push({
          dir: applyMat3(hor, applyMat3(eqd, { x: s.x, y: s.y, z: s.z })),
          text: s.name,
          cls: 'star-label',
          priority: 30,
        });
      }
    }

    // 投影 + 排序（视野中心优先）
    entries.sort((a, b) => a.priority - b.priority);
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    let used = 0;
    for (const entry of entries) {
      if (used >= MAX_LABELS) break;
      const p = projectHorizon(entry.dir, frame);
      if (!p.visible || Math.abs(p.x) > 0.97 || Math.abs(p.y) > 0.97) continue;
      const div = this.pool[used]!;
      div.textContent = entry.text;
      div.className = entry.cls;
      div.style.display = 'block';
      div.style.left = `${(((p.x + 1) / 2) * w).toFixed(1)}px`;
      div.style.top = `${(((1 - p.y) / 2) * h).toFixed(1)}px`;
      used++;
    }
    for (let i = used; i < this.pool.length; i++) {
      this.pool[i]!.style.display = 'none';
    }
  }
}
