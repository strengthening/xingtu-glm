/**
 * download-stars.ts — fetch raw catalog data into data/raw/ (git-ignored).
 *
 * Total download is roughly 210 MB (Tycho-2 gzipped volumes) plus ~34 MB HYG.
 *
 * Run: pnpm stars:download
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RAW = path.join(ROOT, 'data', 'raw');

function curl(url: string, out: string): void {
  if (existsSync(out)) {
    console.log(`  exists: ${path.relative(ROOT, out)}`);
    return;
  }
  console.log(`  ${path.relative(ROOT, out)} <- ${url}`);
  execFileSync('curl', ['-sS', '--fail', '--max-time', '900', '-o', out, url], {
    stdio: 'inherit',
  });
}

mkdirSync(path.join(RAW, 'tyc2'), { recursive: true });
mkdirSync(path.join(RAW, 'skycultures'), { recursive: true });

console.log('Tycho-2 main catalogue (VizieR I/259, CDS Strasbourg)...');
const CDS = 'https://cdsarc.cds.unistra.fr/ftp/cats/I/259';
for (let i = 0; i < 40; i++) {
  curl(`${CDS}/tyc2.dat.${String(i).padStart(2, '0')}.gz`, path.join(RAW, 'tyc2', `tyc2.dat.${String(i).padStart(2, '0')}.gz`));
}
curl(`${CDS}/ReadMe`, path.join(RAW, 'tyc2', 'ReadMe'));

console.log('HYG database v41 (names/Bayer/Flamsteed, CC BY-SA 4.0)...');
curl(
  'https://github.com/astronexus/HYG-Database/raw/main/hyg/CURRENT/hygdata_v41.csv',
  path.join(RAW, 'hygdata_v41.csv'),
);

console.log('IAU Catalog of Star Names...');
curl(
  'https://www.pas.rochester.edu/~emamajek/WGSN/IAU-CSN.txt',
  path.join(RAW, 'IAU-CSN.txt'),
);

console.log('Constellation lines (Stellarium skycultures, CC BY-SA 4.0)...');
const SC = 'https://raw.githubusercontent.com/stellarium/stellarium/v26.3/skycultures';
curl(`${SC}/modern/index.json`, path.join(RAW, 'skycultures', 'modern-index.json'));
curl(`${SC}/chinese/index.json`, path.join(RAW, 'skycultures', 'chinese-index.json'));
curl(`${SC}/chinese/star_names.zh_CN.fab`, path.join(RAW, 'skycultures', 'chinese-star-names.fab'));

console.log('All raw data ready in data/raw/.');
