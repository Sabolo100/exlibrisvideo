#!/usr/bin/env node
/**
 * Ex Libris Video — befektetői és szponzori prezentáció → public/deck/index.html (az oldal a /deck címen él).
 *
 *   node deck/build.mjs
 *
 * 18 dia 1280×720-as vásznon (a böngésző arányosan skálázza), jobbra-balra léptethető, áttekintő nézettel (O),
 * részletes ablakokkal. A mozgás kódból készül, nem PPT-átmenet: a címlapon a valódi polcvideóra a valódi
 * felismerési adatokból rajzolódnak a dobozok és a gerincfotók a polcra érkeznek; a képernyőfelvételek mellett
 * a lépéslista a videó idejéhez kötve halad. Az alapállapot mindig a végleges kép (nyomtatás, áttekintő nézet).
 * A diák listája és a használat: deck/README.md. A /deck oldalra az app nem linkel (csak a címmel nyitható meg).
 */
import crypto from 'node:crypto';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

export const DECK_VERSION = '1.0.0';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = path.join(ROOT, 'public/deck');
const APP_VERSION = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// kiadások száma a változásnaplóból (## 1.x.y – dátum)
const RELEASES = (readFileSync(path.join(ROOT, 'CHANGELOG.md'), 'utf8').match(/^## \d+\.\d+\.\d+ /gm) || []).length;
const PROMO = { src: '/promo/exlibris-promo-hu-v1.2.0-720p.mp4', poster: '/promo/exlibris-promo-poster-v1.2.0.jpg' };
const MAIL = 'hello@exlibrisvideo.hu';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const M = (f) => `/deck/media/${f}`;

/* ------------------------------------------------------------------ ikonok (vonalas, 24×24) */
const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"${extra}>${d}</svg>`;
const IC = {
  prev: svg('<path d="m15 18-6-6 6-6"/>'),
  next: svg('<path d="m9 18 6-6-6-6"/>'),
  grid: svg('<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>'),
  expand: svg('<path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>'),
  play: svg('<path d="M7 4.5v15l12-7.5Z" fill="currentColor" stroke="none"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>'),
  x: svg('<path d="M18 6 6 18M6 6l12 12"/>'),
  mail: svg('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>'),
  out: svg('<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>'),
  eye: svg('<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>'),
  spine: svg('<rect x="5" y="4" width="5" height="16" rx="1"/><rect x="11.5" y="6" width="4" height="14" rx="1"/><path d="m17 7.5 3.2.9-3.4 11.8-3-.9"/>'),
  copy: svg('<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'),
  shield: svg('<path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z"/><path d="m9 12 2.2 2.2L15.5 10"/>'),
  eu: svg('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.6 2.6 3.8 5.6 3.8 9s-1.2 6.4-3.8 9c-2.6-2.6-3.8-5.6-3.8-9S9.4 5.6 12 3Z"/>'),
  trash: svg('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  key: svg('<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3M14 9l2 2"/>'),
  user: svg('<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>'),
  q: svg('<circle cx="12" cy="12" r="9"/><path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.8-2.5 2.3-2.5 3.8M12 17.2v.1"/>'),
  copyBook: svg('<rect x="4" y="4" width="10" height="16" rx="1.5"/><path d="M14 7h4.5a1.5 1.5 0 0 1 1.5 1.5V19a1.5 1.5 0 0 1-1.5 1.5H10"/>'),
  // szegmens-ikonok (a rajzolódó vonalakhoz pathLength=1)
  home: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M5 18 20 6l15 12"/><path pathLength="1" d="M9 15v19h22V15"/><rect pathLength="1" x="14" y="22" width="3" height="12"/><rect pathLength="1" x="18.5" y="20" width="3" height="14"/><rect pathLength="1" x="23" y="23" width="3" height="11"/></svg>',
  shop: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M5 14h30l-2-7H7Z"/><path pathLength="1" d="M7 14v20h26V14"/><path pathLength="1" d="M12 34V22h7v12"/><rect pathLength="1" x="23" y="21" width="6" height="6"/></svg>',
  lib: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M5 12 20 5l15 7"/><path pathLength="1" d="M8 15v15M15 15v15M25 15v15M32 15v15"/><path pathLength="1" d="M5 34h30"/></svg>',
  box: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M5 13 20 6l15 7v15l-15 7-15-7Z"/><path pathLength="1" d="m5 13 15 7 15-7M20 20v15"/><path pathLength="1" d="m12.5 9.5 15 7"/></svg>',
  pub: '<svg viewBox="0 0 40 40" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path pathLength="1" d="M20 10c-4-3-9-3-14-2v24c5-1 10-1 14 2 4-3 9-3 14-2V8c-5-1-10-1-14 2Z"/><path pathLength="1" d="M20 10v24"/><path pathLength="1" d="M25 16l2.5 2.5L32 14"/></svg>',
};
const MARK = `<svg viewBox="0 0 32 36" aria-hidden="true"><path d="M6.5 1.5h19a5 5 0 0 0 5 5v23a5 5 0 0 0-5 5h-19a5 5 0 0 0-5-5v-23a5 5 0 0 0 5-5Z" fill="#1f4d3a"/><path d="M8 4h16a4.5 4.5 0 0 0 4 4v20a4.5 4.5 0 0 0-4 4H8a4.5 4.5 0 0 0-4-4V8a4.5 4.5 0 0 0 4-4Z" fill="none" stroke="#dcb068" stroke-width="0.9" opacity="0.9"/><rect x="8.6" y="12.2" width="4" height="14.8" rx="0.6" fill="#fbf6ec" opacity="0.92"/><rect x="13.6" y="9" width="5.6" height="18" rx="0.7" fill="#fbf6ec"/><rect x="13.6" y="10.8" width="5.6" height="1" fill="#dcb068"/><rect x="13.6" y="24.2" width="5.6" height="1" fill="#dcb068"/><path d="M15.3 15.4v5.2l4-2.6Z" transform="translate(-0.4 0)" fill="#1f4d3a"/><rect x="21.2" y="13.2" width="3.6" height="14.4" rx="0.6" fill="#fbf6ec" opacity="0.8" transform="rotate(9 23 27.4)"/><rect x="6.8" y="27.2" width="18.4" height="1.5" rx="0.5" fill="#dcb068"/></svg>`;
const wordmark = (small = 'by DarwinAI') => `<span class="cv-mark">${MARK}<span><b>Ex Libris <em>Video</em></b><small>${esc(small)}</small></span></span>`;

/** A promóvideó díszítő gerincsora: determinisztikus (seed), barna-arany-zöld árnyalatok. */
function spineRow(seed = 21, count = 90) {
  let s = seed;
  const rnd = () => ((s = (s * 9301 + 49297) % 233280) / 233280);
  const cols = ['#7c5534', '#a87a2e', '#dcb068', '#1f4d3a', '#86c0a1', '#7a2e3a', '#e2d5c0', '#54341d'];
  let x = 0, out = '';
  for (let i = 0; i < count && x < 1300; i++) {
    const w = 8 + Math.round(rnd() * 16), h = 50 + Math.round(rnd() * 70);
    out += `<rect x="${x}" y="${120 - h}" width="${w}" height="${h}" rx="1.5" fill="${cols[Math.floor(rnd() * cols.length)]}"/>`;
    x += w + 2;
  }
  return `<div class="s-deco" aria-hidden="true"><svg viewBox="0 0 1300 120" preserveAspectRatio="none">${out}</svg></div>`;
}

/* ------------------------------------------------------------------ közös építőelemek */
const kick = (text, d = 0) => `<p class="s-k rv" style="--d:${d}">${esc(text)}</p>`;
const h2 = (html, d = 1, cls = '') => `<h2 class="s-h2 ${cls} rv" style="--d:${d}">${html}</h2>`;
const chips = (arr, d) => `<ul class="s-chips rv" style="--d:${d}">${arr.map((x) => `<li>${x}</li>`).join('')}</ul>`;
const more = (id, label = 'Részletek') => `<button type="button" class="s-btn" data-open="${id}" aria-haspopup="dialog"><span>${esc(label)}</span>${IC.plus}</button>`;
const playPromo = (label = 'Promóvideó · 2 perc') => `<button type="button" class="s-btn s-btn--gold" data-vid="${PROMO.src}" data-vposter="${PROMO.poster}" data-vtitle="Ex Libris Video — promóvideó">${IC.play}<span>${esc(label)}</span></button>`;
const vid = (id, file, poster, { loop = true } = {}) => `<video id="${id}" src="${M(file)}" poster="${M(poster)}" muted playsinline preload="metadata" data-auto${loop ? ' loop' : ''} aria-label="Képernyőfelvétel az alkalmazásból"></video>`;
const phone = (inner, cls = '', island = false) => `<div class="ph ${cls}"><div class="ph__scr">${inner}</div>${island ? '<i class="ph__isl"></i>' : ''}</div>`;
const browser = (inner, { url = 'exlibrisvideo.hu', cls = '' } = {}) => `<div class="br"><div class="br__bar"><i></i><i></i><i></i><span>${esc(url)}</span></div><div class="br__scr ${cls}">${inner}</div></div>`;
/** Videóhoz kötött lépéslista: [kezdő másodperc, cím, egy sor] */
const steps = (forId, items, d = 2, cls = '') => `<ol class="sy ${cls}" data-for="${forId}">${items.map(([t, b, e], i) => `<li class="rv" style="--d:${d + i}" data-t="${t}"><span class="sy__n">${String(i + 1).padStart(2, '0')}</span><div><b>${esc(b)}</b>${e ? `<em>${esc(e)}</em>` : ''}</div><i class="sy__bar"></i></li>`).join('')}</ol>`;

/* ------------------------------------------------------------------ adatok: a valódi felismerés a minta-polcvideóból */
const TRK = JSON.parse(readFileSync(path.join(PUB, 'media/shelf-tracks.json'), 'utf8'));
const spineW = {};
for (const b of TRK.books) spineW[b.id] = (await sharp(path.join(PUB, 'media/spines', b.id + '.webp')).metadata()).width;
const sumW300 = TRK.books.reduce((a, b) => a + spineW[b.id], 0);
const SHELF_H = Math.min(118, Math.floor(((760 - 24 - 2 * TRK.books.length) * 300) / sumW300));
// nyolc jól olvasható gerinc; a százalék a valódi felismerés legjobb megbízhatósága (shelf-tracks.json)
const READ = ['e467bd9c', '19db8dcf', '42985636', '5b721984', 'a9217dd9', 'ff39f65c', '0f649913', '63d0b111'].map((id) => {
  const b = TRK.books.find((x) => x.id === id);
  return [id, b.author, b.title, Math.round(b.c * 100)];
});

/* ================================================================== a diák */
const slides = [];
const add = (id, title, cls, inner, deco = false) => slides.push({ id, title, cls, inner, deco });

/* ------------------------------------------------------------------ 01 — címlap */
add('cover', 'Elég egy videó', 'slide--cover', `
  <div class="cv" data-demo="tracks">
    <div class="cv__copy">
      <div class="rv" style="--d:0">${wordmark()}</div>
      ${kick('Befektetői és szponzori bemutató', 1)}
      <h1 class="s-h1 rv" style="--d:2">Elég egy <em>videó.</em></h1>
      <p class="s-lead rv" style="--d:3">Filmezd le a könyvespolcot — a mesterséges intelligencia elolvassa a gerinceket, és kész a katalógus.</p>
      <div class="cv-chips">${chips(['<b>Élő</b> · exlibrisvideo.hu', 'Telefonon és gépen', 'Magyar és angol felület'], 4)}</div>
      <div class="cv-shelf rv" style="--d:5">
        <div class="cv-shelf__head"><b class="cv-count">${TRK.books.length}</b><span>könyv felismerve<br><em class="cv-of">a polcon lévő ${TRK.onShelf} könyvből</em></span><small>valódi felvétel · valódi felismerés</small></div>
        <div class="cv-row" style="--sh:${SHELF_H}px">${TRK.books.map((b) => `<img src="${M('spines/' + b.id + '.webp')}" alt="" data-b="${b.id}" width="${Math.round((spineW[b.id] * SHELF_H) / 300)}" height="${SHELF_H}">`).join('')}</div>
        <div class="cv-plank"></div>
      </div>
    </div>
    <figure class="cv-phone rv-pop" style="--d:2">
      ${phone(`<video src="${M('shelf.mp4')}" poster="${M('shelf.webp')}" muted playsinline preload="auto" data-auto aria-label="Valódi polcfelvétel a felismerés dobozaival"></video><svg class="cv-boxes" viewBox="0 0 ${TRK.w} ${TRK.h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true"></svg><span class="cv-rec"><i></i><b>00:00</b></span>`, 'ph--916', true)}
      <figcaption class="cv-cap">9,6 mp-es telefonos felvétel</figcaption>
    </figure>
  </div>`);

/* ------------------------------------------------------------------ 02 — a probléma */
const PB = [
  ['shelf-a', 'Mi van meg?', 'A boltban nem tudjuk, megvan-e már. Ami megvan, kétszer is megvesszük.'],
  ['shelf-b', 'Költözés, hagyaték, biztosítás', 'Ilyenkor kell a leltár — kézzel hosszú, unalmas munka.'],
  ['shelf-c', 'Kinél van?', 'Kölcsönadtuk, elfelejtettük. A gyűjtemény nem látszik, nem osztható meg.'],
];
add('problem', 'A probléma', '', `
  ${kick('01 — A probléma')}
  ${h2('Sok könyv. <em>Semmi lista.</em>')}
  <div class="pb">
    ${PB.map(([img, t, p], i) => `
    <article class="pb-p rv" style="--d:${i + 2}">
      <img class="pb-p__g" src="${M(img + '.webp')}" alt="" aria-hidden="true">
      <img class="pb-p__c" src="${M(img + '.webp')}" alt="Valódi könyvespolc a mintafelvételekből" style="--i:${i}">
      <div class="pb-p__b"><span class="pb-p__q">„</span><h3 class="pb-p__t">${esc(t)}</h3><p class="pb-p__p">${esc(p)}</p></div>
    </article>`).join('')}
  </div>`);

/* ------------------------------------------------------------------ 03 — kézzel vs. videóval */
const SLOW = ['Ferrante, Elena — Az új név története', 'Asimov, Isaac — Az Alapítvány barátai', 'Móricz Zsigmond — Rokonok', 'Saylor, Steven — Római vér', 'Nguyen, Viet Thanh — The Committed'];
const FAST = TRK.books.map((b) => (b.author ? `${b.author} — ${b.title}` : b.title));
const finalRows = (arr, max) => arr.slice(-max).map((x, i) => `<li><span>${arr.length - Math.min(max, arr.length) + i + 1}</span><i style="font-style:normal">${esc(x)}</i></li>`).join('');
add('race', 'Kézzel vagy videóval', '', `
  ${kick('01 — A probléma')}
  ${h2('Gépelés helyett <em>egy pásztázás.</em>')}
  <span class="s-tag rc-note rv" style="--d:2">Illusztráció</span>
  <div class="rc" data-demo="race">
    <section class="rc-c rv" style="--d:2">
      <div class="rc-c__h"><b>Kézzel</b><span class="rc-clock" data-clock>00:12</span></div>
      <p class="rc-c__sub">Könyvenként gépelés vagy vonalkód-olvasás — minden könyvet kézbe kell venni.</p>
      <ol class="rc-list" data-race="slow" data-items="${esc(JSON.stringify(SLOW))}">${finalRows(SLOW.slice(0, 4), 6)}</ol>
      <div class="rc-total"><b data-total>4</b><span>könyv begépelve</span></div>
    </section>
    <section class="rc-c rc-c--win rv" style="--d:3">
      <div class="rc-c__h"><b>Ex Libris <em>Video</em></b><span class="rc-clock" data-clock>00:12</span></div>
      <p class="rc-c__sub">10 mp felvétel, a többi a háttérben fut — a feldolgozás néhány perc, közben nincs teendő.</p>
      <div class="rc-strip" aria-hidden="true"><div class="rc-strip__in">${TRK.books.map((b) => `<img src="${M('spines/' + b.id + '.webp')}" alt="">`).join('')}</div><i class="rc-strip__frame"></i></div>
      <ol class="rc-list rc-list--fast" data-race="fast" data-items="${esc(JSON.stringify(FAST))}">${finalRows(FAST, 6)}</ol>
      <div class="rc-total"><b data-total>${FAST.length}</b><span>könyv felismerve ugyanabból a 10 másodpercből</span></div>
    </section>
  </div>`);

/* ------------------------------------------------------------------ 04 — így működik */
const HW = [
  ['Filmezd le', 'Lassan végigpásztázod a polcot a telefonnal — az appban vagy a böngészőben.', 'p-camera.webp', true],
  ['Az AI elolvassa', 'Gerincenként kivágja és elolvassa a könyveket, kiszűri az ismétlődéseket.', 'proc.webp', true],
  ['Kész a katalógus', 'Saját link, kilenc nézet, export — telefonon és gépen.', 'catalogue.webp', false],
];
add('how', 'Így működik', '', `
  ${kick('02 — A megoldás')}
  ${h2('Három lépés, <em>egy</em> mozdulat.')}
  <div class="hw">
    <i class="hw-line"></i><i class="hw-dot"></i>
    <ol class="hw-steps">
      ${HW.map(([t, p, img, ph], i) => `
      <li class="hw-s rv" style="--d:${i + 2};--i:${i}">
        <span class="hw-s__n">${i + 1}</span>
        <h3>${esc(t)}</h3><p>${esc(p)}</p>
        <div class="hw-s__m${ph ? ' hw-s__m--ph' : ''}"><img src="${M(img)}" alt="${esc(t)} — képernyőkép az alkalmazásból"></div>
      </li>`).join('')}
    </ol>
  </div>
  <div class="hw-chips">${chips(['Fiók nélkül is: <b>titkos link</b>', '<b>Google-belépéssel</b> is', 'Több felvétel <b>egy könyvtárba</b>', 'Magyar és angol felület'], 6)}</div>`);

/* ------------------------------------------------------------------ 05 — felvétel */
add('capture', 'Felvétel a telefonnal', '', `
  <div class="vs">
    <div class="vs__copy">
      ${kick('02 — A megoldás · felvétel')}
      ${h2('Felvétel: egy <em>lassú pásztázás.</em>')}
      ${steps('v-cam', [
        [0, 'Polc felvétele', 'Egy koppintás a kezdőképernyőn — az app maga nyitja a kamerát.'],
        [2.2, 'Rövid útmutató', '30–40 cm-re a gerincektől, lassan, polcsoronként.'],
        [11.4, 'Felvétel', 'Egy egyenletes pásztázás a polc hosszában.'],
        [16.6, 'Kész — vagy még egy polc', 'Annyi felvétel, ahány polc; mind egy könyvtárba kerül.'],
      ])}
      <p class="s-note rv" style="--d:7">Galériából is feltölthető videó vagy fotó; egyetlen könyv borítójáról is felismer (vonalkód).</p>
    </div>
    <div class="vs__media rv-pop" style="--d:2">${phone(vid('v-cam', 'cam.mp4', 'cam.webp'))}</div>
  </div>`);

/* ------------------------------------------------------------------ 06 — feldolgozás */
add('process', 'Feldolgozás', '', `
  <div class="vs vs--rev">
    <div class="vs__media rv-pop" style="--d:2">${phone(vid('v-proc', 'proc.mp4', 'proc.webp'))}</div>
    <div class="vs__copy">
      ${kick('02 — A megoldás · feldolgozás')}
      ${h2('Már feldolgozás közben <em>megtelik a polc.</em>')}
      ${steps('v-proc', [
        [0, 'A teljes könyvtár', 'Fent az összes felvétel könyvei együtt — a régiek is.'],
        [3.5, 'Gerincek olvasása', 'Kockáról kockára, élő százalékkal; a háttérben fut.'],
        [8, 'Így telik meg a polcod', 'A felismert könyvek azonnal megjelennek a polcon.'],
        [22.6, 'Böngészhető katalógus', 'Kész: polc, borítók, szerzők — és e-mail, ha kérted.'],
      ])}
    </div>
  </div>`);

/* ------------------------------------------------------------------ 07 — gerincenként olvas */
add('reading', 'Gerincenként olvas', '', `
  ${kick('03 — A technológia')}
  ${h2('Gerincenként olvas, <em>nem találgat.</em>', 1, 's-h2--wide')}
  <div class="rd">
    <div class="rd-pile rv-pop" style="--d:2">
      <i class="rd-scan" aria-hidden="true"></i>
      ${READ.map(([id, a, t, c], i) => `
      <div class="rd-row" style="--i:${i}">
        <span class="rd-sp" style="--i:${i}"><img src="${M('spines/read-' + id + '.webp')}" alt="Kivágott gerincfotó: ${esc(t)}"></span>
        <span class="rd-lbl" style="--i:${i}"><b>${esc(t)}</b><span>${esc(a)}</span><span class="rd-conf" style="--i:${i}"><i style="--c:${c}%"></i><small>${c} %</small></span></span>
      </div>`).join('')}
    </div>
    <div class="rd__side">
      <ol class="rd-flow">
        ${[
          ['Éles kockák', 'Másodpercenként ~3 kulcskocka, a bemozdultak kiesnek.'],
          ['Polcsávok, gerinchatárok', 'Geometria: a gerincek egyenként, dőlésszöggel.'],
          ['Követés', 'A kamera mozgásából tudja, melyik gerinc melyik.'],
          ['Olvasás', 'Az AI a kivágott gerincet mindkét irányba fordítva kapja.'],
          ['Összefésülés', 'Ismétlődés-szűrés, bizonytalannál második olvasás.'],
          ['Gazdagítás', 'Borító, téma, év, leírás — Open Library + AI.'],
        ].map(([b, e], i) => `<li class="rv" style="--d:${i + 2};--i:${i}"><span>${i + 1}</span><div><b>${esc(b)}</b><em>${esc(e)}</em></div></li>`).join('')}
      </ol>
      <div class="s-acts rv" style="--d:9">${more('pipeline')}</div>
    </div>
  </div>`);

/* ------------------------------------------------------------------ 08 — mérve, nem becsülve */
const MS = [
  ['Pontosság', 'a talált tételekből ennyi valódi könyv', 54.4, 77.7],
  ['Pontos cím', 'a megtalált könyvek címe betűre egyezik', 88.3, 93.5],
  ['Megtalálás', 'a jól látható gerincekből ennyit talál meg', 79.0, 81.5],
];
const hu1 = (x) => x.toFixed(1).replace('.', ',');
add('accuracy', 'Mérve, nem becsülve', '', `
  ${kick('03 — A technológia · mérés')}
  ${h2('Mérve, <em>nem becsülve.</em>')}
  <div class="ms">
    <div class="ms-rows">
      ${MS.map(([b, s, a, c], i) => `
      <div class="ms-r rv" style="--d:${i + 2}">
        <div class="ms-r__h"><div><b>${esc(b)}</b><small>${esc(s)}</small></div><div class="ms-r__v"><s>${hu1(a)}</s><span data-count="${c}" data-from="${a}" data-dec="1" data-suffix=" %" data-delay="${(1.2 + i * 0.25).toFixed(2)}">${hu1(c)} %</span></div></div>
        <div class="ms-bars"><i class="ms-bar ms-bar--a" style="--w:${a}%;--i:${i}"></i><i class="ms-bar ms-bar--b" style="--w:${c}%;--i:${i}"></i></div>
      </div>`).join('')}
      <div class="ms-r rv" style="--d:5">
        <div class="ms-r__h"><div><b>Feldolgozási idő</b><small>az öt mintafelvételre együtt</small></div><div class="ms-r__v"><s>5:15</s><span>2:50</span></div></div>
      </div>
      <p class="ms-key rv" style="--d:6"><span><i></i>korábbi: egész képkockák olvasása</span><span><i class="b"></i>most: gerincenkénti felismerés</span></p>
    </div>
    <div class="ms__side">
      ${[
        [IC.q, 'Bizonytalan? Rákérdez.', 'A gyenge olvasatok az „Átnézés” nézetbe kerülnek, egy kattintással javíthatók.'],
        [IC.spine, 'Olvashatatlan gerinc', 'Fotóval a tulajdonos elé kerül — nem tűnik el, nem talál ki címet.'],
        [IC.copyBook, 'Ismétlődés', 'Ugyanaz a polc kétszer? Összefésüli; egyedül álló egyezésnél megkérdezi.'],
      ].map(([ic, b, e], i) => `<div class="ms-safe rv" style="--d:${i + 3}">${ic}<div><b>${esc(b)}</b><em>${esc(e)}</em></div></div>`).join('')}
      <p class="s-note rv" style="--d:7">Saját mérés: 5 mintafelvétel, 158 kézzel ellenőrzött könyv, deepseek-flash modellel (2026. 09. 16.).</p>
      <div class="s-acts rv" style="--d:8;margin-top:4px">${more('accuracy', 'A mérésről')}</div>
    </div>
  </div>`);

/* ------------------------------------------------------------------ 09 — kilenc nézet */
const VIEWS = [['v-shelf', 'Polc'], ['v-covers', 'Borítófal'], ['v-table', 'Táblázat'], ['v-authors', 'Szerzők'], ['v-topics', 'Témák'], ['v-timeline', 'Idővonal'], ['v-stats', 'Statisztika']];
add('views', 'Kilenc nézet', '', `
  <div class="vc">
    <div class="vc__copy">
      ${kick('04 — A katalógus')}
      ${h2('Kilenc nézet, <em>egy</em> könyvtár.')}
      <p class="s-lead s-lead--sm rv" style="--d:2">Keresés ékezet nélkül is, szűrők (téma, olvasottság, kölcsönadva, címke), sötét téma.</p>
      <ul class="vc-pills rv" style="--d:3">${VIEWS.map(([, n], k) => `<li style="--k:${k}"><i></i>${esc(n)}</li>`).join('')}<li class="is-x"><i></i>Képkockák</li><li class="is-x"><i></i>Átnézés</li></ul>
    </div>
    <div class="rv-pop" style="--d:2">${browser(`<div class="vc-stack">${VIEWS.map(([f, n], k) => `<img src="${M(f + '.webp')}" alt="${esc(n)} nézet" style="--k:${k}" loading="eager">`).join('')}</div>`)}</div>
  </div>`);

/* ------------------------------------------------------------------ 10 — valódi gerincek + könyvlap */
add('bookpage', 'Valódi gerincek, könyvlap', '', `
  <div class="vw">
    <div class="vw__copy">
      ${kick('04 — A katalógus')}
      ${h2('A saját polcod, <em>valódi gerincekkel.</em>')}
      ${steps('v-desk', [
        [0, 'Rajzolt vagy valódi gerinc', 'Egy kapcsoló: a felvételből kivágott gerincfotók a polcon.'],
        [4.6, 'Rámutatva: cím, szerző, év', 'Böngészés, mint egy igazi polc előtt.'],
        [11.6, 'Könyvlap', 'Borító, leírás, téma, olvasottság, értékelés, kölcsön — és hogyan ismertük fel.'],
      ])}
    </div>
    <div class="vw__media rv-pop" style="--d:2">${browser(vid('v-desk', 'shelfdesk.mp4', 'shelfdesk.webp'), { cls: 'br__scr--v' })}
      <span class="cb" data-cb="v-desk" data-from="0.9" data-to="4.4" style="left:262px;top:96px">„Valódi gerincek” bekapcsolva</span>
      <span class="cb" data-cb="v-desk" data-from="12.2" data-to="16.8" style="left:430px;top:420px">Így ismertük fel: a gerincfotó</span>
    </div>
  </div>`);

/* ------------------------------------------------------------------ 11 — telefonos app */
add('app', 'Telefonon', '', `
  <div class="ap">
    <div class="ap__copy">
      ${kick('04 — A katalógus · telefonon')}
      ${h2('Zsebben <em>a könyvtár.</em>')}
      ${steps('v-lib', [[0, 'Polc'], [0.9, 'Borítók'], [2, 'Szerzők'], [5.8, 'Idővonal'], [9.6, 'Keresés'], [14.6, 'Szűrők'], [20, 'Felvételenként']], 2, 'sy--compact')}
      <div class="s-acts rv" style="--d:9">${chips(['Telepíthető app (PWA)', 'Google-belépés'], 9)}</div>
    </div>
    <div class="rv-pop" style="--d:2">${phone(vid('v-lib', 'lib.mp4', 'lib.webp'))}</div>
    <div class="ap__inst rv" style="--d:4">${phone(vid('v-inst', 'install.mp4', 'install.webp'))}<p><b>Bolt nélkül</b>a kezdőképernyőre telepíthető, teljes képernyőn fut</p></div>
  </div>`);

/* ------------------------------------------------------------------ 12 — megosztás és export */
add('export', 'Megosztás és export', '', `
  <div class="vw">
    <div class="vw__copy">
      ${kick('04 — A katalógus · az adat a tiéd')}
      ${h2('Megosztható, exportálható, <em>a tiéd.</em>')}
      <ul class="ex-fmt">${[['Excel', 'xlsx, minden mezővel'], ['PDF', 'nyomtatható katalógus'], ['CSV', 'bármilyen táblázatba'], ['Goodreads', 'egy kattintással át'], ['JSON', 'fejlesztőknek'], ['E-mail', 'Excellel csatolva']].map(([b, s], i) => `<li class="rv" style="--d:${i + 2}" data-light="v-exp" data-at="9.4"><b>${esc(b)}</b><span>${esc(s)}</span></li>`).join('')}</ul>
      <div class="ex-share">${chips(['Saját rövid link', 'QR-kód', 'PIN-nel zárható', 'Tulajdonosi adatok rejtve'], 8)}</div>
    </div>
    <div class="vw__media rv-pop" style="--d:2">${browser(vid('v-exp', 'export.mp4', 'export.webp'), { cls: 'br__scr--v' })}
      <span class="cb" data-cb="v-exp" data-from="1.6" data-to="5.6" style="left:330px;top:70px">Szűrés témára: Klasszikusok</span>
      <span class="cb" data-cb="v-exp" data-from="9.2" data-to="13" style="left:300px;top:240px">Export: Excel, PDF, CSV, Goodreads, JSON</span>
    </div>
  </div>`);

/* ------------------------------------------------------------------ 13 — felépítés és bizalom */
const AR = {
  nodes: [
    { x: 0, y: 70, w: 196, h: 74, t: 'Telefon · böngésző', s: 'app (PWA) vagy web', i: 0 },
    { x: 246, y: 70, w: 180, h: 74, t: 'Web', s: 'Next.js · React', i: 1 },
    { x: 476, y: 70, w: 180, h: 74, t: 'Feladatsor', s: 'PostgreSQL', i: 2 },
    { x: 706, y: 70, w: 200, h: 74, t: 'Feldolgozó', s: 'ffmpeg · gerincgeometria', i: 3, acc: true },
  ],
};
add('arch', 'Felépítés és adatvédelem', '', `
  ${kick('05 — Üzem és adatvédelem')}
  ${h2('Egyszerű, cserélhető, <em>EU-ban fut.</em>', 1, 's-h2--wide')}
  <div class="ar rv" style="--d:2">
    <svg viewBox="0 0 1152 250" role="img" aria-label="Felépítés: telefon vagy böngésző, web, feladatsor, feldolgozó, AI-szolgáltatók és Open Library">
      <path class="ar-line ar-line--main" d="M196 107H246"/><path class="ar-line ar-line--main" d="M426 107H476"/><path class="ar-line ar-line--main" d="M656 107H706"/>
      <path class="ar-line" d="M906 107C936 107 936 52 966 52"/><path class="ar-line" d="M906 107C936 107 936 162 966 162"/>
      <path class="ar-line" d="M806 144V206H336V144"/>
      ${[1, 2, 3].map((n, i) => `<circle class="ar-pulse" r="4.5" style="offset-path:path('${['M196 107H246', 'M426 107H476', 'M656 107H706'][i]}');--i:${i}"/>`).join('')}
      <circle class="ar-pulse" r="4.5" style="offset-path:path('M806 144V206H336V144');--i:1.5"/>
      ${AR.nodes.slice(0, 4).map((n) => `<g class="ar-node" style="--i:${n.i}"><rect class="ar-tile${n.acc ? ' ar-tile--acc' : ''}" x="${n.x + 1}" y="${n.y}" width="${n.w - 2}" height="${n.h}" rx="10"/><text class="ar-t" x="${n.x + 20}" y="${n.y + 32}">${esc(n.t)}</text><text class="ar-s" x="${n.x + 20}" y="${n.y + 54}">${esc(n.s)}</text></g>`).join('')}
      <g class="ar-node" style="--i:4"><rect class="ar-tile ar-tile--acc" x="966" y="18" width="185" height="68" rx="10"/><text class="ar-t" x="984" y="46">AI-szolgáltató</text><text class="ar-s" x="984" y="68">Claude vagy DeepSeek</text></g>
      <g class="ar-node" style="--i:5"><rect class="ar-tile ar-tile--soft" x="966" y="128" width="185" height="68" rx="10"/><text class="ar-t" x="984" y="156">Könyvadat</text><text class="ar-s" x="984" y="178">Open Library · Google Books</text></g>
      <text class="ar-s" x="571" y="232" text-anchor="middle">a kész könyvek vissza a katalógusba — élő állapotjelzéssel</text>
    </svg>
  </div>
  <ul class="tr">
    ${[
      [IC.eu, 'EU-ban tárolva', 'Saját szerver Németországban (Hetzner), Docker.'],
      [IC.trash, 'A videó törlődik', 'Feldolgozás után az eredeti felvétel törlődik.'],
      [IC.key, 'Jelszó nélkül', 'Google-belépés vagy titkos tulajdonosi link.'],
      [IC.shield, 'Cserélhető AI', 'Szolgáltatónként egy modul — nincs bezártság.'],
    ].map(([ic, b, e], i) => `<li class="rv" style="--d:${i + 4}">${ic}<div><b>${esc(b)}</b><em>${esc(e)}</em></div></li>`).join('')}
  </ul>
  <div class="s-acts rv" style="--d:8;margin-top:14px">${more('tech', 'Technológia és adatvédelem')}</div>`);

/* ------------------------------------------------------------------ 14 — 5 hét, 20 kiadás */
const TL = [
  ['09. 12.', 'Indulás', 'Specifikáció, mintafelvételek, kézzel ellenőrzött könyvlista.'],
  ['09. 16.', 'Élesben', 'exlibrisvideo.hu, HTTPS, telefonos app-mód, kamera.'],
  ['09. 17.', 'Gerincenkénti felismerés', 'Pontosság 54 → 78 %; v1.0.'],
  ['10. 10.', 'Fiók és fotó', 'Google-belépés, egy könyv borítóról, címkék.'],
  ['10. 18.', 'Telepíthető app', 'PWA, offline oldal, új telefonos menü.'],
  ['10. 19.', 'Promóvideó', 'Magyarul és angolul — v1.15.'],
  ['Következő', 'Mérés Claude‑dal', 'Javaslat: a pontosabb (drágább) modell mérése.'],
  ['Következő', 'Partneri integrációk', 'Javaslat: könyvesbolti, kiadói kapcsolatok.'],
];
let tlSeed = 7;
const tlRnd = () => ((tlSeed = (tlSeed * 9301 + 49297) % 233280) / 233280);
const tlCols = ['#7c5534', '#a87a2e', '#dcb068', '#1f4d3a', '#86c0a1', '#7a2e3a', '#e2d5c0', '#54341d'];
add('timeline', `Öt hét, ${RELEASES} kiadás`, '', `
  ${kick('06 — Ahol most tart')}
  ${h2(`Öt hét, <em>${RELEASES} kiadás.</em>`)}
  <div class="tl" style="--n:${TL.length}">
    <div class="tl-odo rv" style="--d:2"><span class="tl-odo__n" style="--to:${RELEASES}">${RELEASES}</span><em>kiadás · v1.0 → v${esc(APP_VERSION.replace(/\.0$/, ''))}</em></div>
    <div class="tl-lane" aria-hidden="true"><div class="tl-fill">${Array.from({ length: 64 }, () => `<i style="--w:${8 + Math.round(tlRnd() * 9)}px;--h:${30 + Math.round(tlRnd() * 26)}px;--c:${tlCols[Math.floor(tlRnd() * tlCols.length)]}"></i>`).join('')}</div></div>
    <i class="tl-now" aria-hidden="true"><span>most</span></i><span class="tl-next-cap" aria-hidden="true">javaslat</span>
    <ol class="tl-stops">
      ${TL.map(([w, t, p], i) => `<li class="tl-s${w === 'Következő' ? ' tl-s--next' : ''}" style="--i:${i}"><span class="tl-s__w">${esc(w)}</span><span class="tl-s__t">${esc(t)}</span><span class="tl-s__p">${esc(p)}</span></li>`).join('')}
    </ol>
  </div>`);

/* ------------------------------------------------------------------ 15 — kinek ér pénzt */
const SG = [
  [IC.home, 'Magánkönyvtárak, gyűjtők', 'Leltár, kölcsönzés, „mi van meg?” — a mai termék.', 'live', 'Működik'],
  [IC.shop, 'Antikváriumok, könyvesboltok', 'Készletfelvétel polcról, export a webshopba.', 'idea', 'Bővítési irány'],
  [IC.lib, 'Könyvtárak, iskolák', 'Adományok, letétek gyors felvétele, ellenőrzés.', 'idea', 'Bővítési irány'],
  [IC.box, 'Hagyaték, költözés, biztosítás', 'Vagyonleltár percek alatt, fotós bizonyítékkal.', 'idea', 'Bővítési irány'],
  [IC.pub, 'Kiadók, könyvesboltok', 'Ajánló és vásárlási link a saját polc mellett.', 'idea', 'Szponzoráció'],
];
add('segments', 'Kinek ér pénzt', '', `
  ${kick('07 — Piac')}
  ${h2('Kinek ér pénzt <em>egy könyvleltár?</em>', 1, 's-h2--wide')}
  <div class="sg">
    ${SG.map(([ic, t, p, st, lbl], i) => `<article class="sg-t${st === 'live' ? ' sg-t--live' : ''} rv" style="--d:${i + 2}">${ic}<h3>${esc(t)}</h3><p>${esc(p)}</p><span class="s-status s-status--${st}">${esc(lbl)}</span></article>`).join('')}
  </div>
  <p class="s-note sg-note rv" style="--d:8">Ma magánfelhasználóknak, ingyenesen működik. A többi szegmens a meglévő alapokra építhető irány — piaci számok nélkül, mert ezeket még nem mértük.</p>`);

/* ------------------------------------------------------------------ 16 — szponzoráció */
// a könyvlap képernyőképén (1280×800): 1 = a csillagok mellett, 2 = „A könyvről” rész, 3 = a fejléc
const SLOTS = [
  { x: 82, y: 58.2, n: 1, side: 'l', t: 'Megvásárolható: Partner Könyvesbolt →' },
  { x: 82, y: 73.5, n: 2, side: 'l', t: 'Ajánló: a Partner Kiadó ezt javasolja' },
  { x: 37, y: 4, n: 3, side: 'r', t: 'Bemutatja: Szponzor' },
];
add('sponsor', 'Szponzoráció', '', `
  <div class="sp">
    <div class="sp__copy">
      ${kick('08 — Szponzoráció')}
      ${h2('Ott, ahol <em>a könyv él.</em>')}
      <p class="s-lead s-lead--sm rv" style="--d:2">A könyvlap a saját, valódi könyv mellett jelenik meg — reklámzaj nélkül, releváns helyen.</p>
      <ol class="sp-pk">
        ${[
          ['Névadó szponzor', 'Megjelenés a nyitóoldalon, az appban és a promóvideóban.'],
          ['Könyvesbolti partner', 'Vásárlási link a könyvlapon, a hiányzó kötetekhez.'],
          ['Kiadói partner', 'Ajánló a könyvlapon és a „Mit olvassak ma?” helyén.'],
        ].map(([b, e], i) => `<li class="rv" style="--d:${i + 3}"><span>${i + 1}</span><div><b>${esc(b)}</b><em>${esc(e)}</em></div></li>`).join('')}
      </ol>
    </div>
    <div class="sp__media rv-pop" style="--d:2">
      ${browser(`<img src="${M('bookpage.webp')}" alt="Könyvlap az alkalmazásban (Factfulness)">${SLOTS.map((s, i) => `<span class="sp-slot sp-slot--${s.side}" style="--x:${s.x}%;--y:${s.y}%;--i:${i}"><b>${s.n}</b><em>${esc(s.t)}</em></span>`).join('')}`)}
      <span class="s-tag">Koncepció — illusztráció</span>
    </div>
  </div>`);

/* ------------------------------------------------------------------ 17 — kulcsrakészen átvehető */
const AQ = [
  ['Teljes forráskód', 'TypeScript, Next.js 15, React 19 — tiszta, modulokra bontva.'],
  ['Feldolgozó és AI-réteg', 'Gerincgeometria, követés, olvasás; cserélhető AI-szolgáltató.'],
  ['Éles üzem', 'Docker, PostgreSQL, EU-szerver, napi mentés, automatikus telepítés.'],
  ['1061 automata teszt', 'És a teljes műszaki specifikáció (SPEC.md).'],
  ['Domain és márka', 'exlibrisvideo.hu, logó, arculat, kétnyelvű szövegek.'],
  ['Promóanyag', 'Promóvideó magyarul és angolul, képernyőfelvételek, ez a prezentáció.'],
  ['Kétnyelvű, telepíthető app', 'Magyar és angol felület, telefonra telepíthető (PWA).'],
  ['Átadás és betanítás', 'A DarwinAI csapatától — igény szerint továbbfejlesztéssel.'],
];
add('acquire', 'Kulcsrakészen átvehető', '', `
  ${kick('09 — Átvétel')}
  ${h2('A teljes rendszer <em>kulcsrakészen</em> átvehető.', 1, 's-h2--wide')}
  <ul class="aq">
    ${AQ.map(([b, e], i) => `<li class="rv" style="--d:${i + 2}"><svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="12.5"/><path pathLength="1" d="m8.5 14.5 3.6 3.6 7.6-7.8" style="--i:${i}"/></svg><div><b>${esc(b)}</b><em>${esc(e)}</em></div></li>`).join('')}
  </ul>
  <div class="aq-foot rv" style="--d:10">${more('acquire', 'Mit tartalmaz pontosan?')}<span class="s-label">Szponzoráció és teljes átvétel is lehetséges</span></div>`);

/* ------------------------------------------------------------------ 18 — következő lépés */
add('contact', 'Következő lépés', 'slide--cta', `
  <div class="ct">
    <div class="ct__copy">
      ${kick('10 — Következő lépés')}
      ${h2('Írjuk tovább <em>együtt.</em>')}
      <ol class="ct-steps">
        ${[
          ['Élő bemutató', 'Húsz perc: felvétel, feldolgozás, katalógus — az Ön polcával.'],
          ['Betekintés', 'Kód, működés, mérések, költségek — nyitott könyvként.'],
          ['Megállapodás', 'Szponzoráció vagy a teljes rendszer átvétele.'],
        ].map(([b, p], i) => `<li class="rv" style="--d:${i + 2}"><span>${i + 1}</span><div><b>${esc(b)}</b><p>${esc(p)}</p></div></li>`).join('')}
      </ol>
    </div>
    <div class="ct-card rv-pop" style="--d:3">
      ${wordmark('by DarwinAI · darwinai.hu')}
      <p class="ct-card__l">Kérdés, bemutató, ajánlat — egy levél elég.</p>
      <a class="s-cta" href="mailto:${MAIL}?subject=${encodeURIComponent('Ex Libris Video — befektetés / szponzoráció')}">${IC.mail}<span>Írjon nekünk</span></a>
      <p class="ct-mail"><a href="mailto:${MAIL}">${MAIL}</a><button type="button" class="s-copy" data-copy="${MAIL}" data-done="Másolva ✓">Másolás</button></p>
      <div class="ct-links"><a class="s-btn" href="https://www.exlibrisvideo.hu" target="_blank" rel="noopener">${IC.out}<span>Kipróbálom</span></a>${playPromo('Promóvideó')}</div>
    </div>
  </div>`, true);

/* ================================================================== részletes ablakok */
const DLG = {
  pipeline: { k: 'A technológia', t: 'Hogyan lesz a videóból könyvlista?', body: `
    <p>A korábbi, egész képkockákat olvasó megoldásnál egy könyvből több tétel lett (minden kockán kicsit másképp olvasta, a szomszéd gerinc szerzője átcsúszott). Ezért a rendszer ma <b>minden gerincet geometriailag megkeres, kivág és külön olvas el</b>:</p>
    <ul>
      <li><b>Kulcskockák:</b> másodpercenként ~8 kockából a legélesebbet tartja meg (~0,33 mp-enként); gyors pásztázásnál mindkét felét.</li>
      <li><b>Polcsávok és gerinchatárok:</b> függőleges élek sűrűsége és szögpásztázás (±24°), gerincenkénti dőléssel.</li>
      <li><b>Kameramozgás és követés:</b> oszlopprofilok keresztkorrelációja; a gerinchatárok kockáról kockára láncolódnak — egy fizikai gerinc = egy tétel.</li>
      <li><b>Olvasás:</b> a legélesebb 1–2 nézetet kivágja, felállítja, és mindkét irányba fordítva küldi az AI-nak; az olvashatatlan szeleteket összevonva újraolvassa.</li>
      <li><b>Ellenőrzés:</b> a 0,8 alatti biztonságú olvasatot egy második, független olvasás megerősíti vagy elveti; ami bizonytalan marad, átnézésre kerül.</li>
      <li><b>Összefésülés:</b> ugyanaz a polc több felvételen sem duplázódik; a magányos egyezésnél a tulajdonost kérdezi (ugyanaz / másik példány / más könyv).</li>
      <li><b>Gazdagítás:</b> téma, eredeti cím, év, leírás (AI), borító (Open Library, Google Books).</li>
    </ul>` },
  accuracy: { k: 'Mérés', t: 'Hogyan mértünk?', body: `
    <p>Öt mintafelvétel (5 polc, összesen 158 könyv) <b>kézzel ellenőrzött könyvlistájával</b> vetettük össze a felismerést (scripts/eval-recognition.ts). Ugyanaz a modell (deepseek-flash), két módszer:</p>
    <table><thead><tr><th>Mérőszám</th><th>Egész kockák</th><th>Gerincenként</th></tr></thead><tbody>
      <tr><td>Pontosság (a talált tételekből valódi könyv)</td><td>54,4 %</td><td>77,7 %</td></tr>
      <tr><td>Pontos cím (a megtalált könyveknél)</td><td>88,3 %</td><td>93,5 %</td></tr>
      <tr><td>Megtalálás — jól látható gerincek</td><td>79,0 %</td><td>81,5 %</td></tr>
      <tr><td>Megtalálás — összes gerinc</td><td>70,3 %</td><td>68,4 %</td></tr>
      <tr><td>Feldolgozási idő (5 felvétel)</td><td>5 p 15 mp</td><td>2 p 50 mp</td></tr>
    </tbody></table>
    <p>A rendszer a <b>Claude Opus 5</b> modellel is fut (pontosabb, drágább); ezt a változatot még nem mértük — ez a következő lépés. A kevés képpontos, homályos gerincek továbbra is a fő hibaforrás; ezeket a rendszer nem találgatja ki, hanem fotóval a tulajdonos elé teszi.</p>` },
  tech: { k: 'Technológia és adatvédelem', t: 'Mi fut a motorháztető alatt?', body: `
    <h3>Felépítés</h3>
    <ul>
      <li><b>Web:</b> Next.js 15.5 (App Router), React 19, TypeScript, Tailwind CSS 4 — egy kódbázis a webre és a telefonos appra.</li>
      <li><b>Adat:</b> PostgreSQL 16, Drizzle ORM; a feladatsor is az adatbázisban (FOR UPDATE SKIP LOCKED) — nincs külön üzenetsor.</li>
      <li><b>Feldolgozó:</b> külön konténer, ffmpeg + sharp; saját gerincgeometria és -követés.</li>
      <li><b>AI:</b> szolgáltató-modul (Anthropic Claude, DeepSeek, teszthez mock) — modell vagy szolgáltató cseréje a kód többi részét nem érinti.</li>
      <li><b>Üzem:</b> Docker, Coolify, Hetzner (EU); git push = automatikus telepítés; éjszakai adatbázis-mentés.</li>
    </ul>
    <h3>Adatvédelem</h3>
    <ul>
      <li>Az adatok az EU-ban (Németország) vannak; az eredeti videó a feldolgozás után törlődik — a kulcskockák és a gerincfotók maradnak a katalógushoz.</li>
      <li>Nincs jelszó: Google-belépés vagy titkos tulajdonosi link (csak a hash-e tárolt); a katalógus PIN-nel zárható.</li>
      <li>A jegyzet, a kölcsönadás és az e-mail cím csak a tulajdonosnak látszik.</li>
    </ul>` },
  acquire: { k: 'Átvétel', t: 'Mit kap, aki átveszi?', body: `
    <ul>
      <li><b>Forráskód</b> a teljes git-történettel; a <b>SPEC.md</b> specifikáció a rendszer „szerződése”; README és üzemeltetési leírás (COOLIFY.md).</li>
      <li><b>1061 automata teszt</b> (vitest) — a felismerés, az összefésülés, az API és a felület kritikus részeire.</li>
      <li><b>Mérőkészlet:</b> mintafelvételek, kézzel ellenőrzött könyvlista és kiértékelő szkript — minden modellváltás mérhető.</li>
      <li><b>Éles környezet</b> átadása vagy költöztetése (Docker-image, adatbázis, tárhely), domain: exlibrisvideo.hu.</li>
      <li><b>Márka és anyagok:</b> logó, arculat, promóvideó (magyar és angol, 16:9 és 9:16), képernyőfelvételek, ez a prezentáció.</li>
      <li><b>Átadás:</b> betanítás és igény szerint továbbfejlesztés a DarwinAI-tól.</li>
    </ul>
    <p>A pontos feltételeket (ár, licenc, átadási idő) személyes egyeztetésen rögzítjük.</p>` },
};
const dialogs = Object.entries(DLG).map(([id, d]) => `
<dialog class="dlg" id="dlg-${id}" aria-labelledby="dlg-${id}-t">
  <div class="dlg__in"><button type="button" class="dlg__x" data-close aria-label="Bezárás">${IC.x}</button>
    <p class="dlg__k">${esc(d.k)}</p><h2 id="dlg-${id}-t">${esc(d.t)}</h2>${d.body}
  </div>
</dialog>`).join('');

/* ================================================================== összeállítás */
const total = slides.length;
const NUM = (i) => String(i + 1).padStart(2, '0');
const slidesHtml = slides.map((s, i) => `
<!-- ${NUM(i)} ─ ${s.id} -->
<section class="slide${s.cls ? ' ' + s.cls : ''}" id="slide-${s.id}" data-id="${s.id}" data-title="${esc(s.title)}">
  <div class="s-bg" aria-hidden="true"></div>${s.deco ? spineRow(21 + i) : ''}${s.inner}
  <div class="s-foot"><span>Ex Libris Video · befektetői bemutató</span><span class="s-num">${NUM(i)} / ${total}</span></div>
</section>`).join('\n');

// build-azonosító: a prezentáció forrásainak és médiájának tartalmi hash-e
const hash = crypto.createHash('sha256');
for (const f of ['deck/build.mjs', 'public/deck/assets/deck.css', 'public/deck/assets/deck.js', 'public/deck/media/shelf-tracks.json']) hash.update(readFileSync(path.join(ROOT, f)));
for (const f of ['cam.mp4', 'proc.mp4', 'lib.mp4', 'install.mp4', 'shelfdesk.mp4', 'export.mp4', 'shelf.mp4']) hash.update(String(statSync(path.join(PUB, 'media', f)).size));
const BUILD = hash.digest('hex').slice(0, 7);
const VER = `Prezentáció v${DECK_VERSION} · ${BUILD} · app v${APP_VERSION}`;
const q = `?v=${BUILD}`;

const html = `<!DOCTYPE html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ex Libris Video — befektetői bemutató</title>
<meta name="description" content="Ex Libris Video: könyvespolc-videóból könyvkatalógus. Befektetői és szponzori bemutató.">
<meta name="robots" content="noindex, nofollow">
<meta name="version" content="${esc(VER)}">
<meta name="theme-color" content="#14100c">
<link rel="icon" href="/icon.png">
<link rel="preload" href="/deck/assets/fonts/fraunces-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/deck/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/deck/assets/deck.css${q}">
</head>
<body class="deck-body">

<div class="deck-topbar">
  <a class="deck-brand" href="https://www.exlibrisvideo.hu" target="_blank" rel="noopener" title="exlibrisvideo.hu (új lapon)">${MARK}<span>Ex Libris <em>Video</em></span></a>
  <div class="deck-topbar__title" id="deckTitle"></div>
  <div class="deck-topbar__actions">
    <button type="button" class="deck-btn" id="ovBtn">${IC.grid}<span>Áttekintés</span></button>
    <button type="button" class="deck-btn" id="fsBtn">${IC.expand}<span>Teljes képernyő</span></button>
    <a class="deck-btn deck-btn--accent" href="https://www.exlibrisvideo.hu" target="_blank" rel="noopener"><span>Kipróbálom</span>${IC.out}</a>
  </div>
</div>
<div class="deck-progress"><div class="deck-progress__bar" id="deckBar"></div></div>

<main class="deck" id="deck">
  <button type="button" class="deck-edge deck-edge--left" id="edgePrev" aria-label="Előző dia"></button>
  <button type="button" class="deck-edge deck-edge--right" id="edgeNext" aria-label="Következő dia"></button>
  <div class="stage" id="stage">
${slidesHtml}
  </div>
</main>

<div class="deck-nav">
  <span class="deck-ver">${esc(VER)}</span>
  <button type="button" class="deck-arrow" id="prevBtn" aria-label="Előző dia">${IC.prev}</button>
  <div class="deck-count"><b id="curNum">1</b> / <span id="totNum">${total}</span></div>
  <button type="button" class="deck-arrow" id="nextBtn" aria-label="Következő dia">${IC.next}</button>
  <div class="deck-hint">← → lapozás · O áttekintés · F teljes képernyő</div>
</div>

<div class="overview" id="overview" role="dialog" aria-modal="true" aria-label="Az összes dia">
  <div class="overview__head"><span class="deck-topbar__title">Az összes dia · ${esc(VER)}</span><button type="button" class="deck-btn" id="ovClose">Vissza a diához</button></div>
  <div class="overview__grid" id="ovGrid"></div>
</div>

<div class="gate" id="gate">
  <div class="gate__bg" aria-hidden="true">${spineRow(9)}</div>
  <div class="gate__box">
    ${wordmark()}
    <p class="s-k" style="margin-top:18px">Befektetői és szponzori bemutató</p>
    <h1 class="gate__t">Elég egy <em>videó.</em></h1>
    <div class="gate__btns">
      <button type="button" class="gate__btn gate__btn--gold" id="gateFull">${IC.play} Indítás teljes képernyőn</button>
      <button type="button" class="gate__btn" id="gateWin">Indítás ablakban</button>
    </div>
    <p class="gate__hint">← → lapozás · O áttekintés · F teljes képernyő · B sötét képernyő · Enter = indítás</p>
    <p class="gate__ver">${esc(VER)}</p>
  </div>
</div>

<dialog class="deck-vid" id="vdlg" aria-label="Videó">
  <div class="deck-vid__box">
    <div class="deck-vid__bar"><span id="vtitle"></span><div><button type="button" class="deck-btn" id="vclose">Bezárás (Esc)</button></div></div>
    <div class="deck-vid__frame"><video id="vplayer" controls playsinline preload="none"></video></div>
  </div>
</dialog>
${dialogs}

<script type="application/json" id="trk">${JSON.stringify(TRK)}</script>
<script src="/deck/assets/deck.js${q}"></script>
</body>
</html>
`;
writeFileSync(path.join(PUB, 'index.html'), html);
console.log(`public/deck/index.html — ${total} dia, ${VER}, ${Math.round(html.length / 1024)} KB`);
