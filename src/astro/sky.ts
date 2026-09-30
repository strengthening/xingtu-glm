/**
 * 大气模型：消光（airmass × 消光系数）与月光天光。
 * 「大气浓度」滑块（0–100%）统一缩放两者的强度；0 表示无大气。
 */
import { Body, Equator, Horizon, Illumination, Observer } from 'astronomy-engine';
import type { ObserverGeo } from './types';

/**
 * 相对气团（Kasten & Young 1989），高度角 > 0 有效。
 * 天顶为 1；高度角 10° 时约 5.6，比 1/sin 更符合真实折射路径。
 */
export function airmass(altDeg: number): number {
  const h = Math.max(altDeg, 0.1);
  return 1 / (Math.sin((h * Math.PI) / 180) + 0.50572 * Math.pow(h + 6.07995, -1.6364));
}

/**
 * 大气消光引起的星等增量（永远 ≥ 0）。
 * kV：海平面 V 波段典型消光系数 0.22 mag/airmass（洁净大气 0.15–0.30）。
 */
export function extinctionMag(altDeg: number, density: number, kV = 0.22): number {
  if (density <= 0) return 0;
  if (altDeg <= 0) return Infinity;
  return kV * airmass(altDeg) * density;
}

export interface MoonGlowInput {
  date: Date;
  obs: ObserverGeo;
  /** 大气浓度 0..1。 */
  density: number;
}

/**
 * 月光引起的天光亮度（相对值，0 = 无）。
 *
 * Krisciunas & Schaefer (1991) 的工程近似：
 * - 满月天顶时约 1.0（相对单位）；
 * - 随月相照度、月亮高度、月亮天顶距衰减；
 * - 大气浓度直接线性缩放，0 时无天光。
 */
export function moonSkyGlow({ date, obs, density }: MoonGlowInput): number {
  if (density <= 0) return 0;
  const observer = new Observer(obs.lat, obs.lon, obs.elevation);
  const eq = Equator(Body.Moon, date, observer, true, true);
  const hor = Horizon(date, observer, eq.ra, eq.dec);
  return moonGlowFromAltaz(hor.altitude, Illumination(Body.Moon, date).phase_fraction, density);
}

/** 上式的核心（渲染层复用：月亮高度角已知时不再重复查星历）。 */
export function moonGlowFromAltaz(moonAlt: number, illumFraction: number, density: number): number {
  if (density <= 0 || moonAlt <= 0 || illumFraction <= 0) return 0;
  const altFactor = Math.pow(Math.sin((Math.max(moonAlt, 0) * Math.PI) / 180), 0.6);
  return Math.pow(illumFraction, 1.5) * altFactor * density;
}

/** 太阳高度角（度），用于晨昏蒙影与天空整体色调。 */
export function sunAlt(date: Date, obs: ObserverGeo): number {
  const observer = new Observer(obs.lat, obs.lon, obs.elevation);
  const eq = Equator(Body.Sun, date, observer, true, true);
  const hor = Horizon(date, observer, eq.ra, eq.dec);
  return hor.altitude;
}
