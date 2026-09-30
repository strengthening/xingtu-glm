/**
 * 下载原始数据：Tycho-2 星表（含补编）、Stellarium 星空文化数据（星名、星座连线）、银河全景贴图。
 *
 * 原始数据放入 data/raw/（已 .gitignore，不入库），银河贴图属运行资源放入 public/assets/。
 * 已存在的文件自动跳过（支持断点续传）。
 *
 * 数据来源与许可：
 * - Tycho-2（CDS I/259，Høg et al. 2000）：ESA/ESO/CDS 发布，公有领域数据。
 * - Stellarium skycultures（western / chinese）：CC BY-SA 4.0（部分源自 GNU GPL 2+ 的
 *   Stellarium 数据文件，见 data/raw/skycultures/LICENSE.md）。
 * - Stellarium 银河贴图：Stellarium 项目分发的运行资源。
 */
import { createWriteStream } from 'node:fs';
import { existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';

const CDS = 'https://cdsarc.cds.unistra.fr/ftp/I/259';
const STELLARIUM = 'https://raw.githubusercontent.com/Stellarium/stellarium/master';

interface FetchJob {
  url: string;
  dest: string;
  /** 下载后同时解压出的 gunzip 目标（点对点小文件用）。 */
}

const JOBS: FetchJob[] = [
  // Tycho-2 主表分卷 + 补编
  ...Array.from({ length: 20 }, (_, i) => ({
    url: `${CDS}/tyc2.dat.${String(i).padStart(2, '0')}.gz`,
    dest: `data/raw/tyc2/tyc2.dat.${String(i).padStart(2, '0')}.gz`,
  })),
  { url: `${CDS}/suppl_1.dat.gz`, dest: 'data/raw/tyc2/suppl_1.dat.gz' },
  { url: `${CDS}/suppl_2.dat.gz`, dest: 'data/raw/tyc2/suppl_2.dat.gz' },
  { url: `${CDS}/ReadMe`, dest: 'data/raw/tyc2/ReadMe' },
  // Stellarium 星空文化：现代（西方）星座 + 中国星官（三垣二十八宿）+ 通用星名
  {
    url: `${STELLARIUM}/skycultures/modern/index.json`,
    dest: 'data/raw/skycultures/modern-index.json',
  },
  {
    url: `${STELLARIUM}/skycultures/common_star_names.fab`,
    dest: 'data/raw/skycultures/common-star-names.fab',
  },
  {
    url: `${STELLARIUM}/skycultures/chinese/index.json`,
    dest: 'data/raw/skycultures/chinese-index.json',
  },
  {
    url: `${STELLARIUM}/skycultures/chinese/star_names.zh_CN.fab`,
    dest: 'data/raw/skycultures/chinese-star-names.fab',
  },
  // 银河全景贴图（运行时资源）
  {
    url: `${STELLARIUM}/textures/milkyway.png`,
    dest: 'public/assets/milkyway.png',
  },
];

async function download(job: FetchJob, retries = 3): Promise<void> {
  mkdirSync(dirname(job.dest), { recursive: true });
  if (existsSync(job.dest) && statSync(job.dest).size > 0) {
    console.log(`skip  ${job.dest}`);
    return;
  }
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const res = await fetch(job.url);
      if (!res.ok || !res.body) {
        throw new Error(`HTTP ${res.status}`);
      }
      const tmp = `${job.dest}.part`;
      await pipeline(Readable.fromWeb(res.body as never), createWriteStream(tmp));
      const { renameSync } = await import('node:fs');
      renameSync(tmp, job.dest);
      const kb = Math.round(statSync(job.dest).size / 1024);
      console.log(`ok    ${job.dest} (${kb} KB)`);
      return;
    } catch (err) {
      console.warn(`retry ${attempt}/${retries} ${job.url}: ${String(err)}`);
      if (attempt === retries) throw err;
      await new Promise((r) => setTimeout(r, 2000 * attempt));
    }
  }
}

async function main(): Promise<void> {
  void createGunzip; // 预留：当前脚本保存 .gz 原样，解压在 build-stars.ts 流式进行
  for (const job of JOBS) {
    await download(job);
  }
  console.log('全部下载完成。');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
