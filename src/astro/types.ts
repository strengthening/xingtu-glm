/** astro/ 层共享的基础类型。本目录只做纯计算，不依赖 Three.js 与 DOM。 */

/** 三维向量（单位球坐标或普通向量）。 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 3×3 矩阵，行主序（m[row * 3 + col]）。
 * 传给 GLSL / Three.js 时需转置为列主序（见 toArrayColumnMajor）。
 */
export type Mat3 = readonly number[];

/** 观测者地理位置。纬度/经度单位为度，东经、北纬为正。 */
export interface ObserverGeo {
  lat: number;
  lon: number;
  /** 海拔，米。 */
  elevation: number;
}

/** 天文角度用度表示的赤道坐标（J2000 或视位置，视上下文）。 */
export interface Radec {
  ra: number;
  dec: number;
}

/** 地平坐标：高度角与方位角（度）。方位角从正北起算、顺时针（经东）为正。 */
export interface Altaz {
  alt: number;
  az: number;
}
