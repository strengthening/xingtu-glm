/**
 * URL hash state: share/restore observer, time, view direction and FOV.
 * Example:
 *   #lat=31.23&lon=121.47&t=1759017600000&rate=0&fov=60&alt=30&az=180
 */
import type { Engine } from '../core/engine';

export function writeUrlState(engine: Engine): void {
  const c = engine.renderer.skyCamera.centerHor;
  const alt = (Math.asin(Math.max(-1, Math.min(1, c[2]))) * 180) / Math.PI;
  let az = (Math.atan2(c[1], -c[0]) * 180) / Math.PI;
  if (az < 0) az += 360;
  const params = new URLSearchParams({
    lat: engine.observer.latitude.toFixed(4),
    lon: engine.observer.longitude.toFixed(4),
    t: String(Math.round(engine.simTime.getTime() / 1000)),
    rate: String(engine.timeRate),
    fov: engine.renderer.skyCamera.fovDeg.toFixed(2),
    alt: alt.toFixed(3),
    az: az.toFixed(3),
  });
  const hash = `#${params.toString()}`;
  if (location.hash !== hash) {
    history.replaceState(null, '', hash);
  }
}

export interface UrlState {
  lat: number;
  lon: number;
  time: Date;
  rate: number;
  fov: number;
  alt: number;
  az: number;
}

export function readUrlState(): Partial<UrlState> {
  if (!location.hash || location.hash.length < 2) return {};
  try {
    const params = new URLSearchParams(location.hash.slice(1));
    const num = (k: string): number | undefined => {
      const v = params.get(k);
      if (v === null) return undefined;
      const n = Number(v);
      return Number.isFinite(n) ? n : undefined;
    };
    const out: Partial<UrlState> = {};
    const lat = num('lat');
    const lon = num('lon');
    const t = num('t');
    const rate = num('rate');
    const fov = num('fov');
    const alt = num('alt');
    const az = num('az');
    if (lat !== undefined && Math.abs(lat) < 90) out.lat = lat;
    if (lon !== undefined && Math.abs(lon) <= 180) out.lon = lon;
    if (t !== undefined && t > 0) out.time = new Date(t * 1000);
    if (rate !== undefined && Number.isFinite(rate)) out.rate = rate;
    if (fov !== undefined && fov > 0.05 && fov < 300) out.fov = fov;
    if (alt !== undefined && Math.abs(alt) <= 90) out.alt = alt;
    if (az !== undefined && az >= 0 && az < 360) out.az = az;
    return out;
  } catch {
    return {};
  }
}

export function attachUrlSharing(engine: Engine): void {
  // Restore from URL at startup.
  const state = readUrlState();
  if (state.lat !== undefined && state.lon !== undefined) {
    engine.setObserver({ latitude: state.lat, longitude: state.lon, elevation: 0 });
  }
  if (state.time) engine.setSimTime(state.time);
  if (state.rate !== undefined) engine.timeRate = state.rate;
  if (state.alt !== undefined && state.az !== undefined) {
    const az = (state.az * Math.PI) / 180;
    const alt = (state.alt * Math.PI) / 180;
    const ca = Math.cos(alt);
    engine.renderer.skyCamera.setCenter([
      -ca * Math.cos(az),
      ca * Math.sin(az),
      Math.sin(alt),
    ]);
  }
  if (state.fov !== undefined) engine.renderer.skyCamera.setFov(state.fov);

  // Periodically sync (and a share button).
  setInterval(() => writeUrlState(engine), 1500);
  const btn = document.createElement('button');
  btn.className = 'btn share-btn';
  btn.textContent = '复制分享链接';
  btn.style.position = 'absolute';
  btn.style.right = '14px';
  btn.style.bottom = '40px';
  btn.style.zIndex = '25';
  btn.addEventListener('click', async () => {
    writeUrlState(engine);
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = '已复制 ✓';
    } catch {
      btn.textContent = location.href;
    }
    setTimeout(() => {
      btn.textContent = '复制分享链接';
    }, 1800);
  });
  document.getElementById('app')!.append(btn);
}
