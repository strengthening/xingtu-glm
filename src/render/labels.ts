/**
 * DOM overlay labels: star names (magnitude-gated by zoom), solar-system
 * body names, cardinal directions. Uses a fixed label pool; positions are
 * recomputed each frame by projecting horizontal-frame directions.
 */
import type { SkyCamera } from './projection';
import type { Vec3 } from '../astro/types';
import { applyMat3 } from './projection';
import type { SkyFrame } from '../astro/sky';

export interface NamedStar {
  tyc: string;
  hip: number;
  mag: number;
  xyz: [number, number, number];
  en?: string;
  bayer?: string;
  flam?: string;
  zh: string[];
}

interface PoolEntry {
  el: HTMLDivElement;
}

/** Label magnitude limit as a function of FOV (degrees). */
export function labelMagLimit(fovDeg: number): number {
  if (fovDeg > 120) return 1.5;
  if (fovDeg > 60) return 2.0;
  if (fovDeg > 30) return 3.2;
  if (fovDeg > 15) return 4.2;
  if (fovDeg > 6) return 5.0;
  return 6.2;
}

export class LabelRenderer {
  private pool: PoolEntry[] = [];
  private container: HTMLElement;
  namedStars: NamedStar[] = [];
  private zhPreferred = true;

  constructor(container: HTMLElement) {
    this.container = container;
  }

  async load(): Promise<void> {
    const res = await fetch('/data/names.json');
    if (!res.ok) return;
    const data = (await res.json()) as { entries: NamedStar[] };
    this.namedStars = data.entries;
  }

  displayName(star: NamedStar): string {
    if (this.zhPreferred && star.zh.length > 0) return star.zh[0]!;
    return star.en ?? star.bayer ?? star.flam ?? '';
  }

  private acquire(i: number, cls: string): HTMLDivElement {
    let entry = this.pool[i];
    if (!entry) {
      const el = document.createElement('div');
      this.container.append(el);
      entry = { el };
      this.pool[i] = entry;
    }
    if (!entry.el.classList.contains(cls)) {
      entry.el.className = `sky-label ${cls}`;
    }
    entry.el.style.display = '';
    return entry.el;
  }

  private hideFrom(i: number): void {
    for (let j = i; j < this.pool.length; j++) {
      this.pool[j]!.el.style.display = 'none';
    }
  }

  /**
   * update() draws: cardinals, body labels, then star labels up to the
   * pool cap. `bodiesHor` provides {name, dirHor} entries.
   */
  update(
    frame: SkyFrame,
    camera: SkyCamera,
    widthPx: number,
    heightPx: number,
    options: { labels: boolean; ground: boolean },
    bodiesHor: { name: string; dirHor: Vec3 }[],
    cardinalDirs: { label: string; dir: Vec3 }[],
  ): void {
    let idx = 0;
    const place = (dirHor: Vec3, text: string, cls: string, dx = 10, dy = -10): boolean => {
      const p = camera.projectToPixels(dirHor, widthPx, heightPx);
      if (!p) return false;
      const el = this.acquire(idx++, cls);
      el.textContent = text;
      el.style.left = `${(p.x + dx).toFixed(1)}px`;
      el.style.top = `${(p.y + dy).toFixed(1)}px`;
      return true;
    };

    // Cardinal directions.
    for (const c of cardinalDirs) {
      place(c.dir, c.label, 'cardinal', 0, 0);
    }

    // Solar-system bodies.
    if (options.labels) {
      for (const b of bodiesHor) {
        place(b.dirHor, b.name, 'body-label', 12, -6);
      }

      // Star labels, brightest first, capped by FOV-aware magnitude limit.
      const limit = labelMagLimit(camera.fovDeg);
      const rot = frame.rotEqjToHor;
      let shown = 0;
      const MAX = 220;
      for (const star of this.namedStars) {
        if (star.mag > limit) break;
        if (shown >= MAX) break;
        const h = applyMat3(rot, star.xyz);
        if (h[2] < 0.02) continue; // below/near horizon
        const name = this.displayName(star);
        if (!name) continue;
        if (place(h, name, 'star-label', 8, -12)) shown++;
      }
    }

    this.hideFrom(idx);
  }
}
