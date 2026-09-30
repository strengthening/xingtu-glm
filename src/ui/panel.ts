/**
 * 控制面板：地点（北/南半球两组）、时间与速度、图层开关、大气浓度。
 */
import { PLACES } from '../astro/places';
import type { SkyState } from '../core/engine';
import { SPEED_STEPS } from '../core/engine';

const SPEED_LABELS: Record<number, string> = {
  0: '暂停',
  1: '实时',
  60: '1 分钟/秒',
  600: '10 分钟/秒',
  3600: '1 小时/秒',
  86400: '1 天/秒',
};

function toLocalInputValue(ms: number): string {
  const d = new Date(ms - new Date(ms).getTimezoneOffset() * 60000);
  const p = (n: number, w = 2): string => String(n).padStart(w, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export interface PanelCallbacks {
  onObserver(placeId: string): void;
  onTime(ms: number): void;
  onSpeed(speed: number): void;
  onLayer(key: string, value: boolean): void;
  onAtm(density: number): void;
  onNow(): void;
}

export class Panel {
  private timeInput: HTMLInputElement;
  private fovSpan: HTMLSpanElement;
  private clockSpan: HTMLSpanElement;
  private placeSelect: HTMLSelectElement;

  constructor(container: HTMLElement, state: SkyState, cb: PanelCallbacks) {
    container.innerHTML = '';

    const h3 = (text: string): HTMLElement => {
      const el = document.createElement('h3');
      el.textContent = text;
      return el;
    };

    // ---- 观测地点 ----
    container.appendChild(h3('观测地点'));
    this.placeSelect = document.createElement('select');
    this.placeSelect.style.width = '100%';
    for (const hemi of ['north', 'south'] as const) {
      const group = document.createElement('optgroup');
      group.label = hemi === 'north' ? '北半球' : '南半球';
      for (const p of PLACES.filter((x) => x.hemisphere === hemi)) {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = p.name;
        group.appendChild(opt);
      }
      this.placeSelect.appendChild(group);
    }
    this.placeSelect.value = 'shanghai';
    this.placeSelect.addEventListener('change', () => cb.onObserver(this.placeSelect.value));
    container.appendChild(this.placeSelect);

    // ---- 时间 ----
    container.appendChild(h3('时间'));
    this.timeInput = document.createElement('input');
    this.timeInput.type = 'datetime-local';
    this.timeInput.step = '1';
    this.timeInput.style.width = '100%';
    this.timeInput.value = toLocalInputValue(state.simMs);
    this.timeInput.addEventListener('change', () => {
      const t = new Date(this.timeInput.value).getTime();
      if (Number.isFinite(t)) cb.onTime(t);
    });
    container.appendChild(this.timeInput);

    const speedRow = document.createElement('div');
    speedRow.className = 'row';
    const speedSelect = document.createElement('select');
    speedSelect.style.flex = '1';
    for (const s of SPEED_STEPS) {
      const opt = document.createElement('option');
      opt.value = String(s);
      opt.textContent = SPEED_LABELS[s] ?? `${s}×`;
      speedSelect.appendChild(opt);
    }
    speedSelect.value = String(state.speed);
    speedSelect.addEventListener('change', () => cb.onSpeed(Number(speedSelect.value)));
    const nowBtn = document.createElement('button');
    nowBtn.textContent = '现在';
    nowBtn.addEventListener('click', () => cb.onNow());
    speedRow.appendChild(speedSelect);
    speedRow.appendChild(nowBtn);
    container.appendChild(speedRow);
    this.clockSpan = document.createElement('span');
    this.clockSpan.className = 'hint';
    container.appendChild(this.clockSpan);

    // ---- 显示图层 ----
    container.appendChild(h3('显示'));
    const layers: { key: keyof SkyState['layers'] | 'equatorGrid' | 'horizonGrid' | 'constWest' | 'constZh' | 'labels'; label: string }[] = [
      { key: 'equatorGrid', label: '赤道网格' },
      { key: 'horizonGrid', label: '地平网格' },
      { key: 'constWest', label: '西方星座连线' },
      { key: 'constZh', label: '三垣二十八宿' },
      { key: 'labels', label: '亮星名称' },
      { key: 'milkyway', label: '银河背景' },
    ];
    const checked = new Set<string>(['labels', 'milkyway']);
    for (const layer of layers) {
      const row = document.createElement('div');
      row.className = 'row';
      const id = `layer-${String(layer.key)}`;
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = id;
      input.checked = checked.has(String(layer.key));
      input.addEventListener('change', () => cb.onLayer(String(layer.key), input.checked));
      const label = document.createElement('label');
      label.htmlFor = id;
      label.textContent = layer.label;
      row.appendChild(input);
      row.appendChild(label);
      container.appendChild(row);
    }

    // ---- 大气 ----
    container.appendChild(h3('大气浓度'));
    const atmRow = document.createElement('div');
    atmRow.className = 'row';
    const atmInput = document.createElement('input');
    atmInput.type = 'range';
    atmInput.min = '0';
    atmInput.max = '100';
    atmInput.value = String(Math.round(state.layers.atmDensity * 100));
    atmInput.style.flex = '1';
    atmInput.addEventListener('input', () => cb.onAtm(Number(atmInput.value) / 100));
    const atmVal = document.createElement('span');
    atmVal.style.width = '3em';
    atmVal.style.textAlign = 'right';
    atmVal.textContent = `${atmInput.value}%`;
    atmInput.addEventListener('input', () => {
      atmVal.textContent = `${atmInput.value}%`;
    });
    atmRow.appendChild(atmInput);
    atmRow.appendChild(atmVal);
    container.appendChild(atmRow);

    // ---- 视角信息 ----
    container.appendChild(h3('视角'));
    const fovDiv = document.createElement('div');
    fovDiv.className = 'hint';
    this.fovSpan = document.createElement('span');
    fovDiv.appendChild(this.fovSpan);
    container.appendChild(fovDiv);
  }

  /** 每帧轻量刷新（时钟与 FOV 读数；时间流动时同步输入框）。 */
  refresh(state: SkyState): void {
    const d = new Date(state.simMs);
    const p = (n: number): string => String(n).padStart(2, '0');
    this.clockSpan.textContent = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
    this.fovSpan.textContent = `视场 ${state.view.fov.toFixed(1)}° | 高度 ${state.view.alt.toFixed(0)}° | 方位 ${state.view.az.toFixed(0)}°`;
    // 时间输入框跟随模拟时间（仅在用户未聚焦编辑时）
    if (document.activeElement !== this.timeInput) {
      const v = toLocalInputValue(state.simMs);
      if (v !== this.lastSynced) {
        this.lastSynced = v;
        this.timeInput.value = v;
      }
    }
  }

  private lastSynced = '';

  syncTime(ms: number): void {
    this.timeInput.value = toLocalInputValue(ms);
    this.lastSynced = this.timeInput.value;
  }
}
