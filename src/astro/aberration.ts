/**
 * 周年光行差：恒星视位置 = 真位置 + 一阶光行差位移。
 *
 * 地球公转速度 ~29.8 km/s → 最大光行差 20.5″。一阶（非相对论）公式
 * 误差 O(β²) ≈ 2 mas，满足亚角秒目标。
 *
 * 地球速度用 astronomy-engine 的日心轨道位置做数值差分；
 * 相对太阳系质心的差异（太阳绕质心 ~12 m/s → 0.008″）远小于目标精度。
 */
import { Body, HelioVector } from 'astronomy-engine';
import { normalize } from './coords';
import type { Vec3 } from './types';

/** 光速，AU/天（IAU 2012 定义值换算）。 */
const C_AU_PER_DAY = 173.144632684;

/** 差分半间隔：1 天中心差分，双精度下加速度误差可忽略。 */
const HALF_DAY_MS = 43_200_000;

/** 地球日心速度 ÷ c（无量纲 β 向量，量级 ~1e-4），EQJ 赤道系。 */
export function earthBeta(date: Date): Vec3 {
  const t0 = date.getTime();
  const r1 = HelioVector(Body.Earth, new Date(t0 - HALF_DAY_MS));
  const r2 = HelioVector(Body.Earth, new Date(t0 + HALF_DAY_MS));
  const invDays = 1 / (2 * (HALF_DAY_MS / 86_400_000));
  return {
    x: ((r2.x - r1.x) * invDays) / C_AU_PER_DAY,
    y: ((r2.y - r1.y) * invDays) / C_AU_PER_DAY,
    z: ((r2.z - r1.z) * invDays) / C_AU_PER_DAY,
  };
}

/**
 * 一阶光行差：真方向 u（单位向量）+ 观测者速度 β（无量纲，同坐标系）→ 视方向。
 * u' = normalize(u + β − (u·β)u)
 */
export function aberrate(u: Vec3, beta: Vec3): Vec3 {
  const ub = u.x * beta.x + u.y * beta.y + u.z * beta.z;
  return normalize({
    x: u.x + beta.x - ub * u.x,
    y: u.y + beta.y - ub * u.y,
    z: u.z + beta.z - ub * u.z,
  });
}
