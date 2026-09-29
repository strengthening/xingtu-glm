/**
 * Control panel: observer location, time playback, display toggles,
 * atmosphere slider. Styled to look clearly interactive (task requirement).
 */
import type { Engine } from '../core/engine';
import { PLACES } from '../astro/places';

const TIME_STEPS = [
  { label: '⏸', rate: 0, title: '暂停' },
  { label: '1×', rate: 1, title: '实时' },
  { label: '10×', rate: 10, title: '10 倍速' },
  { label: '60×', rate: 60, title: '1 秒 = 1 分钟' },
  { label: '600×', rate: 600, title: '1 秒 = 10 分钟' },
  { label: '1h/s', rate: 3600, title: '1 秒 = 1 小时' },
  { label: '1d/s', rate: 86400, title: '1 秒 = 1 天' },
];

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

export function attachUI(engine: Engine): void {
  const panel = document.getElementById('panel')!;

  // ---------- location ----------
  const locTitle = el('div', 'panel-title');
  locTitle.textContent = '观测地点';
  panel.append(locTitle);

  const placeSelect = el('select');
  placeSelect.className = 'input';
  const north = el('optgroup');
  north.label = '北半球';
  const south = el('optgroup');
  south.label = '南半球';
  for (const p of PLACES) {
    const opt = el('option');
    opt.value = p.id;
    opt.textContent = p.name;
    (p.hemisphere === 'north' ? north : south).append(opt);
  }
  placeSelect.append(north, south);
  panel.append(placeSelect);

  const latRow = el('div', 'coord-row');
  const latInput = el('input', 'input narrow');
  latInput.type = 'number';
  latInput.step = '0.01';
  latInput.min = '-89.9';
  latInput.max = '89.9';
  latInput.title = '纬度 (+北)';
  const lonInput = el('input', 'input narrow');
  lonInput.type = 'number';
  lonInput.step = '0.01';
  lonInput.title = '经度 (+东)';
  latRow.append(latInput, lonInput);
  panel.append(latRow);

  function applyPlace(): void {
    const p = PLACES.find((x) => x.id === placeSelect.value) ?? PLACES[0]!;
    latInput.value = p.latitude.toFixed(2);
    lonInput.value = p.longitude.toFixed(2);
    engine.setObserver({
      latitude: p.latitude,
      longitude: p.longitude,
      elevation: p.elevation,
    });
  }
  placeSelect.addEventListener('change', applyPlace);
  function applyCustom(): void {
    const lat = Number(latInput.value);
    const lon = Number(lonInput.value);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
    engine.setObserver({ latitude: lat, longitude: lon, elevation: 0 });
  }
  latInput.addEventListener('change', applyCustom);
  lonInput.addEventListener('change', applyCustom);
  applyPlace();

  // ---------- time ----------
  const timeTitle = el('div', 'panel-title');
  timeTitle.textContent = '时间';
  panel.append(timeTitle);

  const clock = el('div', 'clock');
  panel.append(clock);

  const timeRow = el('div', 'timerow');
  const dtInput = el('input', 'input');
  dtInput.type = 'datetime-local';
  dtInput.step = '1';
  timeRow.append(dtInput);
  panel.append(timeRow);

  const rateRow = el('div', 'raterow');
  for (const step of TIME_STEPS) {
    const btn = el('button', 'rate-btn');
    btn.textContent = step.label;
    btn.title = step.title ?? '';
    btn.addEventListener('click', () => {
      engine.timeRate = step.rate;
      rateRow.querySelectorAll('.rate-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
    });
    if (step.rate === 1) btn.classList.add('active');
    rateRow.append(btn);
  }
  panel.append(rateRow);

  const nowBtn = el('button', 'btn wide');
  nowBtn.textContent = '回到当前时刻';
  nowBtn.addEventListener('click', () => {
    engine.setSimTime(new Date());
    if (engine.timeRate === 0) engine.timeRate = 1;
    rateRow.querySelectorAll('.rate-btn').forEach((b) => {
      b.classList.toggle('active', b.textContent === '1×');
    });
  });
  panel.append(nowBtn);

  let dtEditing = false;
  dtInput.addEventListener('change', () => {
    dtEditing = true;
    const v = new Date(dtInput.value);
    if (!Number.isNaN(v.getTime())) engine.setSimTime(v);
    dtEditing = false;
  });

  function refreshClock(): void {
    const t = engine.simTime;
    const pad = (n: number, w = 2) => String(n).padStart(w, '0');
    clock.textContent = `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}:${pad(t.getSeconds())}`;
    if (!dtEditing) {
      const local = new Date(t.getTime() - t.getTimezoneOffset() * 60000);
      dtInput.value = local.toISOString().slice(0, 19);
    }
    requestAnimationFrame(refreshClock);
  }
  refreshClock();

  // ---------- display toggles ----------
  const dispTitle = el('div', 'panel-title');
  dispTitle.textContent = '显示';
  panel.append(dispTitle);

  interface ToggleDef {
    key: keyof Engine['options'];
    label: string;
  }
  const toggles: ToggleDef[] = [
    { key: 'constellationsWestern', label: '西方星座连线' },
    { key: 'constellationsChinese', label: '三垣二十八宿' },
    { key: 'equatorialGrid', label: '赤道网格' },
    { key: 'horizonGrid', label: '地平网格' },
    { key: 'ground', label: '地面与地平线' },
    { key: 'labels', label: '天体标签' },
    { key: 'hips', label: '巡天背景（银河）' },
  ];
  for (const t of toggles) {
    const label = el('label', 'toggle');
    const cb = el('input') as HTMLInputElement;
    cb.type = 'checkbox';
    cb.checked = engine.options[t.key] as boolean;
    cb.addEventListener('change', () => {
      (engine.options[t.key] as boolean) = cb.checked;
    });
    const span = el('span');
    span.textContent = t.label;
    label.append(cb, span);
    panel.append(label);
  }

  // ---------- atmosphere ----------
  const atmLabel = el('label', 'slider-label');
  atmLabel.textContent = '大气浓度';
  const atm = el('input') as HTMLInputElement;
  atm.type = 'range';
  atm.min = '0';
  atm.max = '100';
  atm.value = String(Math.round(engine.options.atmosphere * 100));
  atm.addEventListener('input', () => {
    engine.options.atmosphere = Number(atm.value) / 100;
  });
  const atmRow = el('div', 'slider-row');
  atmRow.append(atmLabel, atm);
  panel.append(atmRow);

  // ---------- collapse ----------
  const collapse = el('button', 'panel-collapse');
  collapse.textContent = '⌃ 设置';
  collapse.addEventListener('click', () => {
    panel.classList.toggle('collapsed');
    collapse.textContent = panel.classList.contains('collapsed') ? '⌄ 设置' : '⌃ 设置';
  });
  document.getElementById('app')!.append(collapse);
}
