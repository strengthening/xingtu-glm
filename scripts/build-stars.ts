/**
 * build-stars.ts — preprocess raw catalogs into the runtime star tiles.
 *
 * Inputs (downloaded by scripts/download-stars.ts into data/raw/):
 *   tyc2/tyc2.dat.{00..39}.gz   Tycho-2 main catalogue (VizieR I/259)
 *   hygdata_v41.csv             HYG database v41 (names, Bayer/Flamsteed)
 *   IAU-CSN.txt                 IAU Catalog of Star Names
 *   skycultures/modern-index.json        Western 88 constellation lines
 *   skycultures/chinese-index.json       Chinese Xingguan lines (San Yuan,
 *                                        Ershiba Xiu) — CC BY-SA 4.0
 *   skycultures/chinese-star-names.fab   Chinese star names (HIP)
 *
 * Outputs (public/data/, git-ignored):
 *   index.json            manifest: bins, counts, sizes
 *   bright-N.bin/.ids     all-sky bins for the brighter magnitude cuts
 *   slice-N/PPPP.bin/.ids HEALPix (nside=8, RING) tiles for faint cuts
 *   names.json            named stars only (small)
 *   constellations.json   western + chinese line segments with J2000 xyz
 *
 * Binary format: Float32Array interleaved [x, y, z, mag, bv, pmRA, pmDec]
 * (28 bytes/star) plus a parallel Uint32Array of packed TYC ids.
 *
 * Run: pnpm stars:build
 */
import { createReadStream } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { vec2pixRing } from '../src/astro/healpix';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');
const OUT = path.join(ROOT, 'public', 'data');

const NSIDE = 8;
const STRIDE = 7; // floats per star

/** All-sky bins get everything brighter than this; fainter goes to tiles. */
const ALLSKY_LIMIT = 10.0;
const BINS: { key: string; lo: number; hi: number; allSky: boolean }[] = [
  { key: 'bright-0', lo: -Infinity, hi: 6.5, allSky: true },
  { key: 'bright-1', lo: 6.5, hi: 8.5, allSky: true },
  { key: 'bright-2', lo: 8.5, hi: ALLSKY_LIMIT, allSky: true },
  { key: 'slice-3', lo: ALLSKY_LIMIT, hi: 11.0, allSky: false },
  { key: 'slice-4', lo: 11.0, hi: Infinity, allSky: false },
];

interface Star {
  tyc1: number;
  tyc2: number;
  tyc3: number;
  ra: number;
  dec: number;
  pmRa: number; // mas/yr, mu_alpha*cos(delta)
  pmDec: number; // mas/yr
  v: number; // Johnson V approximation
  bv: number; // Johnson B-V approximation
  hip: number; // 0 = none
  fromSupplement?: boolean;
}

function packTyc(tyc1: number, tyc2: number, tyc3: number): number {
  return ((tyc1 & 0x3fff) << 16) | ((tyc2 & 0x3fff) << 2) | ((tyc3 - 1) & 3);
}

export function unpackTyc(id: number): [number, number, number] {
  return [(id >> 16) & 0x3fff, (id >> 2) & 0x3fff, (id & 3) + 1];
}

export function tycCode(id: number): string {
  const [a, b, c] = unpackTyc(id);
  return `${a}-${b}-${c}`;
}

function raDecToXyz(raDeg: number, decDeg: number): [number, number, number] {
  const ra = (raDeg * Math.PI) / 180;
  const dec = (decDeg * Math.PI) / 180;
  const cd = Math.cos(dec);
  return [cd * Math.cos(ra), cd * Math.sin(ra), Math.sin(dec)];
}

/** Parse one Tycho-2 fixed-width line (207 bytes). */
function parseTychoLine(line: string): Star | null {
  if (line.length < 150) return null;
  const tyc1 = Number(line.slice(0, 4));
  const tyc2 = Number(line.slice(5, 10));
  const tyc3 = Number(line.slice(11, 12));
  const pflag = line.slice(13, 14);
  if (!Number.isFinite(tyc1) || !Number.isFinite(tyc2) || !Number.isFinite(tyc3)) {
    return null;
  }
  if (pflag === 'X') return null; // no mean position / proper motion
  const ra = Number(line.slice(15, 27));
  const dec = Number(line.slice(28, 40));
  if (!Number.isFinite(ra) || !Number.isFinite(dec)) return null;
  const pmRa = Number(line.slice(41, 48));
  const pmDec = Number(line.slice(49, 56));
  const btStr = line.slice(110, 116).trim();
  const vtStr = line.slice(123, 129).trim();
  const bt = btStr === '' ? NaN : Number(btStr);
  const vt = vtStr === '' ? NaN : Number(vtStr);
  if (Number.isNaN(bt) && Number.isNaN(vt)) return null;
  // Official transformations (ESA SP-1200 §1.3 via VizieR I/259 ReadMe note 7):
  //   V = VT - 0.090 (BT-VT);  B-V = 0.850 (BT-VT)
  let v: number;
  let bv: number;
  if (Number.isFinite(bt) && Number.isFinite(vt)) {
    v = vt - 0.09 * (bt - vt);
    bv = 0.85 * (bt - vt);
  } else if (Number.isFinite(vt)) {
    v = vt;
    bv = 0.65; // solar-ish default
  } else {
    v = bt;
    bv = 0.65;
  }
  // Defensive: a few catalogs ship the Sun; anything absurdly bright here is
  // not a star we want to render (Tycho-2 has none, this is future-proofing).
  if (v < -2) return null;
  const hipStr = line.slice(142, 148).trim();
  const hip = hipStr === '' ? 0 : Number(hipStr);
  return {
    tyc1,
    tyc2,
    tyc3,
    ra,
    dec,
    pmRa: Number.isFinite(pmRa) ? pmRa : 0,
    pmDec: Number.isFinite(pmDec) ? pmDec : 0,
    v,
    bv,
    hip: Number.isFinite(hip) ? hip : 0,
  };
}

async function* iterateTycho2(): AsyncGenerator<Star> {
  for (let i = 0; i < 20; i++) {
    const file = path.join(RAW, 'tyc2', `tyc2.dat.${String(i).padStart(2, '0')}.gz`);
    const stream = createReadStream(file).pipe(createGunzip());
    const rl = createInterface({ input: stream, crlfDelay: Infinity });
    for await (const line of rl) {
      const star = parseTychoLine(line);
      if (star) yield star;
    }
  }
}

// ---------------------------------------------------------------------------
// Supplements (pipe-delimited, J1991.25 positions).
//
// The Tycho-2 main catalogue EXCLUDES stars brighter than VT ~ 1.9 (detector
// saturation) — Sirius, Canopus, Alpha Centauri, the Crux stars, etc. all
// live in supplement_1 (Tycho-1/Hipparcos data) instead. Positions there are
// at epoch J1991.25 and must be propagated to J2000.0 with the proper motions
// before merging, so the whole catalog shares one epoch.
// ---------------------------------------------------------------------------

const SUPPLEMENT_EPOCH = 1991.25;
const MAIN_EPOCH = 2000.0;

/** Parse one suppl_1/suppl_2 pipe-delimited line and propagate to J2000. */
function parseSupplementLine(line: string): Star | null {
  if (line.length < 110) return null;
  const f = line.split('|');
  // Columns: TYC1 TYC2 TYC3 | flag | RA | DE | pmRA | pmDE | eRA | eDE |
  // e_pmRA | e_pmDE | mflag | BT | eBT | VT/Hp | eVT | prox | TYC | HIP | CCDM
  const tyc1 = Number(f[0]!.slice(0, 4));
  const tyc2 = Number(f[0]!.slice(5, 10));
  const tyc3 = Number(f[0]!.slice(11, 12));
  if (!Number.isFinite(tyc1) || !Number.isFinite(tyc2) || !Number.isFinite(tyc3)) {
    return null;
  }
  const ra1991 = Number(f[2]);
  const dec1991 = Number(f[3]);
  if (!Number.isFinite(ra1991) || !Number.isFinite(dec1991)) return null;
  const pmRa = Number(f[4]);
  const pmDec = Number(f[5]);
  const pmRaVal = Number.isFinite(pmRa) ? pmRa : 0;
  const pmDecVal = Number.isFinite(pmDec) ? pmDec : 0;

  // Propagate J1991.25 -> J2000.0 along the great circle (mas -> deg).
  const dt = MAIN_EPOCH - SUPPLEMENT_EPOCH;
  const decRad = (dec1991 * Math.PI) / 180;
  const ra2000 =
    ra1991 + ((pmRaVal / 3.6e6) * dt) / Math.max(0.05, Math.cos(decRad));
  const dec2000 = dec1991 + (pmDecVal / 3.6e6) * dt;

  // Magnitude: 'H' rows carry Hp in the VT slot (close to V); 'T' rows carry
  // Tycho-1 VT (and maybe BT). B-V is patched from HYG later when available.
  let v: number;
  let bt = NaN;
  let vt = NaN;
  const btTok = f[11]?.trim() ?? '';
  const vtTok = f[13]?.trim() ?? '';
  if (btTok !== '') bt = Number(btTok);
  if (vtTok !== '') vt = Number(vtTok);
  if (Number.isFinite(vt)) {
    v = Number.isFinite(bt) ? vt - 0.09 * (bt - vt) : vt;
  } else if (Number.isFinite(bt)) {
    v = bt;
  } else {
    return null;
  }
  if (v < -2) return null; // defensive Sun filter
  const bv = Number.isFinite(bt) && Number.isFinite(vt) ? 0.85 * (bt - vt) : NaN;

  // HIP column may carry a CCDM component letter after the number
  // (e.g. "71683A" for alpha Centauri A) — strip it.
  const hipStr = (f[17] ?? '').trim().replace(/[A-Za-z].*$/, '');
  const hip = hipStr === '' ? 0 : Number(hipStr);
  return {
    tyc1,
    tyc2,
    tyc3,
    ra: ((ra2000 % 360) + 360) % 360,
    dec: dec2000,
    pmRa: pmRaVal,
    pmDec: pmDecVal,
    v,
    bv,
    hip: Number.isFinite(hip) ? hip : 0,
    fromSupplement: true,
  };
}

async function* iterateSupplement(): AsyncGenerator<Star> {
  for (const file of ['suppl_1.dat.gz', 'suppl_2.dat.gz']) {
    try {
      const stream = createReadStream(path.join(RAW, 'tyc2', file)).pipe(
        createGunzip(),
      );
      const rl = createInterface({ input: stream, crlfDelay: Infinity });
      for await (const line of rl) {
        const star = parseSupplementLine(line);
        if (star) yield star;
      }
    } catch {
      // Supplements are optional; the main catalogue works without them.
    }
  }
}

interface FileStats {
  file: string;
  stars: number;
  bytes: number;
}

async function writeBin(
  file: string,
  stars: Star[],
  histogram: Map<string, number>,
): Promise<FileStats> {
  const floats = new Float32Array(stars.length * STRIDE);
  const ids = new Uint32Array(stars.length);
  for (let i = 0; i < stars.length; i++) {
    const s = stars[i]!;
    const [x, y, z] = raDecToXyz(s.ra, s.dec);
    const o = i * STRIDE;
    floats[o] = x;
    floats[o + 1] = y;
    floats[o + 2] = z;
    floats[o + 3] = s.v;
    floats[o + 4] = s.bv;
    floats[o + 5] = s.pmRa;
    floats[o + 6] = s.pmDec;
    ids[i] = packTyc(s.tyc1, s.tyc2, s.tyc3);
  }
  await writeFile(file + '.bin', Buffer.from(floats.buffer));
  await writeFile(file + '.ids', Buffer.from(ids.buffer));
  histogram.set(path.relative(OUT, file + '.bin'), stars.length);
  return { file: path.relative(OUT, file + '.bin'), stars: stars.length, bytes: floats.byteLength };
}

async function buildStars(): Promise<void> {
  console.log('Parsing Tycho-2 (20 volumes, 2.54M stars) + supplements...');
  const allStars: Star[] = [];
  const tycSeen = new Set<number>();
  const t0 = Date.now();
  for await (const star of iterateTycho2()) {
    allStars.push(star);
    tycSeen.add(packTyc(star.tyc1, star.tyc2, star.tyc3));
  }
  const mainCount = allStars.length;
  // Supplements carry the bright saturated stars (Sirius, Canopus, Crux...)
  // plus Tycho-1 cross-checks; positions propagated to J2000.0 on parse.
  for await (const star of iterateSupplement()) {
    const id = packTyc(star.tyc1, star.tyc2, star.tyc3);
    if (tycSeen.has(id)) continue;
    tycSeen.add(id);
    allStars.push(star);
  }
  console.log(
    `  parsed ${mainCount.toLocaleString()} main + ${(allStars.length - mainCount).toLocaleString()} supplement stars in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
  );

  await mkdir(OUT, { recursive: true });

  // B-V for supplement 'H' rows (Hp-only, no BT): patch from HYG color index.
  const hygBvPatch = new Map<number, number>();
  try {
    const hygAll = await readFile(path.join(RAW, 'hygdata_v41.csv'), 'utf8');
    const rows = hygAll.split('\n');
    const hdr = rows[0]!.split(',').map((h) => h.replace(/"/g, ''));
    const iH = hdr.indexOf('hip');
    const iC = hdr.indexOf('ci');
    for (let i = 1; i < rows.length; i++) {
      const cells = rows[i]!.split(',').map((c) => c.replace(/^"|"$/g, ''));
      const hip = Number(cells[iH]);
      const ci = Number(cells[iC]);
      if (Number.isFinite(hip) && hip > 0 && Number.isFinite(ci)) {
        hygBvPatch.set(hip, ci);
      }
    }
    let patched = 0;
    for (const s of allStars) {
      if (!Number.isFinite(s.bv)) {
        const ci = s.hip > 0 ? hygBvPatch.get(s.hip) : undefined;
        s.bv = ci !== undefined ? ci : 0.65;
        if (ci !== undefined) patched++;
      }
    }
    console.log(`  B-V patched for ${patched} supplement stars from HYG`);
  } catch {
    for (const s of allStars) if (!Number.isFinite(s.bv)) s.bv = 0.65;
  }

  // Named-star support: HIP -> star index, then attach names from HYG + IAU.
  const byHip = new Map<number, Star>();
  // First-seen wins: the main catalogue and primary (A) components come
  // first, so faint B components of doubles must not steal the name entry.
  for (const s of allStars) if (s.hip > 0 && !byHip.has(s.hip)) byHip.set(s.hip, s);

  // ---------------- names ----------------
  interface NameEntry {
    tyc: string;
    hip: number;
    mag: number;
    /** J2000 unit-vector, for label placement without a catalog lookup. */
    xyz: [number, number, number];
    en?: string;
    bayer?: string;
    flam?: string;
    zh: string[];
  }
  const names = new Map<string, NameEntry>();
  const nameOf = (star: Star): NameEntry => {
    const code = `${star.tyc1}-${star.tyc2}-${star.tyc3}`;
    let e = names.get(code);
    if (!e) {
      e = { tyc: code, hip: star.hip, mag: star.v, xyz: raDecToXyz(star.ra, star.dec), zh: [] };
      names.set(code, e);
    }
    return e;
  };

  // HYG: proper names + Bayer + Flamsteed (CC BY-SA 4.0, astronexus).
  const hygCsv = await readFile(path.join(RAW, 'hygdata_v41.csv'), 'utf8');
  const hygLines = hygCsv.split('\n');
  const header = hygLines[0]!.split(',').map((h) => h.replace(/"/g, ''));
  const colIdx = (name: string) => header.indexOf(name);
  const iHip = colIdx('hip');
  const iProper = colIdx('proper');
  const iBayer = colIdx('bayer');
  const iFlam = colIdx('flam');
  const iMag = colIdx('mag');
  const iCi = colIdx('ci');
  let hygMatched = 0;
  // HYG also carries HIP positions, used as fallback for constellation lines.
  const hygPos = new Map<number, { ra: number; dec: number; mag: number; bv: number }>();
  for (let i = 1; i < hygLines.length; i++) {
    const line = hygLines[i]!;
    if (line.length < 10) continue;
    // Simple CSV split is safe here (no quoted commas in the fields we use);
    // strip the surrounding quotes each cell carries.
    const cells = line.split(',').map((c) => c.replace(/^"|"$/g, ''));
    const hip = Number(cells[iHip]);
    if (!Number.isFinite(hip) || hip <= 0) continue; // skips the Sun row (id 0)
    const ra = Number(cells[colIdx('ra')]);
    const dec = Number(cells[colIdx('dec')]);
    const mag = Number(cells[iMag]);
    const ci = Number(cells[iCi]);
    if (Number.isFinite(ra) && Number.isFinite(dec)) {
      hygPos.set(hip, { ra, dec, mag, bv: Number.isFinite(ci) ? ci : 0.65 });
    }
    const star = byHip.get(hip);
    if (!star) continue;
    hygMatched++;
    const entry = nameOf(star);
    const proper = cells[iProper]?.trim() ?? '';
    const bayer = cells[iBayer]?.trim() ?? '';
    const flam = cells[iFlam]?.trim() ?? '';
    if (proper) entry.en = proper;
    if (bayer) entry.bayer = bayer;
    if (flam && !bayer) entry.flam = flam;
  }
  console.log(`  HYG: matched ${hygMatched} named/Bayer stars`);

  // IAU CSN: official proper names. Column positions vary (designations may
  // contain spaces), so anchor on the fixed tail: [..., HIP, HD, RA, Dec, Date, Note?].
  const csn = await readFile(path.join(RAW, 'IAU-CSN.txt'), 'utf8');
  let csnCount = 0;
  for (const line of csn.split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const cells = line.trim().split(/\s+/);
    const name = cells[0];
    const tail = cells[cells.length - 1] === '*' ? cells.length - 1 : cells.length;
    // tail layout: [..., HIP, HD, RA, Dec, Date] (+ optional trailing note)
    const hipTok = cells[tail - 5];
    const hip = hipTok && hipTok !== '_' ? Number(hipTok) : NaN;
    if (!name || !Number.isFinite(hip) || hip <= 0) continue;
    const star = byHip.get(hip);
    if (!star) continue;
    nameOf(star).en = name;
    csnCount++;
  }
  console.log(`  IAU CSN: ${csnCount} official names attached`);

  // Chinese star names (Stellarium chinese skyculture, CC BY-SA 4.0).
  const zhFab = await readFile(
    path.join(RAW, 'skycultures', 'chinese-star-names.fab'),
    'utf8',
  );
  let zhCount = 0;
  for (const line of zhFab.split('\n')) {
    const m = line.match(/^(\d+)\|_\("([^"]+)"\)/);
    if (!m) continue;
    const hip = Number(m[1]);
    const star = byHip.get(hip);
    if (!star) continue;
    nameOf(star).zh.push(m[2]!);
    zhCount++;
  }
  console.log(`  Chinese star names: ${zhCount}`);

  // Keep the names file small: proper names and Chinese names at any
  // brightness, Bayer/Flamsteed labels only for the brighter stars.
  const BAYER_LABEL_LIMIT = 5.5;
  for (const [code, e] of names) {
    const onlyFaintBayer = !e.en && e.zh.length === 0 && e.mag >= BAYER_LABEL_LIMIT;
    if (onlyFaintBayer) names.delete(code);
  }
  const namesJson = {
    license: 'HYG v41 (CC BY-SA 4.0); IAU CSN (IAU, free use with credit); Chinese names: Stellarium chinese skyculture (CC BY-SA 4.0)',
    entries: [...names.values()].sort((a, b) => a.mag - b.mag),
  };
  await writeFile(path.join(OUT, 'names.json'), JSON.stringify(namesJson));
  console.log(`  names.json: ${names.size} named stars`);

  // ---------------- constellation lines ----------------
  type LineJson = {
    id: string;
    name: string;
    nameEn: string;
    lines: number[][]; // flat [x,y,z, x,y,z, ...] per segment
    stars: { hip: number; tyc?: string; mag: number }[];
  };
  const posOf = (hip: number): { ra: number; dec: number; mag: number; star?: Star } | null => {
    const star = byHip.get(hip);
    if (star) return { ra: star.ra, dec: star.dec, mag: star.v, star };
    const hyg = hygPos.get(hip);
    return hyg ?? null;
  };

  const ZH_88: Record<string, string> = {
    // IAU 3-letter -> Chinese, standard translations.
    And: '仙女座', Ant: '蚂蚁座', Aps: '天燕座', Aqr: '宝瓶座', Aql: '天鹰座', Ara: '天坛座',
    Ari: '白羊座', Aur: '御夫座', Boo: '牧夫座', Cae: '雕具座', Cam: '鹿豹座', Cnc: '巨蟹座',
    CVn: '猎犬座', CMa: '大犬座', CMi: '小犬座', Cap: '摩羯座', Car: '船底座', Cas: '仙后座',
    Cen: '半人马座', Cep: '仙王座', Cet: '鲸鱼座', Cha: '蝘蜓座', Cir: '圆规座', Col: '天鸽座',
    Com: '后发座', CrA: '南冕座', CrB: '北冕座', Crv: '乌鸦座', Crt: '巨爵座', Cru: '南十字座',
    Cyg: '天鹅座', Del: '海豚座', Dor: '剑鱼座', Dra: '天龙座', Equ: '小马座', Eri: '波江座',
    For: '天炉座', Gem: '双子座', Gru: '天鹤座', Her: '武仙座', Hor: '时钟座', Hya: '长蛇座',
    Hyi: '水蛇座', Ind: '印第安座', Lac: '蝎虎座', Leo: '狮子座', LMi: '小狮座', Lep: '天兔座',
    Lib: '天秤座', Lup: '豺狼座', Lyn: '天猫座', Lyr: '天琴座', Men: '山案座', Mic: '显微镜座',
    Mon: '麒麟座', Mus: '苍蝇座', Nor: '矩尺座', Oct: '南极座', Oph: '蛇夫座', Ori: '猎户座',
    Pav: '孔雀座', Peg: '飞马座', Per: '英仙座', Phe: '凤凰座', Pic: '绘架座', Psc: '双鱼座',
    PsA: '南鱼座', Pup: '船尾座', Pyx: '罗盘座', Ret: '网罟座', Sge: '天箭座', Sgr: '人马座',
    Sco: '天蝎座', Scl: '玉夫座', Sct: '盾牌座', Ser: '巨蛇座', Sex: '六分仪座', Tau: '金牛座',
    Tel: '望远镜座', Tri: '三角形', TrA: '南三角座', Tuc: '杜鹃座', UMa: '大熊座', UMi: '小熊座',
    Vel: '船帆座', Vir: '室女座', Vol: '飞鱼座', Vul: '狐狸座',
  };

  const convertSkyculture = async (
    file: string,
    isChinese: boolean,
  ): Promise<{ list: LineJson[]; missing: number }> => {
    const raw = JSON.parse(await readFile(file, 'utf8')) as {
      constellations: {
        id: string;
        lines: number[][];
        common_name: { english?: string; native?: string };
      }[];
    };
    const list: LineJson[] = [];
    let missing = 0;
    for (const con of raw.constellations) {
      const abbr = con.id.split(' ')[2] ?? '';
      const name = isChinese
        ? (con.common_name.native ?? con.common_name.english ?? con.id)
        : (ZH_88[abbr] ?? con.common_name.native ?? con.id);
      const segments: number[][] = [];
      const starsOut: LineJson['stars'] = [];
      for (const seg of con.lines) {
        const flat: number[] = [];
        let ok = true;
        for (const hip of seg) {
          const p = posOf(hip);
          if (!p) {
            missing++;
            ok = false;
            continue;
          }
          const [x, y, z] = raDecToXyz(p.ra, p.dec);
          flat.push(x, y, z);
          starsOut.push({
            hip,
            tyc: p.star ? `${p.star.tyc1}-${p.star.tyc2}-${p.star.tyc3}` : undefined,
            mag: p.mag,
          });
        }
        if (ok && flat.length >= 6) segments.push(flat);
      }
      if (segments.length > 0) {
        list.push({
          id: con.id,
          name,
          nameEn: con.common_name.english ?? con.common_name.native ?? con.id,
          lines: segments,
          stars: starsOut,
        });
      }
    }
    return { list, missing };
  };

  const modern = await convertSkyculture(
    path.join(RAW, 'skycultures', 'modern-index.json'),
    false,
  );
  const chinese = await convertSkyculture(
    path.join(RAW, 'skycultures', 'chinese-index.json'),
    true,
  );
  console.log(
    `  constellations: ${modern.list.length} western (missing ${modern.missing} refs), ${chinese.list.length} xingguan (missing ${chinese.missing} refs)`,
  );
  await writeFile(
    path.join(OUT, 'constellations.json'),
    JSON.stringify({
      license: 'Stellarium skycultures (modern, chinese) — CC BY-SA 4.0',
      western: modern.list,
      chinese: chinese.list,
    }),
  );

  // ---------------- magnitude bins ----------------
  const bins = BINS.map((b) => ({ ...b, stars: [] as Star[] }));
  for (const s of allStars) {
    for (const b of bins) {
      if (s.v >= b.lo && s.v < b.hi) {
        b.stars.push(s);
        break;
      }
    }
  }
  const histogramAll = new Map<string, number>();
  const files: FileStats[] = [];
  const sliceManifest: Record<string, { pixels: number; stars: number }> = {};
  for (const b of bins) {
    if (b.allSky) {
      const stats = await writeBin(path.join(OUT, b.key), b.stars, histogramAll);
      files.push(stats);
      console.log(
        `  ${b.key}: ${b.stars.length.toLocaleString()} stars, ${(stats.bytes / 1e6).toFixed(2)} MB`,
      );
    } else {
      const byPix = new Map<number, Star[]>();
      for (const s of b.stars) {
        const [x, y, z] = raDecToXyz(s.ra, s.dec);
        const pix = vec2pixRing(NSIDE, x, y, z);
        let arr = byPix.get(pix);
        if (!arr) {
          arr = [];
          byPix.set(pix, arr);
        }
        arr.push(s);
      }
      const dir = path.join(OUT, b.key);
      await mkdir(dir, { recursive: true });
      let totalBytes = 0;
      for (const [pix, stars] of byPix) {
        const stats = await writeBin(path.join(dir, String(pix).padStart(4, '0')), stars, histogramAll);
        files.push(stats);
        totalBytes += stats.bytes;
      }
      sliceManifest[b.key] = { pixels: byPix.size, stars: b.stars.length };
      console.log(
        `  ${b.key}: ${b.stars.length.toLocaleString()} stars in ${byPix.size} tiles, ${(totalBytes / 1e6).toFixed(2)} MB total`,
      );
    }
  }

  // ---------------- manifest ----------------
  const magHist: Record<string, number> = {};
  for (const s of allStars) {
    const bucket = Math.floor(Math.min(s.v, 16));
    magHist[String(bucket)] = (magHist[String(bucket)] ?? 0) + 1;
  }
  const manifest = {
    generated: new Date().toISOString(),
    source: {
      catalog: 'Tycho-2 (Hog et al. 2000), VizieR I/259 — ESA Hipparcos/Tycho mission data',
      epoch: 'J2000 (ICRS), proper motions from catalog (mas/yr)',
      license: 'Tycho-2: scientific/educational use with citation (see README). Names: HYG CC BY-SA 4.0, IAU CSN, Stellarium skycultures CC BY-SA 4.0.',
    },
    format: {
      stride: STRIDE,
      layout: '[x, y, z, mag(V), bv(B-V), pmRA_mas_yr, pmDec_mas_yr] float32 LE',
      ids: 'parallel uint32: (tyc1<<16) | (tyc2<<2) | (tyc3-1)',
    },
    healpix: { nside: NSIDE, scheme: 'RING', npix: 12 * NSIDE * NSIDE },
    bins: bins.map((b) => ({
      key: b.key,
      lo: b.lo === -Infinity ? null : b.lo,
      hi: b.hi === Infinity ? null : b.hi,
      allSky: b.allSky,
      stars: b.stars.length,
      ...(b.allSky ? {} : { tiles: sliceManifest[b.key] }),
    })),
    magHistogram: magHist,
    totalStars: allStars.length,
  };
  await writeFile(path.join(OUT, 'index.json'), JSON.stringify(manifest, null, 2));

  const totalBytes = files.reduce((acc, f) => acc + f.bytes, 0);
  console.log(
    `\nDone: ${allStars.length.toLocaleString()} stars, ${(totalBytes / 1e6).toFixed(1)} MB total in ${files.length} files -> public/data/`,
  );
}

buildStars().catch((err) => {
  console.error(err);
  process.exit(1);
});
