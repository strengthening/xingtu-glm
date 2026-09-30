/**
 * 星表预处理：解析 Tycho-2 主表 + 补编 → 分档二进制输出到 public/data/stars/。
 *
 * 档位（V 星等，Tycho-2 V = VT − 0.090·(BT−VT)，B−V = 0.850·(BT−VT)）：
 *   t0: V ≤ 6.5    全天整体加载
 *   t1: 6.5–8.0    全天整体加载
 *   t2: 8.0–9.5    HEALPix nside=8 切片
 *   t3: 9.5–10.6   HEALPix nside=8 切片
 *   t4: 10.6–12.5  HEALPix nside=8 切片（数据实际极限 ~11.5）
 *
 * 文件布局（单文件）：
 *   [uint32 星数][float32 × 7 × N（x,y,z,V,BV,pmRA,pmDE）][uint32 × N（TYC 压缩编号）]
 *   坐标为 J2000 赤道系单位球；pm 单位 mas/年（pmRA 含 cosδ）。
 *   TYC 编码：TYC1<<17 | TYC2<<3 | TYC3（TYC2 ≤ 12121 < 2^14）。
 *
 * 同时生成：
 *   meta.json       档位定义与统计（含每文件大小与星数）
 *   names.json      有名字的星（HIP 名，来自 Stellarium 星空文化数据）
 *   constellations.json  星座连线段（J2000 坐标对，来自 Stellarium）
 */
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { createGunzip } from 'node:zlib';
import { DEG, radecToUnit } from '../src/astro/coords';
import { radecToPixNest } from '../src/astro/healpix';

const RAW = 'data/raw/tyc2';
const OUT = 'public/data/stars';
const NSIDE = 8;

interface TierDef {
  id: string;
  minMag: number; // 含
  maxMag: number; // 不含
  healpix: boolean;
}

const TIERS: TierDef[] = [
  { id: 't0', minMag: -10, maxMag: 6.5, healpix: false },
  { id: 't1', minMag: 6.5, maxMag: 8.0, healpix: false },
  { id: 't2', minMag: 8.0, maxMag: 9.5, healpix: true },
  { id: 't3', minMag: 9.5, maxMag: 10.6, healpix: true },
  { id: 't4', minMag: 10.6, maxMag: 12.5, healpix: true },
];

interface StarRow {
  x: number;
  y: number;
  z: number;
  v: number;
  bv: number;
  pmRa: number;
  pmDec: number;
  tyc: number;
  hip: number; // 0 = 无
}

/** 缺省色指数（只有单波段星等时的近似，仅影响颜色不影响位置）。 */
const DEFAULT_BV = 0.7;

function parseNum(s: string): number {
  const t = s.trim();
  return t === '' ? NaN : Number(t);
}

/**
 * 主表行 → StarRow；返回 null 表示跳过（无有效位置或星等，或太阳之类的异常行）。
 * 注意 substring 为半开区间 [s,e)，列号 N-M 对应 substring(N-1, M)。
 */
function parseMainLine(line: string): StarRow | null {
  if (line.length < 130) return null;
  const tyc1 = parseNum(line.substring(0, 4));
  const tyc2 = parseNum(line.substring(5, 10));
  const tyc3 = parseNum(line.substring(11, 12));
  const ra = parseNum(line.substring(15, 27));
  const dec = parseNum(line.substring(28, 40));
  const pmRa = parseNum(line.substring(41, 48));
  const pmDec = parseNum(line.substring(49, 56));
  const bt = parseNum(line.substring(110, 116));
  const vt = parseNum(line.substring(123, 129));
  const hip = line.length >= 148 ? parseNum(line.substring(142, 148)) : NaN;
  return finalizeRow(tyc1, tyc2, tyc3, ra, dec, pmRa, pmDec, bt, vt, hip);
}

/**
 * 补编行（suppl_1/suppl_2，位置历元 1991.25）→ StarRow。
 * flag='H'（Hipparcos 数据）按自行推到 J2000；'T' 无自行，直接采用。
 */
function parseSupplLine(line: string): StarRow | null {
  if (line.length < 103) return null;
  const tyc1 = parseNum(line.substring(0, 4));
  const tyc2 = parseNum(line.substring(5, 10));
  const tyc3 = parseNum(line.substring(11, 12));
  let ra = parseNum(line.substring(15, 27));
  let dec = parseNum(line.substring(28, 40));
  const pmRa = parseNum(line.substring(41, 48));
  const pmDec = parseNum(line.substring(49, 56));
  const flag = line.substring(13, 14);
  const bt = parseNum(line.substring(83, 89));
  const vt = parseNum(line.substring(96, 102));
  const hip = line.length >= 121 ? parseNum(line.substring(115, 121)) : NaN;
  // 1991.25 → 2000.0，pmRA 含 cosδ
  if (flag === 'H' && !Number.isNaN(pmRa) && !Number.isNaN(pmDec)) {
    const dt = 8.75;
    const cosd = Math.cos(dec * DEG);
    if (cosd > 1e-6) ra += (pmRa / cosd / 3_600_000) / DEG * dt;
    dec += (pmDec / 3_600_000 / DEG) * dt;
  }
  return finalizeRow(tyc1, tyc2, tyc3, ra, dec, pmRa, pmDec, bt, vt, hip);
}

function finalizeRow(
  tyc1: number,
  tyc2: number,
  tyc3: number,
  ra: number,
  dec: number,
  pmRa: number,
  pmDec: number,
  bt: number,
  vt: number,
  hip: number,
): StarRow | null {
  if (![tyc1, tyc2, ra, dec].every(Number.isFinite)) return null;
  if (ra < 0 || ra >= 360 || dec < -90 || dec > 90) return null;
  let v: number;
  let bv: number;
  if (Number.isFinite(bt) && Number.isFinite(vt)) {
    const c = bt - vt;
    v = vt - 0.09 * c;
    bv = 0.85 * c;
  } else if (Number.isFinite(vt)) {
    v = vt;
    bv = DEFAULT_BV;
  } else if (Number.isFinite(bt)) {
    v = bt;
    bv = DEFAULT_BV + 0.3;
  } else {
    return null; // 无任何星等，无法分级
  }
  if (v < -20) return null; // 防御：太阳（V≈−26.7）等异常行不会出现在本表
  bv = Math.max(-0.4, Math.min(2.0, bv));
  const u = radecToUnit({ ra, dec });
  return {
    x: u.x,
    y: u.y,
    z: u.z,
    v,
    bv,
    pmRa: Number.isFinite(pmRa) ? pmRa : 0,
    pmDec: Number.isFinite(pmDec) ? pmDec : 0,
    tyc: ((tyc1 << 17) | (tyc2 << 3) | tyc3) >>> 0,
    hip: Number.isFinite(hip) && hip > 0 ? hip : 0,
  };
}

/** 逐行读取（支持 .gz）。 */
async function* readLines(path: string): AsyncGenerator<string> {
  const stream = path.endsWith('.gz')
    ? createReadStream(path).pipe(createGunzip())
    : createReadStream(path, 'utf8');
  yield* (async function* () {
    const rl = createInterface({ input: stream as never, crlfDelay: Infinity });
    for await (const line of rl) yield line;
  })();
}

interface StarBuffer {
  floats: number[]; // 7/星
  ids: number[]; // tyc 编码
  hips: number[]; // 同序 hip（用于名字交叉，仅输出阶段用）
}

function newBuffer(): StarBuffer {
  return { floats: [], ids: [], hips: [] };
}

function pushStar(buf: StarBuffer, s: StarRow): void {
  buf.floats.push(s.x, s.y, s.z, s.v, s.bv, s.pmRa, s.pmDec);
  buf.ids.push(s.tyc);
  buf.hips.push(s.hip);
}

async function writeBuffer(path: string, buf: StarBuffer): Promise<{ count: number; bytes: number }> {
  const count = buf.ids.length;
  const bytes = 4 + count * 7 * 4 + count * 4;
  const ab = new ArrayBuffer(bytes);
  const dv = new DataView(ab);
  dv.setUint32(0, count, true);
  const f32 = new Float32Array(ab, 4, count * 7);
  f32.set(buf.floats);
  const u32 = new Uint32Array(ab, 4 + count * 28, count);
  u32.set(buf.ids);
  await new Promise<void>((resolve, reject) => {
    const ws = createWriteStream(path);
    ws.write(Buffer.from(ab));
    ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
  return { count, bytes };
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  const files = readdirSync(RAW).filter((f) => /^tyc2\.dat\.\d\d\.gz$/.test(f)).sort();
  if (files.length === 0) {
    throw new Error(`未找到 ${RAW}/tyc2.dat.*.gz，请先运行 pnpm stars:download`);
  }

  // 全天档缓冲 + 切片档缓冲（768 块 × 档）
  const wholeBufs = new Map<string, StarBuffer>();
  const tileBufs = new Map<string, StarBuffer>(); // key: `${tier}/${pix}`
  for (const t of TIERS) {
    if (!t.healpix) wholeBufs.set(t.id, newBuffer());
  }
  const tierCounts = new Map<string, number>(TIERS.map((t) => [t.id, 0]));
  let total = 0;
  let skipped = 0;

  const route = (s: StarRow): void => {
    const tier = TIERS.find((t) => s.v >= t.minMag && s.v < t.maxMag);
    if (!tier) {
      skipped++;
      return;
    }
    if (tier.healpix) {
      const ra = Math.atan2(s.y, s.x) / DEG;
      const dec = Math.asin(Math.max(-1, Math.min(1, s.z))) / DEG;
      const raPos = ra < 0 ? ra + 360 : ra;
      const pix = radecToPixNest(NSIDE, raPos, dec);
      const key = `${tier.id}/${pix}`;
      let buf = tileBufs.get(key);
      if (!buf) {
        buf = newBuffer();
        tileBufs.set(key, buf);
      }
      pushStar(buf, s);
    } else {
      pushStar(wholeBufs.get(tier.id)!, s);
    }
    tierCounts.set(tier.id, tierCounts.get(tier.id)! + 1);
    total++;
  };

  // 1) 主表
  for (const f of files) {
    process.stdout.write(`解析 ${f} …\r`);
    for await (const line of readLines(join(RAW, f))) {
      const row = parseMainLine(line);
      if (row) route(row);
    }
  }
  // 2) 补编（suppl_1 恢复被 Tycho-1 饱和剔除的亮星，suppl_2 补更暗的星）
  for (const f of ['suppl_1.dat.gz', 'suppl_2.dat.gz']) {
    process.stdout.write(`解析 ${f} …\r`);
    for await (const line of readLines(join(RAW, f))) {
      const row = parseSupplLine(line);
      if (row) route(row);
    }
  }
  process.stdout.write('\n');

  // 输出全天档
  const tierStats: Record<string, { count: number; bytes: number; files: number }> = {};
  for (const [tier, buf] of wholeBufs) {
    const { count, bytes } = await writeBuffer(join(OUT, `${tier}.bin`), buf);
    tierStats[tier] = { count, bytes, files: 1 };
    console.log(`${tier}.bin         ${count.toLocaleString()} 星  ${(bytes / 1024).toFixed(0)} KB`);
  }
  // 输出切片档
  for (const t of TIERS.filter((x) => x.healpix)) {
    mkdirSync(join(OUT, t.id), { recursive: true });
    let files = 0;
    let count = 0;
    let bytes = 0;
    for (const [key, buf] of tileBufs) {
      if (!key.startsWith(`${t.id}/`)) continue;
      const pix = key.split('/')[1]!;
      const r = await writeBuffer(join(OUT, t.id, `${pix.padStart(3, '0')}.bin`), buf);
      files++;
      count += r.count;
      bytes += r.bytes;
    }
    tierStats[t.id] = { count, bytes, files };
    console.log(
      `${t.id}/（${files} 块）   ${count.toLocaleString()} 星  ${(bytes / 1024 / 1024).toFixed(1)} MB`,
    );
  }

  const meta = {
    version: 1,
    nside: NSIDE,
    stride: 7,
    total,
    skipped,
    tiers: TIERS.map((t) => ({ ...t, stats: tierStats[t.id] })),
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(join(OUT, 'meta.json'), JSON.stringify(meta, null, 2));
  console.log(`共 ${total.toLocaleString()} 星（跳过 ${skipped}），详见 ${OUT}/meta.json`);

  // HIP → 星表位置交叉缓存，供星座/星名步骤使用
  const hipIndex: Record<number, { ra: number; dec: number; v: number; tyc: number }> = {};
  const collect = (buf: StarBuffer): void => {
    for (let i = 0; i < buf.hips.length; i++) {
      const hip = buf.hips[i]!;
      if (hip <= 0) continue;
      const x = buf.floats[i * 7]!;
      const y = buf.floats[i * 7 + 1]!;
      const z = buf.floats[i * 7 + 2]!;
      let ra = Math.atan2(y, x) / DEG;
      if (ra < 0) ra += 360;
      const dec = Math.asin(Math.max(-1, Math.min(1, z))) / DEG;
      const v = buf.floats[i * 7 + 3]!;
      const tyc = buf.ids[i]!;
      if (!hipIndex[hip]) hipIndex[hip] = { ra, dec, v, tyc };
    }
  };
  for (const buf of wholeBufs.values()) collect(buf);
  for (const buf of tileBufs.values()) collect(buf);
  console.log(`HIP 交叉 ${Object.keys(hipIndex).length} 星`);

  await buildCultureData(hipIndex);
}

// ---------------------------------------------------------------------------
// Stellarium 星空文化数据 → names.json / constellations.json
// ---------------------------------------------------------------------------

interface CultureLineGroup {
  id: string;
  en: string;
  zh: string;
  lines: number[][]; // HIP 折线
}

/** 现代 88 星座的中文译名（IAU 拉丁缩写 → 中文）。 */
const CONSTELLATION_ZH: Record<string, string> = {
  And: '仙女座', Ant: '唧筒座', Aps: '天燕座', Aqr: '宝瓶座', Aql: '天鹰座',
  Ara: '天坛座', Ari: '白羊座', Aur: '御夫座', Boo: '牧夫座', Cae: '雕具座',
  Cam: '鹿豹座', Cnc: '巨蟹座', CVn: '猎犬座', CMa: '大犬座', CMi: '小犬座',
  Cap: '摩羯座', Car: '船底座', Cas: '仙后座', Cen: '半人马座', Cep: '仙王座',
  Cet: '鲸鱼座', Cha: '蝘蜓座', Cir: '圆规座', Col: '天鸽座', Com: '后发座',
  CrA: '南冕座', CrB: '北冕座', Crv: '乌鸦座', Crt: '巨爵座', Cru: '南十字座',
  Cyg: '天鹅座', Del: '海豚座', Dor: '剑鱼座', Dra: '天龙座', Equ: '小马座',
  Eri: '波江座', For: '天炉座', Gem: '双子座', Gru: '天鹤座', Her: '武仙座',
  Hor: '时钟座', Hya: '长蛇座', Hyi: '水蛇座', Ind: '印第安座', Lac: '蝎虎座',
  Leo: '狮子座', LMi: '小狮座', Lep: '天兔座', Lib: '天秤座', Lup: '豺狼座',
  Lyn: '天猫座', Lyr: '天琴座', Men: '山案座', Mic: '显微镜座', Mon: '麒麟座',
  Mus: '苍蝇座', Nor: '矩尺座', Oct: '南极座', Oph: '蛇夫座', Ori: '猎户座',
  Pav: '孔雀座', Peg: '飞马座', Per: '英仙座', Phe: '凤凰座', Pic: '绘架座',
  Psc: '双鱼座', PsA: '南鱼座', Pup: '船尾座', Pyx: '罗盘座', Ret: '网罟座',
  Sge: '天箭座', Sgr: '人马座', Sco: '天蝎座', Scl: '玉夫座', Sct: '盾牌座',
  Ser: '巨蛇座', Sex: '六分仪座', Tau: '金牛座', Tel: '望远镜座', Tri: '三角座',
  TrA: '南三角座', Tuc: '杜鹃座', UMa: '大熊座', UMi: '小熊座', Vel: '船帆座',
  Vir: '室女座', Vol: '飞鱼座', Vul: '狐狸座',
};

function tycToString(tyc: number): string {
  const t1 = tyc >>> 17;
  const t2 = (tyc >>> 3) & 0x3fff;
  const t3 = tyc & 7;
  return `${t1}-${t2}-${t3}`;
}

/** HIP 折线组 → J2000 坐标段（缺 HIP 的顶点该段跳过并计数）。 */
function linesToSegments(
  groups: CultureLineGroup[],
  hipIndex: Record<number, { ra: number; dec: number }>,
): { items: { id: string; en: string; zh: string; segs: number[] }[]; missing: number } {
  const items: { id: string; en: string; zh: string; segs: number[] }[] = [];
  let missing = 0;
  for (const g of groups) {
    const segs: number[] = [];
    for (const line of g.lines) {
      for (let i = 0; i + 1 < line.length; i++) {
        const a = hipIndex[line[i]!];
        const b = hipIndex[line[i + 1]!];
        if (!a || !b) {
          missing++;
          continue;
        }
        segs.push(a.ra, a.dec, b.ra, b.dec);
      }
    }
    if (segs.length > 0) items.push({ id: g.id, en: g.en, zh: g.zh, segs });
  }
  return { items, missing };
}

async function buildCultureData(
  hipIndex: Record<number, { ra: number; dec: number; v: number; tyc: number }>,
): Promise<void> {
  const SC = 'data/raw/skycultures';
  const fs = await import('node:fs/promises');

  // ---- 星名：英文通用名（common_star_names.fab）+ 中文星名（chinese common_names）
  const names: Record<string, { en?: string; zh?: string }> = {};
  const fab = await fs.readFile(`${SC}/common-star-names.fab`, 'utf8');
  for (const line of fab.split('\n')) {
    const m = line.match(/^\s*(\d+)\|_\("([^"]+)"\)/);
    if (!m) continue;
    const star = hipIndex[Number(m[1])];
    if (!star) continue;
    const key = tycToString(star.tyc);
    (names[key] ??= {}).en = m[2]!;
  }
  const zhDoc = JSON.parse(await fs.readFile(`${SC}/chinese-index.json`, 'utf8')) as {
    common_names: Record<string, { native?: string }[]>;
    constellations: { id: string; lines: number[][]; common_name?: { native?: string; english?: string } }[];
  };
  for (const [hipKey, entries] of Object.entries(zhDoc.common_names ?? {})) {
    const star = hipIndex[Number(hipKey.replace('HIP ', ''))];
    if (!star || !entries?.[0]?.native) continue;
    const n = (names[tycToString(star.tyc)] ??= {});
    if (!n.zh) n.zh = entries[0]!.native!;
  }
  writeFileSync(join(OUT, 'names.json'), JSON.stringify(names));
  console.log(
    `星名 ${Object.keys(names).length} 星（中文 ${Object.values(names).filter((n) => n.zh).length}）→ names.json`,
  );

  // ---- 星座连线：modern（西方 88 + 星群）与 chinese（三垣二十八宿等星官）
  const modern = JSON.parse(await fs.readFile(`${SC}/modern-index.json`, 'utf8')) as {
    constellations: { id: string; lines: number[][]; common_name?: { english?: string } }[];
    asterisms: { id: string; lines: number[][]; common_name?: { english?: string } }[];
  };
  const modernGroups: CultureLineGroup[] = [
    ...modern.constellations.map((c) => {
      const abbr = c.id.split(' ').pop() ?? c.id;
      return {
        id: abbr,
        en: c.common_name?.english ?? abbr,
        zh: CONSTELLATION_ZH[abbr] ?? abbr,
        lines: c.lines,
      };
    }),
    ...modern.asterisms
      .filter((a) => a.id.includes('AST'))
      .map((a) => ({
        id: a.id,
        en: a.common_name?.english ?? a.id,
        zh: a.common_name?.english ?? a.id,
        lines: a.lines,
      })),
  ];
  const western = linesToSegments(modernGroups, hipIndex);

  const chineseGroups: CultureLineGroup[] = zhDoc.constellations.map((c) => ({
    id: c.common_name?.native ?? c.id,
    en: c.common_name?.english ?? c.id,
    zh: c.common_name?.native ?? c.id,
    lines: c.lines,
  }));
  const zh = linesToSegments(chineseGroups, hipIndex);

  writeFileSync(
    join(OUT, 'constellations.json'),
    JSON.stringify({ western: western.items, chinese: zh.items }),
  );
  console.log(
    `星座连线：西方 ${western.items.length} 组（缺 HIP ${western.missing} 段）、中国星官 ${zh.items.length} 组（缺 ${zh.missing} 段）→ constellations.json`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
