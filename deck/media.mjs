#!/usr/bin/env node
/**
 * A befektetői prezentáció (/deck) médiája: a promóvideó képernyőfelvételeiből, képernyőképeiből, a minta-polcvideóból
 * és a valódi gerincfotókból kicsi, webre kódolt példányok a `public/deck/media/` alá.
 *
 *   node deck/media.mjs            (újrakészít mindent; a kimenet a repóban van, a források NEM)
 *
 * Források (a repóban nincsenek, csak ezen a gépen): promo/out/screen-captures, promo/out/screenshots,
 * promo/work/data/shelf-tracks.json, Mintavideok/, storage/spines/355721582/. Kell: ffmpeg a PATH-on.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { distance } from 'fastest-levenshtein';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'public/deck/media');
const CAP = path.join(ROOT, 'promo/out/screen-captures');
const SHOT = path.join(ROOT, 'promo/out/screenshots');
const SAMPLE = path.join(ROOT, 'Mintavideok');
const SPINES = path.join(ROOT, 'storage/spines/355721582');
const TRACKS = path.join(ROOT, 'promo/work/data/shelf-tracks.json');
rmSync(path.join(OUT, 'spines'), { recursive: true, force: true }); // régi gerincfotók ne maradjanak
mkdirSync(path.join(OUT, 'spines'), { recursive: true });

const ff = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });
const kb = (f) => Math.round(statSync(f).size / 1024) + ' KB';

/** Videó: hang nélkül, H.264, faststart; `vf` a méretezés/vágás. */
function video(src, name, vf, { crf = 28, ss, to } = {}) {
  const out = path.join(OUT, name);
  ff([...(ss != null ? ['-ss', String(ss)] : []), ...(to != null ? ['-to', String(to)] : []), '-i', src, '-an', '-vf', vf,
    '-c:v', 'libx264', '-preset', 'slow', '-crf', String(crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out]);
  console.log('videó', name, kb(out));
}
/** Első képkocka posztere (a videó betöltéséig és az áttekintő nézetben ez látszik). */
function poster(src, name, at = 0) {
  const tmp = path.join(OUT, '_tmp.png');
  ff(['-ss', String(at), '-i', path.join(OUT, src), '-frames:v', '1', tmp]);
  return sharp(tmp).webp({ quality: 74 }).toFile(path.join(OUT, name)).then(() => console.log('poszter', name, kb(path.join(OUT, name))));
}
async function image(src, name, width, { quality = 80, extract } = {}) {
  let img = sharp(src);
  if (extract) img = img.extract(extract);
  await img.resize({ width, withoutEnlargement: true }).webp({ quality }).toFile(path.join(OUT, name));
  console.log('kép', name, kb(path.join(OUT, name)));
}

/* ------------------------------------------------------------------ 1. a minta-polcvideó + a valódi felismerési adatok */
// 1080×1920 (a forrás 90°-kal elforgatott, az ffmpeg magától állítja), a deck 9:16-os telefonképernyőjére
video(path.join(SAMPLE, '20260912_212903.mp4'), 'shelf.mp4', 'scale=540:960', { crf: 27 });
await poster('shelf.mp4', 'shelf.webp', 0.2);

const tracks = JSON.parse(readFileSync(TRACKS, 'utf8'));
const per = {}, conf = {};
for (const f of tracks.frames) for (const d of f.dets) { (per[d.b] ||= []).push([f.t, d.x0, d.y0, d.x1, d.y1]); conf[d.b] = Math.max(conf[d.b] || 0, d.c); }
const all = Object.entries(per)
  .filter(([id]) => tracks.books[id])
  .map(([id, obs]) => ({ id: id.slice(0, 8), obs: obs.sort((a, b) => a[0] - b[0]), first: obs[0][0], title: tracks.books[id].title, author: tracks.books[id].author, c: conf[id] }))
  .sort((a, b) => a.first - b.first || a.obs[0][1] - b.obs[0][1]);
// A nyomvonalak egy régebbi felismerési futásból valók (37 tétel: ismétlések, a polcon nem szereplő vagy hibás olvasatok).
// Csak azt mutatjuk, ami a kézzel ellenőrzött listán (fixtures/sample-shelf/ground-truth.json) helyesen és egyszer szerepel —
// a hibaarányt a „Mérve, nem becsülve” dia közli; a címlap kiírja, hány könyv van valójában a polcon.
const GT = JSON.parse(readFileSync(path.join(ROOT, 'fixtures/sample-shelf/ground-truth.json'), 'utf8')).videos.find((v) => v.video === '20260912_212903').books;
const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').replace(/[^a-z0-9 ]/g, ' ').replace(/\b(a|az|the)\b/g, ' ').replace(/\s+/g, ' ').trim();
const sim = (a, b) => { a = norm(a); b = norm(b); return a && b ? 1 - distance(a, b) / Math.max(a.length, b.length) : 0; };
const used = new Set();
const books = all.filter((b) => {
  let best = -1, bs = 0;
  GT.forEach((g, i) => { const s = Math.max(sim(b.title, g.title), sim(b.title, g.canonical_title)); if (s > bs) { bs = s; best = i; } });
  if (bs < 0.94 || used.has(best)) return false;
  used.add(best);
  return true;
});
for (const b of books) {
  const src = path.join(SPINES, readdirSync(SPINES).find((f) => f.startsWith(b.id)));
  // a gerincfotó állva, 300 px magasan (a polcon ~120 px-en jelenik meg, 2× élesség)
  await sharp(src).resize({ height: 300 }).webp({ quality: 76 }).toFile(path.join(OUT, 'spines', b.id + '.webp'));
}
// a „gerincenként olvas” diához: nyolc jól olvasható gerinc fekvő helyzetben (−90°), mint egy könyvkupac
const READ = [['Az új név története', 'Elena Ferrante'], ['Start with Why', 'Simon Sinek'], ['Rokonok', 'Móricz Zsigmond'], ['Római vér', 'Steven Saylor'],
  ['The Committed', 'Viet Thanh Nguyen'], ['A gólyakalifa', 'Babits Mihály'], ['Abaddon kapuja', 'James S. A. Corey'], ['Factfulness', 'Hans Rosling']];
for (const [title, author] of READ) {
  const b = books.find((x) => x.title === title && x.author === author);
  const src = path.join(SPINES, readdirSync(SPINES).find((f) => f.startsWith(b.id)));
  await sharp(src).rotate(-90).resize({ width: 720 }).webp({ quality: 78 }).toFile(path.join(OUT, 'spines', 'read-' + b.id + '.webp'));
}
writeFileSync(path.join(OUT, 'shelf-tracks.json'), JSON.stringify({ w: tracks.video.w, h: tracks.video.h, duration: tracks.video.duration, onShelf: GT.length, books }));
console.log('nyomvonalak', books.length, 'helyes könyv a', all.length, 'tételből; a polcon', GT.length);

/* ------------------------------------------------------------------ 2. a képernyőfelvételek */
const phone = 'scale=390:-2';
const desk = 'scale=1094:-2';
video(path.join(CAP, 'telefon-kamera-felvetel.mp4'), 'cam.mp4', phone);
video(path.join(CAP, 'telefon-feldolgozas.mp4'), 'proc.mp4', phone);
video(path.join(CAP, 'telefon-konyvtar-alsomenu-szuro-kereses-felvetel.mp4'), 'lib.mp4', phone);
video(path.join(CAP, 'telefon-telepites-a-kezdokepernyore.mp4'), 'install.mp4', phone);
video(path.join(CAP, 'asztali-polc-valodi-gerincek-konyvlap.mp4'), 'shelfdesk.mp4', desk);
video(path.join(CAP, 'asztali-szurok-es-export.mp4'), 'export.mp4', desk);
await poster('cam.mp4', 'cam.webp', 0.5);
await poster('proc.mp4', 'proc.webp', 24.5);
await poster('lib.mp4', 'lib.webp', 0.3);
await poster('install.mp4', 'install.webp', 4.6);
await poster('shelfdesk.mp4', 'shelfdesk.webp', 13);
await poster('export.mp4', 'export.webp', 11.5);

/* ------------------------------------------------------------------ 3. képernyőképek (2560×1600 → 1280 széles) */
const shots = {
  'v-shelf': '02-polc-valodi-gerincfotokkal.png',
  'v-covers': '05-boritofal.png',
  'v-table': '06-tablazat.png',
  'v-authors': '07-szerzok.png',
  'v-topics': '08-temak.png',
  'v-timeline': '09-idovonal.png',
  'v-stats': '10-statisztika.png',
  'v-dark': '13-sotet-tema-polc.png',
  'catalogue': '01-katalogus-fejlec-es-polc.png',
  'bookpage': '04-konyvlap.png',
};
for (const [name, file] of Object.entries(shots)) await image(path.join(SHOT, file), name + '.webp', 1280, { quality: 78 });
const phoneShots = { 'p-camera': '21-telefon-kamera.png', 'p-shelf': '23-telefon-polc-alsomenu.png', 'p-home': '20-telefon-kezdokepernyo.png', 'p-stats': '26b-telefon-statisztika.png' };
for (const [name, file] of Object.entries(phoneShots)) await image(path.join(SHOT, file), name + '.webp', 390, { quality: 80 });

/* ------------------------------------------------------------------ 4. valódi polcok a „probléma” diához (a minta-polcvideókból) */
const stills = [['20260912_212925.mp4', 4.2, 'shelf-a'], ['20260912_213028.mp4', 3.0, 'shelf-b'], ['20260912_213052.mp4', 3.4, 'shelf-c']];
for (const [file, at, name] of stills) {
  const tmp = path.join(OUT, '_tmp.png');
  ff(['-ss', String(at), '-i', path.join(SAMPLE, file), '-frames:v', '1', tmp]);
  await image(tmp, name + '.webp', 760, { quality: 74 });
}
if (existsSync(path.join(OUT, '_tmp.png'))) execFileSync(process.platform === 'win32' ? 'cmd' : 'rm', process.platform === 'win32' ? ['/c', 'del', path.join(OUT, '_tmp.png')] : [path.join(OUT, '_tmp.png')]);
console.log('kész');
