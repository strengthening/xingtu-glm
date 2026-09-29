/**
 * Info card: click-picking of stars and solar-system bodies, showing names,
 * catalog ids, coordinates (J2000 + current horizontal), magnitudes, color
 * index and proper motion.
 */
import type { Engine } from '../core/engine';
import type * as THREE from 'three';
import { unpackTyc } from '../data/tyc';
import { applyMat3 } from '../render/projection';
import { raDecFromUnitVector } from '../astro/coords';
import type { BodyInfo } from '../astro/solarSystem';
import type { Vec3 } from '../astro/types';
import type { NamedStar } from '../render/labels';

interface StarHit {
  dirEqj: Vec3;
  mag: number;
  bv: number;
  pmRa: number;
  pmDec: number;
  tycId: number;
}

export class InfoCard {
  private el: HTMLElement;
  private namesByTyc = new Map<string, NamedStar>();

  constructor(private engine: Engine) {
    this.el = document.getElementById('infocard')!;
    engine.pickHandler = (x, y) => this.pick(x, y);
  }

  loadNames(entries: NamedStar[]): void {
    for (const e of entries) this.namesByTyc.set(e.tyc, e);
  }

  hide(): void {
    this.el.classList.add('hidden');
  }

  private pick(ndcX: number, ndcY: number): void {
    const dirHor = this.engine.renderer.skyCamera.unproject(ndcX, ndcY);
    // 1) solar-system bodies (generous radius).
    const cam = this.engine.renderer.skyCamera;
    const fov = cam.fovDeg;
    const bodyRadius = Math.max(0.4, fov / 30);
    let bestBody: { info: BodyInfo; sep: number } | null = null;
    for (const b of this.engine.solarSystem.bodiesHor) {
      const sep = angleBetween(dirHor, b.dirHor);
      if (sep < bodyRadius && (!bestBody || sep < bestBody.sep)) {
        bestBody = { info: b.info, sep };
      }
    }
    if (bestBody) {
      this.showBody(bestBody.info, dirHor);
      return;
    }
    // 2) stars from loaded tiles.
    const hit = this.pickStar(dirHor);
    if (hit) {
      this.showStar(hit);
      return;
    }
    this.hide();
  }

  private pickStar(dirHor: Vec3): StarHit | null {
    const frame = this.engine.frame;
    const m = frame.rotEqjToHor;
    const dirEqj = applyMat3T(m, dirHor);
    const toleranceDeg = Math.max(0.08, this.engine.renderer.skyCamera.fovDeg / 50);
    let best: (StarHit & { sep: number }) | null = null;
    for (const tile of this.engine.catalog.starsWithin()) {
      const geo = tile.points.geometry;
      const pos = geo.getAttribute('position') as THREE.InterleavedBufferAttribute;
      const magAttr = geo.getAttribute('mag') as THREE.InterleavedBufferAttribute;
      const bvAttr = geo.getAttribute('bv') as THREE.InterleavedBufferAttribute;
      const pmAttr = geo.getAttribute('pm') as THREE.InterleavedBufferAttribute;
      const ids = tile.ids ?? [];
      const n = pos.count;
      const stride = pos.data.stride; // interleaved stride in floats
      void stride;
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i);
        const y = pos.getY(i);
        const z = pos.getZ(i);
        const d = x * dirEqj[0] + y * dirEqj[1] + z * dirEqj[2];
        if (d < 0.999) continue;
        const sep = Math.acos(Math.min(1, d)) * (180 / Math.PI);
        if (sep < toleranceDeg && (!best || sep < best.sep)) {
          best = {
            sep,
            dirEqj: [x, y, z],
            mag: magAttr.getX(i),
            bv: bvAttr.getX(i),
            pmRa: pmAttr.getX(i),
            pmDec: pmAttr.getY(i),
            tycId: ids[i] ?? 0,
          };
        }
      }
    }
    return best;
  }

  private row(label: string, value: string): string {
    return `<tr><td>${label}</td><td>${value}</td></tr>`;
  }

  private showStar(hit: StarHit): void {
    const { ra, dec } = raDecFromUnitVector(hit.dirEqj);
    const altAz = altAzOf(this.engine, hit.dirEqj);
    const [t1, t2, t3] = unpackTyc(hit.tycId);
    const named = this.namesByTyc.get(`${t1}-${t2}-${t3}`);
    const title = named
      ? [named.zh[0], named.en, named.bayer].filter(Boolean).join(' · ')
      : `TYC ${t1}-${t2}-${t3}`;
    const sub = named ? `TYC ${t1}-${t2}-${t3}${named.hip ? ` · HIP ${named.hip}` : ''}` : 'Tycho-2';
    const bv = hit.bv;
    const colorNote = bvColorNote(bv);
    this.el.innerHTML = `
      <button class="close" title="关闭">✕</button>
      <h3>${escapeHtml(title)}</h3>
      <div class="sub">${escapeHtml(sub)}</div>
      <table>
        ${this.row('视星等 V', hit.mag.toFixed(2))}
        ${this.row('色指数 B-V', `${bv.toFixed(2)} (${colorNote})`)}
        ${this.row('赤经 RA', fmtRa(ra))}
        ${this.row('赤纬 Dec', fmtDec(dec))}
        ${this.row('地平 Alt/Az', `${altAz.altitude.toFixed(2)}° / ${altAz.azimuth.toFixed(2)}°`)}
        ${this.row('自行', `${hit.pmRa.toFixed(1)} / ${hit.pmDec.toFixed(1)} mas/yr`)}
      </table>`;
    this.el.classList.remove('hidden');
    this.el.querySelector('.close')?.addEventListener('click', () => this.hide());
  }

  private showBody(info: BodyInfo, dirHor: Vec3): void {
    const alt = (Math.asin(Math.max(-1, Math.min(1, dirHor[2]))) * 180) / Math.PI;
    let az = (Math.atan2(dirHor[1], -dirHor[0]) * 180) / Math.PI;
    if (az < 0) az += 360;
    this.el.innerHTML = `
      <button class="close" title="关闭">✕</button>
      <h3>${escapeHtml(info.label)}</h3>
      <div class="sub">太阳系天体</div>
      <table>
        ${this.row('视星等', info.magnitude.toFixed(1))}
        ${this.row('地平 Alt/Az', `${alt.toFixed(2)}° / ${az.toFixed(2)}°`)}
        ${this.row('赤经 RA', fmtRa(info.raDeg))}
        ${this.row('赤纬 Dec', fmtDec(info.decDeg))}
        ${this.row('距离', `${info.distAu.toFixed(3)} AU`)}
        ${this.row('角直径', `${(info.angularDiameterDeg * 3600).toFixed(1)}″`)}
        ${info.key !== 'sun' ? this.row('照亮比', `${(info.phase * 100).toFixed(0)}%`) : ''}
        ${info.elongationDeg !== null ? this.row('距角', `${info.elongationDeg.toFixed(1)}°`) : ''}
      </table>`;
    this.el.classList.remove('hidden');
    this.el.querySelector('.close')?.addEventListener('click', () => this.hide());
  }
}

function altAzOf(engine: Engine, dirEqj: Vec3): { altitude: number; azimuth: number } {
  const h = applyMat3(engine.frame.rotEqjToHor, dirEqj);
  const altitude = (Math.asin(Math.max(-1, Math.min(1, h[2]))) * 180) / Math.PI;
  let azimuth = (Math.atan2(h[1], -h[0]) * 180) / Math.PI;
  if (azimuth < 0) azimuth += 360;
  return { altitude, azimuth };
}

function angleBetween(a: Vec3, b: Vec3): number {
  const d = Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]));
  return (Math.acos(d) * 180) / Math.PI;
}

/** Transpose-apply: horizontal -> J2000. */
function applyMat3T(m: readonly number[], v: Vec3): Vec3 {
  return [
    m[0]! * v[0] + m[3]! * v[1] + m[6]! * v[2],
    m[1]! * v[0] + m[4]! * v[1] + m[7]! * v[2],
    m[2]! * v[0] + m[5]! * v[1] + m[8]! * v[2],
  ];
}

function bvColorNote(bv: number): string {
  if (bv < 0.0) return '蓝白 O/B 型';
  if (bv < 0.3) return '白 A 型';
  if (bv < 0.58) return '黄白 F 型';
  if (bv < 0.81) return '黄 G 型';
  if (bv < 1.4) return '橙 K 型';
  return '红 M 型';
}

export function fmtRa(raDeg: number): string {
  const h = Math.floor(raDeg / 15);
  const m = Math.floor(((raDeg / 15 - h) * 60));
  const s = ((raDeg / 15 - h) * 60 - m) * 60;
  return `${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${s.toFixed(1)}s`;
}

export function fmtDec(decDeg: number): string {
  const sign = decDeg < 0 ? '−' : '+';
  const a = Math.abs(decDeg);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60;
  return `${sign}${String(d).padStart(2, '0')}° ${String(m).padStart(2, '0')}′ ${s.toFixed(0)}″`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
