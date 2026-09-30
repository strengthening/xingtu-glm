/**
 * 太阳系天体（太阳、月亮、八大行星）的视位置与物理参数。
 * 封装 astronomy-engine：of-date 视赤经视赤纬（含光行差、topocentric），
 * 地平坐标取几何值（不叠加大气折射，大气效果由渲染层统一控制）。
 */
import {
  Body,
  Equator,
  GeoVector,
  Horizon,
  Illumination,
  Observer,
} from 'astronomy-engine';
import { rad2deg } from './coords';
import type { Altaz, ObserverGeo, Radec, Vec3 } from './types';

/** 天体半径（公里），用于角径。来源：IAU/NASA 行星事实表。 */
const RADIUS_KM: Partial<Record<Body, number>> = {
  [Body.Sun]: 695_700,
  [Body.Moon]: 1737.4,
  [Body.Mercury]: 2439.7,
  [Body.Venus]: 6051.8,
  [Body.Mars]: 3389.5,
  [Body.Jupiter]: 69_911,
  [Body.Saturn]: 58_232,
  [Body.Uranus]: 25_362,
  [Body.Neptune]: 24_622,
};

export const SOLAR_BODIES: readonly { body: Body; name: string; label: string }[] = [
  { body: Body.Sun, name: 'Sun', label: '太阳' },
  { body: Body.Moon, name: 'Moon', label: '月亮' },
  { body: Body.Mercury, name: 'Mercury', label: '水星' },
  { body: Body.Venus, name: 'Venus', label: '金星' },
  { body: Body.Mars, name: 'Mars', label: '火星' },
  { body: Body.Jupiter, name: 'Jupiter', label: '木星' },
  { body: Body.Saturn, name: 'Saturn', label: '土星' },
  { body: Body.Uranus, name: 'Uranus', label: '天王星' },
  { body: Body.Neptune, name: 'Neptune', label: '海王星' },
];

export interface SolarBodyInfo {
  name: string;
  label: string;
  /** of-date 视位置（含光行差，topocentric）。 */
  radec: Radec;
  /** of-date 赤道系单位向量（与星点同一坐标系，可直接共用渲染矩阵）。 */
  unit: Vec3;
  altaz: Altaz;
  /** 距地心距离（AU）。 */
  distAu: number;
  /** 视角径（度，圆盘直径）。 */
  angularDiameter: number;
  /** 视星等。 */
  mag: number;
  /** 照明比例 0..1（月相）。 */
  illumFraction: number;
  /** 相位角（度）：太阳—天体—地球。 */
  phaseAngle: number;
}

function toObserver(o: ObserverGeo): Observer {
  return new Observer(o.lat, o.lon, o.elevation);
}

/** 某时刻全部太阳系天体的信息。 */
export function solarSystemInfo(date: Date, obs: ObserverGeo): SolarBodyInfo[] {
  const observer = toObserver(obs);
  const out: SolarBodyInfo[] = [];
  for (const { body, name, label } of SOLAR_BODIES) {
    const eq = Equator(body, date, observer, true, true);
    const hor = Horizon(date, observer, eq.ra, eq.dec);
    const geo = GeoVector(body, date, true);
    const distAu = geo.Length();
    const radiusKm = RADIUS_KM[body];
    const angularDiameter = radiusKm
      ? rad2deg(2 * Math.atan(radiusKm / (distAu * 149_597_870.7)))
      : 0;
    const illum = Illumination(body, date);
    const d = eq.dec;
    const rDeg = eq.ra * 15; // 引擎返回恒星时小时，转度
    const cd = Math.cos((d * Math.PI) / 180);
    out.push({
      name,
      label,
      radec: { ra: rDeg, dec: d },
      unit: {
        x: cd * Math.cos((rDeg * Math.PI) / 180),
        y: cd * Math.sin((rDeg * Math.PI) / 180),
        z: Math.sin((d * Math.PI) / 180),
      },
      altaz: { alt: hor.altitude, az: hor.azimuth },
      distAu,
      angularDiameter,
      mag: illum.mag,
      illumFraction: illum.phase_fraction,
      phaseAngle: illum.phase_angle,
    });
  }
  return out;
}

/** 黄道倾角相关工具暂略；后续如需黄道网格再补。 */
export function sunAltaz(date: Date, obs: ObserverGeo): Altaz {
  const observer = toObserver(obs);
  const eq = Equator(Body.Sun, date, observer, true, true);
  const hor = Horizon(date, observer, eq.ra, eq.dec);
  return { alt: hor.altitude, az: hor.azimuth };
}

export function moonAltaz(date: Date, obs: ObserverGeo): Altaz {
  const observer = toObserver(obs);
  const eq = Equator(Body.Moon, date, observer, true, true);
  const hor = Horizon(date, observer, eq.ra, eq.dec);
  return { alt: hor.altitude, az: hor.azimuth };
}
