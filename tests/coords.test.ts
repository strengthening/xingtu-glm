import {
  AstroTime,
  Body,
  Equator,
  Horizon,
  Observer,
  RotateVector,
  Rotation_EQJ_EQD,
  Vector,
} from 'astronomy-engine';
import { describe, expect, it } from 'vitest';
import { aberrate, earthBeta } from '../src/astro/aberration';
import {
  applyMat3,
  applyProperMotion,
  dot,
  eqdToHorizonMatrix,
  eqjToEqdMatrix,
  gastDeg,
  radecToUnit,
  unitToAltaz,
  unitToRadec,
  yearsSinceJ2000,
} from '../src/astro/coords';
import type { ObserverGeo, Vec3 } from '../src/astro/types';

const SHANGHAI: ObserverGeo = { lat: 31.23, lon: 121.47, elevation: 4 };

describe('向量与坐标往返', () => {
  it('radecToUnit ↔ unitToRadec 误差 < 1e-9°', () => {
    for (const [ra, dec] of [
      [0, 0],
      [101.28796, -16.71611],
      [279.23, 38.78],
      [186.65, -63.1],
      [350, 89.5],
    ] as const) {
      const u = radecToUnit({ ra, dec });
      const back = unitToRadec(u);
      expect(Math.abs(back.ra - ra)).toBeLessThan(1e-9);
      expect(Math.abs(back.dec - dec)).toBeLessThan(1e-9);
    }
  });
});

describe('与 astronomy-engine 交叉验证', () => {
  it('EQJ→EQD：applyMat3 与引擎 RotateVector 一致（行主序约定正确）', () => {
    const date = new Date('2026-01-10T14:00:00Z');
    const uEqj = radecToUnit({ ra: 101.28796, dec: -16.71611 });
    const ours = applyMat3(eqjToEqdMatrix(date), uEqj);
    const engine = RotateVector(
      Rotation_EQJ_EQD(date),
      new Vector(uEqj.x, uEqj.y, uEqj.z, new AstroTime(0)),
    );
    expect(Math.abs(ours.x - engine.x)).toBeLessThan(1e-12);
    expect(Math.abs(ours.y - engine.y)).toBeLessThan(1e-12);
    expect(Math.abs(ours.z - engine.z)).toBeLessThan(1e-12);
  });

  it('EQD→地平矩阵：与引擎 Horizon 输出一致（< 0.001°）', () => {
    const observer = new Observer(SHANGHAI.lat, SHANGHAI.lon, SHANGHAI.elevation);
    const cases = [
      new Date('2026-01-10T14:00:00Z'),
      new Date('2026-07-04T19:30:00Z'),
      new Date('2026-03-21T02:15:00Z'),
    ];
    for (const date of cases) {
      const eq = Equator(Body.Sun, date, observer, true, true);
      const uEqd = radecToUnit({ ra: eq.ra * 15, dec: eq.dec }); // ra 小时 → 度
      const ours = unitToAltaz(
        applyMat3(eqdToHorizonMatrix(gastDeg(date), SHANGHAI.lat, SHANGHAI.lon), uEqd),
      );
      const ref = Horizon(date, observer, eq.ra, eq.dec);
      const dAlt = Math.abs(ours.alt - ref.altitude);
      let dAz = Math.abs(ours.az - ref.azimuth);
      if (dAz > 180) dAz = 360 - dAz;
      expect(dAlt).toBeLessThan(0.001);
      expect(dAz).toBeLessThan(0.001);
    }
  });
});

describe('周年光行差', () => {
  it('地球速度 β 量级 ≈ 1e-4（≈29.8 km/s）', () => {
    const b = earthBeta(new Date('2026-04-01T00:00:00Z'));
    const mag = Math.sqrt(dot(b, b));
    expect(mag).toBeGreaterThan(9.5e-5);
    expect(mag).toBeLessThan(1.05e-4);
  });

  it('β=0 时 aberrate 恒等；位移角不超过 β（≈20.5″）', () => {
    const u = radecToUnit({ ra: 101.28796, dec: -16.71611 });
    const zero = aberrate(u, { x: 0, y: 0, z: 0 });
    expect(Math.abs(dot(zero, u) - 1)).toBeLessThan(1e-12);

    const beta: Vec3 = { x: 1e-4, y: 0, z: 0 };
    const u2 = radecToUnit({ ra: 90, dec: 0 }); // 与 β 垂直
    const shifted = aberrate(u2, beta);
    const d = Math.acos(Math.max(-1, Math.min(1, dot(shifted, u2))));
    expect(d).toBeGreaterThan(0.9e-4); // ≈ 18.5″…量级检查
    expect(d).toBeLessThan(1.1e-4);
  });
});

/** 天狼星 J2000 星历（HIP 32349 / SIMBAD）。pmRa 已含 cosδ。 */
const SIRIUS = { ra: 101.28796, dec: -16.71611, pmRa: -546.01, pmDec: -1223.08 };

/** 天狼星视位置（自行 + 岁差 + 章动 + 光行差）→ 地平坐标。 */
export function siriusApparentAltaz(date: Date, obs: ObserverGeo) {
  const u0 = radecToUnit(SIRIUS);
  const withPm = applyProperMotion(u0, SIRIUS.pmRa, SIRIUS.pmDec, yearsSinceJ2000(date));
  const mEqd = eqjToEqdMatrix(date);
  const eqd = applyMat3(mEqd, withPm);
  const beta = earthBeta(date);
  const betaEqd = applyMat3(mEqd, beta);
  const apparent = aberrate(eqd, betaEqd);
  const hor = applyMat3(eqdToHorizonMatrix(gastDeg(date), obs.lat, obs.lon), apparent);
  return unitToAltaz(hor);
}

describe('天狼星地平坐标（Stellarium 级锚定）', () => {
  it('上海上中天：高度 ≈ 90° − |φ − δ| ≈ 42.0°，方位 ≈ 180°', () => {
    // 在 2026-01-10 的 24 小时内搜索高度极大（上中天）时刻
    const t0 = Date.UTC(2026, 0, 10, 0, 0, 0);
    const stepMs = 60_000;
    let bestT = t0;
    let bestAlt = -90;
    for (let t = t0; t < t0 + 24 * 3600_000; t += stepMs) {
      const { alt } = siriusApparentAltaz(new Date(t), SHANGHAI);
      if (alt > bestAlt) {
        bestAlt = alt;
        bestT = t;
      }
    }
    // 细化到 ±2 秒
    for (let t = bestT - 60_000; t <= bestT + 60_000; t += 2_000) {
      const { alt } = siriusApparentAltaz(new Date(t), SHANGHAI);
      if (alt > bestAlt) {
        bestAlt = alt;
        bestT = t;
      }
    }
    const { az, alt } = siriusApparentAltaz(new Date(bestT), SHANGHAI);
    // 中天高度几何事实：alt = 90 − |31.23 − δ_app|，δ_app(2026-01) ≈ −16.72°
    expect(alt).toBeGreaterThan(41.9);
    expect(alt).toBeLessThan(42.2);
    let dAz = Math.abs(az - 180);
    if (dAz > 180) dAz = 360 - dAz;
    expect(dAz).toBeLessThan(0.1);
  });

  it('上海 2026-01-10 14:00 UTC（约 22:00 当地）：回归快照', () => {
    const { alt, az } = siriusApparentAltaz(new Date('2026-01-10T14:00:00Z'), SHANGHAI);
    // 快照值由本链路计算（中天时刻前约 1.3 小时，东南偏南、接近最高点），
    // 并经上例中天几何独立验证；±0.02° 内防回归
    expect(alt).toBeGreaterThan(38.313 - 0.02);
    expect(alt).toBeLessThan(38.313 + 0.02);
    expect(az % 360).toBeGreaterThan(155.325 - 0.05);
    expect(az % 360).toBeLessThan(155.325 + 0.05);
  });
});
