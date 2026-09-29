/**
 * Observer location presets. Kept deliberately small on purpose:
 * a handful of representative Chinese cities in the northern group, and a
 * generous list for the southern hemisphere, whose sky differs fundamentally.
 */
import type { GeoPlace } from './types';

export const PLACES: GeoPlace[] = [
  // --- 北半球 Northern hemisphere ---
  { id: 'shanghai', name: '上海 Shanghai (默认)', latitude: 31.23, longitude: 121.47, elevation: 4, hemisphere: 'north' },
  { id: 'beijing', name: '北京 Beijing', latitude: 39.90, longitude: 116.41, elevation: 44, hemisphere: 'north' },
  { id: 'urumqi', name: '乌鲁木齐 Ürümqi', latitude: 43.83, longitude: 87.62, elevation: 800, hemisphere: 'north' },
  { id: 'sanya', name: '三亚 Sanya', latitude: 18.25, longitude: 109.51, elevation: 10, hemisphere: 'north' },
  { id: 'tokyo', name: '东京 Tokyo', latitude: 35.68, longitude: 139.69, elevation: 40, hemisphere: 'north' },
  { id: 'singapore', name: '新加坡 Singapore', latitude: 1.35, longitude: 103.82, elevation: 15, hemisphere: 'north' },
  { id: 'london', name: '伦敦 London', latitude: 51.51, longitude: -0.13, elevation: 11, hemisphere: 'north' },
  { id: 'newyork', name: '纽约 New York', latitude: 40.71, longitude: -74.01, elevation: 10, hemisphere: 'north' },
  { id: 'reykjavik', name: '雷克雅未克 Reykjavík', latitude: 64.15, longitude: -21.94, elevation: 61, hemisphere: 'north' },
  // --- 南半球 Southern hemisphere ---
  { id: 'sydney', name: '悉尼 Sydney', latitude: -33.87, longitude: 151.21, elevation: 58, hemisphere: 'south' },
  { id: 'melbourne', name: '墨尔本 Melbourne', latitude: -37.81, longitude: 144.96, elevation: 31, hemisphere: 'south' },
  { id: 'perth', name: '珀斯 Perth', latitude: -31.95, longitude: 115.86, elevation: 46, hemisphere: 'south' },
  { id: 'auckland', name: '奥克兰 Auckland', latitude: -36.85, longitude: 174.76, elevation: 196, hemisphere: 'south' },
  { id: 'christchurch', name: '基督城 Christchurch', latitude: -43.53, longitude: 172.64, elevation: 20, hemisphere: 'south' },
  { id: 'capetown', name: '开普敦 Cape Town', latitude: -33.92, longitude: 18.42, elevation: 25, hemisphere: 'south' },
  { id: 'johannesburg', name: '约翰内斯堡 Johannesburg', latitude: -26.20, longitude: 28.05, elevation: 1753, hemisphere: 'south' },
  { id: 'buenosaires', name: '布宜诺斯艾利斯 Buenos Aires', latitude: -34.60, longitude: -58.38, elevation: 25, hemisphere: 'south' },
  { id: 'santiago', name: '圣地亚哥 Santiago', latitude: -33.45, longitude: -70.67, elevation: 570, hemisphere: 'south' },
  { id: 'lima', name: '利马 Lima', latitude: -12.05, longitude: -77.04, elevation: 154, hemisphere: 'south' },
  { id: 'lapaz', name: '拉巴斯 La Paz', latitude: -16.50, longitude: -68.15, elevation: 3640, hemisphere: 'south' },
  { id: 'quito', name: '基多 Quito', latitude: -0.18, longitude: -78.47, elevation: 2850, hemisphere: 'south' },
  { id: 'suva', name: '苏瓦 Suva (斐济)', latitude: -18.14, longitude: 178.44, elevation: 10, hemisphere: 'south' },
  { id: 'papeete', name: '帕皮提 Papeete (塔希提)', latitude: -17.53, longitude: -149.57, elevation: 10, hemisphere: 'south' },
  { id: 'nantucket-sky', name: '阿塔卡马 Atacama (智利北部)', latitude: -24.63, longitude: -70.40, elevation: 2400, hemisphere: 'south' },
];

export const DEFAULT_PLACE_ID = 'shanghai';
