/**
 * Constellation lines: western 88 + Chinese xingguan (San Yuan / Ershiba Xiu).
 * Data: constellations.json built by scripts/build-stars.ts from Stellarium
 * skycultures (CC BY-SA 4.0). Vertices are J2000 unit vectors; each polyline
 * segment is subdivided so wide fields stay smooth.
 */
import * as THREE from 'three';
import { arcPoints, lineMaterial, updateLineMaterial } from './lines';
import type { SkyFrame } from '../astro/sky';
import type { SkyCamera } from './projection';
import type { Vec3 } from '../astro/types';

export interface ConstellationDef {
  id: string;
  name: string;
  nameEn: string;
  /** Each segment is a flat [x,y,z,...] chain of unit vectors. */
  lines: number[][];
  stars: { hip: number; tyc?: string; mag: number }[];
}

export interface ConstellationData {
  license: string;
  western: ConstellationDef[];
  chinese: ConstellationDef[];
}

export class ConstellationRenderer {
  western = new THREE.Group();
  chinese = new THREE.Group();
  data: ConstellationData | null = null;
  /** Name-anchor points (mean of line vertices) for optional labels. */
  anchors: { name: string; dir: Vec3; group: 'western' | 'chinese' }[] = [];

  async load(): Promise<void> {
    const res = await fetch('/data/constellations.json');
    if (!res.ok) return;
    this.data = (await res.json()) as ConstellationData;
    const westDirs: Vec3[] = [];
    for (const con of this.data.western) {
      this.appendConstellation(con, westDirs, 'western');
    }
    this.western.add(this.makeLines(westDirs, 0x4d7fb8, 0.34));
    const zhDirs: Vec3[] = [];
    for (const con of this.data.chinese) {
      this.appendConstellation(con, zhDirs, 'chinese');
    }
    this.chinese.add(this.makeLines(zhDirs, 0xd4a04c, 0.46));
  }

  private appendConstellation(
    con: ConstellationDef,
    dirs: Vec3[],
    group: 'western' | 'chinese',
  ): void {
    let sx = 0;
    let sy = 0;
    let sz = 0;
    let n = 0;
    for (const seg of con.lines) {
      const pts: Vec3[] = [];
      for (let i = 0; i + 2 < seg.length; i += 3) {
        pts.push([seg[i]!, seg[i + 1]!, seg[i + 2]!]);
      }
      for (let i = 0; i + 1 < pts.length; i++) {
        for (const p of arcPoints(pts[i]!, pts[i + 1]!, 2.5)) {
          dirs.push(p);
          sx += p[0];
          sy += p[1];
          sz += p[2];
          n++;
        }
      }
    }
    if (n > 0) {
      const l = Math.hypot(sx, sy, sz);
      this.anchors.push({ name: con.name, dir: [sx / l, sy / l, sz / l], group });
    }
  }

  private makeLines(dirs: Vec3[], color: number, opacity: number): THREE.LineSegments {
    const material = lineMaterial(true, color, opacity);
    const floats = new Float32Array(dirs.length * 3);
    dirs.forEach((d, i) => {
      floats[i * 3] = d[0];
      floats[i * 3 + 1] = d[1];
      floats[i * 3 + 2] = d[2];
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(floats, 3));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 10);
    const lines = new THREE.LineSegments(geo, material);
    lines.frustumCulled = false;
    lines.renderOrder = 5;
    return lines;
  }

  update(frame: SkyFrame, camera: SkyCamera): void {
    for (const g of [this.western, this.chinese]) {
      for (const child of g.children) {
        updateLineMaterial(
          (child as THREE.LineSegments).material as THREE.ShaderMaterial,
          frame,
          camera,
          true,
        );
      }
    }
  }
}
