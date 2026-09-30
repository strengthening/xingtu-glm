/**
 * 点选信息卡：显示星 / 太阳系天体的名称、星等、坐标等。
 * 点击（非拖拽）时从拾取源中找屏幕最近目标。
 */
import type { Altaz, Radec } from '../astro/types';
import type { SolarBodyInfo } from '../astro/solarSystem';

export interface StarPickHit {
  kind: 'star';
  tyc: string;
  names: { en?: string; zh?: string };
  mag: number;
  bv: number;
  radec: Radec;
  altaz: Altaz;
}

export interface SolarPickHit {
  kind: 'solar';
  info: SolarBodyInfo;
}

export type PickHit = StarPickHit | SolarPickHit;

export class InfoCard {
  private el: HTMLElement;
  onClose?: () => void;
  current: PickHit | null = null;

  constructor(el: HTMLElement) {
    this.el = el;
    const close = document.createElement('button');
    close.className = 'close';
    close.textContent = '×';
    close.addEventListener('click', () => this.hide());
    this.el.appendChild(close);
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hide(): void {
    this.el.hidden = true;
    this.current = null;
  }

  show(hit: PickHit): void {
    this.current = hit;
    const table = document.createElement('table');
    const rows: [string, string][] = [];
    if (hit.kind === 'star') {
      const title = hit.names.zh ?? hit.names.en ?? `TYC ${hit.tyc}`;
      this.setTitle(title + (hit.names.zh && hit.names.en ? ` · ${hit.names.en}` : ''));
      rows.push(['星等 (V)', hit.mag.toFixed(2)]);
      rows.push(['色指数 B−V', hit.bv.toFixed(2)]);
      rows.push(['赤经 α', fmtRaN(hit.radec.ra)]);
      rows.push(['赤纬 δ', fmtDec(hit.radec.dec)]);
      rows.push(['方位角', `${hit.altaz.az.toFixed(1)}°`]);
      rows.push(['高度角', `${hit.altaz.alt.toFixed(1)}°`]);
      rows.push(['Tycho-2', hit.tyc]);
    } else {
      const b = hit.info;
      this.setTitle(b.label);
      rows.push(['星等', b.mag.toFixed(1)]);
      rows.push(['赤经 α', fmtRaN(b.radec.ra)]);
      rows.push(['赤纬 δ', fmtDec(b.radec.dec)]);
      rows.push(['方位角', `${b.altaz.az.toFixed(1)}°`]);
      rows.push(['高度角', `${b.altaz.alt.toFixed(1)}°`]);
      rows.push(['距地', `${b.distAu.toFixed(3)} AU`]);
      if (b.name === 'Moon') rows.push(['月相', `${(b.illumFraction * 100).toFixed(0)}%`]);
      rows.push(['视角径', b.angularDiameter >= 1 / 60 ? `${(b.angularDiameter * 60).toFixed(1)}′` : `${(b.angularDiameter * 3600).toFixed(1)}″`]);
    }
    for (const [k, v] of rows) {
      const tr = document.createElement('tr');
      const td1 = document.createElement('td');
      td1.textContent = k;
      const td2 = document.createElement('td');
      td2.textContent = v;
      tr.appendChild(td1);
      tr.appendChild(td2);
      table.appendChild(tr);
    }
    this.el.querySelectorAll('table').forEach((t) => t.remove());
    this.el.appendChild(table);
    this.el.hidden = false;
  }

  private setTitle(text: string): void {
    let h2 = this.el.querySelector('h2');
    if (!h2) {
      h2 = document.createElement('h2');
      this.el.insertBefore(h2, this.el.firstChild);
    }
    h2.textContent = text;
  }
}

export function fmtRaN(raDeg: number): string {
  const h = raDeg / 15;
  const hh = Math.floor(h);
  const m = (h - hh) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  return `${hh}h ${String(mm).padStart(2, '0')}m ${ss.toFixed(1)}s`;
}

export function fmtDec(decDeg: number): string {
  const sign = decDeg < 0 ? '−' : '+';
  const a = Math.abs(decDeg);
  const dd = Math.floor(a);
  const m = (a - dd) * 60;
  const mm = Math.floor(m);
  const ss = (m - mm) * 60;
  return `${sign}${dd}° ${String(mm).padStart(2, '0')}′ ${ss.toFixed(0)}″`;
}
