/**
 * 预设观测地点：北半球 / 南半球两组。
 * 中国城市精简（上海为默认），南半球覆盖各大洲与太平洋，展示不同的星空。
 */
import type { ObserverGeo } from './types';

export interface Place extends ObserverGeo {
  id: string;
  name: string;
  hemisphere: 'north' | 'south';
}

export const PLACES: readonly Place[] = [
  // 北半球
  { id: 'shanghai', name: '上海（默认）', hemisphere: 'north', lat: 31.23, lon: 121.47, elevation: 4 },
  { id: 'beijing', name: '北京', hemisphere: 'north', lat: 39.9, lon: 116.41, elevation: 44 },
  { id: 'urumqi', name: '乌鲁木齐', hemisphere: 'north', lat: 43.83, lon: 87.62, elevation: 935 },
  { id: 'guangzhou', name: '广州', hemisphere: 'north', lat: 23.13, lon: 113.26, elevation: 11 },
  { id: 'mohe', name: '漠河', hemisphere: 'north', lat: 52.97, lon: 122.54, elevation: 433 },
  { id: 'tokyo', name: '东京', hemisphere: 'north', lat: 35.68, lon: 139.69, elevation: 40 },
  { id: 'london', name: '伦敦', hemisphere: 'north', lat: 51.51, lon: -0.13, elevation: 11 },
  { id: 'newyork', name: '纽约', hemisphere: 'north', lat: 40.71, lon: -74.01, elevation: 10 },
  { id: 'cairo', name: '开罗', hemisphere: 'north', lat: 30.04, lon: 31.24, elevation: 23 },
  { id: 'reykjavik', name: '雷克雅未克', hemisphere: 'north', lat: 64.15, lon: -21.94, elevation: 61 },
  // 南半球（星空与北半球明显不同：南十字、麦哲伦云、半人马座 Ω）
  { id: 'sydney', name: '悉尼', hemisphere: 'south', lat: -33.87, lon: 151.21, elevation: 58 },
  { id: 'melbourne', name: '墨尔本', hemisphere: 'south', lat: -37.81, lon: 144.96, elevation: 31 },
  { id: 'perth', name: '珀斯', hemisphere: 'south', lat: -31.95, lon: 115.86, elevation: 46 },
  { id: 'auckland', name: '奥克兰', hemisphere: 'south', lat: -36.85, lon: 174.76, elevation: 196 },
  { id: 'wellington', name: '惠灵顿', hemisphere: 'south', lat: -41.29, lon: 174.78, elevation: 31 },
  { id: 'buenosaires', name: '布宜诺斯艾利斯', hemisphere: 'south', lat: -34.6, lon: -58.38, elevation: 25 },
  { id: 'santiago', name: '圣地亚哥', hemisphere: 'south', lat: -33.45, lon: -70.67, elevation: 570 },
  { id: 'capetown', name: '开普敦', hemisphere: 'south', lat: -33.92, lon: 18.42, elevation: 25 },
  { id: 'johannesburg', name: '约翰内斯堡', hemisphere: 'south', lat: -26.2, lon: 28.05, elevation: 1753 },
  { id: 'brasilia', name: '巴西利亚', hemisphere: 'south', lat: -15.79, lon: -47.88, elevation: 1172 },
  { id: 'lima', name: '利马', hemisphere: 'south', lat: -12.05, lon: -77.04, elevation: 154 },
  { id: 'jakarta', name: '雅加达', hemisphere: 'south', lat: -6.21, lon: 106.85, elevation: 8 },
  { id: 'portmoresby', name: '莫尔兹比港', hemisphere: 'south', lat: -9.44, lon: 147.18, elevation: 15 },
  { id: 'papeete', name: '帕皮提（塔希提）', hemisphere: 'south', lat: -17.54, lon: -149.57, elevation: 10 },
  { id: 'ushuaia', name: '乌斯怀亚', hemisphere: 'south', lat: -54.8, lon: -68.3, elevation: 23 },
];

export const DEFAULT_PLACE_ID = 'shanghai';

export function findPlace(id: string): Place | undefined {
  return PLACES.find((p) => p.id === id);
}

export function defaultObserver(): ObserverGeo {
  const p = findPlace(DEFAULT_PLACE_ID)!;
  return { lat: p.lat, lon: p.lon, elevation: p.elevation };
}
