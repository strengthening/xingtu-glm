/**
 * xingtu — browser planetarium.
 * Entry point: wires the engine, the data loader and the UI together.
 */
import { Engine } from './core/engine';
import { PLACES, DEFAULT_PLACE_ID } from './astro/places';
import type { Observer } from './astro/types';
import { attachUI } from './ui/panel';

async function main(): Promise<void> {
  const canvas = document.getElementById('sky') as HTMLCanvasElement;
  const place = PLACES.find((p) => p.id === DEFAULT_PLACE_ID)!;
  const observer: Observer = {
    latitude: place.latitude,
    longitude: place.longitude,
    elevation: place.elevation,
  };

  const engine = new Engine(canvas, observer, new Date());
  await engine.init();
  engine.start();

  // Debug handle for development/inspection.
  (window as unknown as Record<string, unknown>).__xt = { engine };
  attachUI(engine);
}

main().catch((err) => {
  console.error(err);
  const el = document.createElement('pre');
  el.style.cssText = 'color:#f88;padding:24px;font-size:14px;z-index:99;position:relative';
  el.textContent = `加载失败: ${String(err)}\n请先运行 pnpm stars:build 生成星表数据。`;
  document.body.prepend(el);
});
