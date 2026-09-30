/**
 * 星座连线：加载 constellations.json（J2000 坐标段）并构建两组线层。
 * western = 现代 88 星座 + 星群；chinese = 三垣二十八宿等星官。
 */
import * as THREE from 'three';
import { DEG } from '../astro/coords';
import type { Vec3 } from '../astro/types';
import { makeLineLayer } from './lines';

const BASE = import.meta.env.BASE_URL ?? '/';

interface SegmentGroup {
  id: string;
  en: string;
  zh: string;
  segs: number[]; // [ra1, dec1, ra2, dec2, ...]
}

export interface ConstellationLayers {
  western: THREE.LineSegments | null;
  chinese: THREE.LineSegments | null;
}

/** segs（度）→ 单位向量对序列。 */
function segsToVectors(segs: number[]): Vec3[] {
  const out: Vec3[] = [];
  for (let i = 0; i + 3 < segs.length; i += 4) {
    const ra1 = segs[i]!;
    const dec1 = segs[i + 1]!;
    const ra2 = segs[i + 2]!;
    const dec2 = segs[i + 3]!;
    // 相邻顶点超过 15° 时细分，宽视场下保持大圆弧形状
    const n = Math.max(1, Math.ceil(Math.hypot(ra2 - ra1, dec2 - dec1) / 12));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      out.push(radecUnit(ra1 + (ra2 - ra1) * t0, dec1 + (dec2 - dec1) * t0));
      out.push(radecUnit(ra1 + (ra2 - ra1) * t1, dec1 + (dec2 - dec1) * t1));
    }
  }
  return out;
}

function radecUnit(raDeg: number, decDeg: number): Vec3 {
  const d = decDeg * DEG;
  const r = raDeg * DEG;
  const cd = Math.cos(d);
  return { x: cd * Math.cos(r), y: cd * Math.sin(r), z: Math.sin(d) };
}

export async function loadConstellations(
  scene: THREE.Scene,
  uniforms: Record<string, THREE.IUniform>,
): Promise<ConstellationLayers> {
  try {
    const res = await fetch(`${BASE}data/stars/constellations.json`);
    if (!res.ok) return { western: null, chinese: null };
    const doc = (await res.json()) as { western: SegmentGroup[]; chinese: SegmentGroup[] };
    const western = makeLineLayer(scene, uniforms, segsToVectors(doc.western.flatMap((g) => g.segs)), {
      color: 0x5a7fd4,
      opacity: 0.5,
      dash: 0.5,
      space: 0,
    });
    const chinese = makeLineLayer(scene, uniforms, segsToVectors(doc.chinese.flatMap((g) => g.segs)), {
      color: 0xd4a45a,
      opacity: 0.42,
      dash: 0.5,
      space: 0,
    });
    return { western, chinese };
  } catch {
    return { western: null, chinese: null };
  }
}
