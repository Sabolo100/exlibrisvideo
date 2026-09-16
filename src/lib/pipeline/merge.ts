/**
 * Merge (SPEC §4.4): clusters the spine observations of one video into books, matches them against
 * the books already in the collection and writes the result.
 *
 * - `clusterObservations()` is the PURE core (no DB, no I/O) – also used by scripts that evaluate
 *   recognition quality.
 * - `mergeVideoDetections(videoId)` loads the unassigned detections of a video, runs the core,
 *   optionally asks the text provider about near-duplicates and persists everything in one transaction.
 *
 * Owner: merge-enrich.
 */
import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import { db, type DB } from '@/db';
import { books, collections, detections, frames, videos, type BookRow, type NewBookRow } from '@/db/schema';
import { env } from '@/lib/env';
import type { BBox } from '@/lib/types';
import {
  authorSortKey,
  authorsCompatible,
  foldForCompare,
  levenshteinRatio,
  nameCase,
  normalizeTitle,
  sentenceCase,
  titleContainment,
  titleNumbers,
  titleSimilarityNormalized,
  titleSortKey,
} from './text';

/* ================================================================== */
/* Pure core                                                           */
/* ================================================================== */

export interface MergeObservation {
  /** unique id of the observation (detection id in the DB wrapper) */
  key: string;
  /** order of the frame inside the video (frames.idx) */
  frameOrder: number;
  /** left→right order of the spine inside its frame */
  orderInFrame: number;
  author: string | null;
  title: string;
  canonicalAuthor: string | null;
  canonicalTitle: string | null;
  publisher: string | null;
  confidence: number;
  hasBbox: boolean;
}

export interface ExistingBookRef {
  id: string;
  author: string | null;
  title: string;
  spineAuthor: string | null;
  spineTitle: string | null;
  /**
   * books.shelf_position (optional). Used for the neighbour check: a cluster only matches an existing
   * book when the shelf context agrees (see clusterObservations). Without positions the array order is
   * taken as shelf order.
   */
  shelfPosition?: number | null;
}

export interface MergeCluster {
  /** observation keys in frame order */
  observationKeys: string[];
  bestObservationKey: string;
  /** existing book of the collection this cluster is the same book as, or null (new book) */
  matchedBookId: string | null;
  author: string | null;
  title: string;
  spineAuthor: string | null;
  spineTitle: string | null;
  publisher: string | null;
  confidence: number;
  needsReview: boolean;
  firstFrameOrder: number;
  /** indices (into the returned array) of clusters that are suspicious near-duplicates of this one */
  ambiguousWith: number[];
}

export interface ClusterOptions {
  /** observation key pairs that must end up in the same cluster (e.g. confirmed by the LLM duplicate judge) */
  extraLinks?: ReadonlyArray<readonly [string, string]>;
}

/** title similarity for "same book" (SPEC §4.4) */
export const SAME_TITLE_THRESHOLD = 0.85;
/** lower bound of the suspicious near-duplicate band */
export const NEAR_DUPLICATE_THRESHOLD = 0.6;
/** minimal title similarity for two spines to be aligned between neighbouring frames */
const ALIGN_THRESHOLD = 0.5;
/** each frame is aligned with this many previous frames */
const ALIGN_WINDOW = 2;
/** a partial title reading must cover at least this share of the full title to merge positionally */
const MIN_PARTIAL_COVERAGE = 0.4;
/** existing-book matching: neighbouring clusters (±) that may confirm the shelf context */
const NEIGHBOUR_CLUSTERS = 3;
/** existing-book matching: max distance of the confirming existing books on their shelf */
const NEIGHBOUR_BOOKS = 4;
/** existing-book matching: clusters / books this close to the edge of their video may continue each other */
const EDGE_SPAN = 1;
/** phantom twin: the twin must also be seen in this many other frames without the phantom */
const PHANTOM_MIN_OTHER_FRAMES = 2;
/** phantom twin: title similarity to its twin */
const PHANTOM_TITLE_THRESHOLD = 0.9;
/** phantom twin whose author belongs to a neighbouring spine: title similarity to its twin */
const PHANTOM_BLED_TITLE_THRESHOLD = 0.95;

interface Item {
  idx: number;
  obs: MergeObservation;
  conf: number;
  vframe: number;
  rank: number;
  /** normalised title readings (raw + canonical), distinct */
  titles: string[];
  rawTitleNorm: string;
  canonTitleNorm: string | null;
  /** raw + canonical author readings, non-empty */
  authors: string[];
  /** volume numbers key ("" when none) */
  numbers: string;
  /** the author of this reading bled in from a neighbouring spine: ignored for display / voting */
  ignoreAuthor: boolean;
  /** a duplicate listing of a spine inside one frame (joined its twin, not used for positions) */
  phantom: boolean;
}

const authorOf = (it: Item): string | null => (it.ignoreAuthor ? null : cleanStr(it.obs.author));
const canonicalAuthorOf = (it: Item): string | null => (it.ignoreAuthor ? null : cleanStr(it.obs.canonicalAuthor));

type EdgeKind = 3 | 2 | 1 | 0;

interface Edge {
  a: number;
  b: number;
  weight: number;
  kind: EdgeKind;
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const orderOf = (it: Item) => (Number.isFinite(it.obs.orderInFrame) ? it.obs.orderInFrame : it.rank);

function cleanStr(s: string | null | undefined): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t : null;
}

function numbersKey(title: string | null): string {
  const set = titleNumbers(title);
  return [...set].sort((a, b) => a - b).join(',');
}

function cmpStr(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/* ---------------------------- trigram blocking ---------------------------- */

function trigramsOf(norm: string): string[] {
  const out = new Set<string>();
  for (const tok of norm.split(' ')) {
    if (!tok) continue;
    const padded = ` ${tok} `;
    for (let i = 0; i + 3 <= padded.length; i++) out.add(padded.slice(i, i + 3));
  }
  return [...out];
}

class TrigramIndex {
  private readonly postings = new Map<string, number[]>();
  private readonly sizes: number[] = [];

  add(id: number, norm: string): void {
    const grams = trigramsOf(norm);
    this.sizes[id] = grams.length;
    for (const g of grams) {
      let list = this.postings.get(g);
      if (!list) this.postings.set(g, (list = []));
      list.push(id);
    }
  }

  /** ids sharing at least `ratio` of the smaller trigram set with `norm` (ascending) */
  candidates(norm: string, ratio: number): number[] {
    const grams = trigramsOf(norm);
    const counts = new Map<number, number>();
    for (const g of grams) {
      const list = this.postings.get(g);
      if (!list) continue;
      for (const id of list) counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    const out: number[] = [];
    for (const [id, c] of counts) {
      const need = Math.max(1, Math.ceil(ratio * Math.min(grams.length, this.sizes[id] ?? 0)));
      if (c >= need) out.push(id);
    }
    return out.sort((a, b) => a - b);
  }
}

/* ---------------------------- similarity caches ---------------------------- */

/** order-independent cache key (U+0001 never occurs in cleaned text) */
const pairKey = (a: string, b: string) => (a < b ? a + '\u0001' + b : b + '\u0001' + a);

class SimCache {
  private readonly titles = new Map<string, number>();
  private readonly contained = new Map<string, number>();
  private readonly authors = new Map<string, boolean>();

  title(a: string, b: string): number {
    if (a === b) return a ? 1 : 0;
    const k = pairKey(a, b);
    let v = this.titles.get(k);
    if (v === undefined) {
      v = titleSimilarityNormalized(a, b);
      this.titles.set(k, v);
    }
    return v;
  }

  /** share of the longer title covered by the shorter one when contained, else 0 */
  coverage(a: string, b: string): number {
    if (a === b) return a ? 1 : 0;
    const k = pairKey(a, b);
    let v = this.contained.get(k);
    if (v === undefined) {
      v = titleContainment(a, b);
      this.contained.set(k, v);
    }
    return v;
  }

  contains(a: string, b: string): boolean {
    return this.coverage(a, b) > 0;
  }

  /** a partial reading substantial enough to be trusted positionally */
  partial(a: string, b: string): boolean {
    return this.coverage(a, b) >= MIN_PARTIAL_COVERAGE;
  }

  author(a: string, b: string): boolean {
    if (a === b) return true;
    const k = pairKey(a, b);
    let v = this.authors.get(k);
    if (v === undefined) {
      v = authorsCompatible(a, b);
      this.authors.set(k, v);
    }
    return v;
  }

  /** compatible when one side has no reading or any pair of readings is compatible */
  authorLists(xs: readonly string[], ys: readonly string[]): boolean {
    if (!xs.length || !ys.length) return true;
    for (const x of xs) for (const y of ys) if (this.author(x, y)) return true;
    return false;
  }

  bestTitle(xs: readonly string[], ys: readonly string[]): number {
    let best = 0;
    for (const x of xs) {
      for (const y of ys) {
        const s = this.title(x, y);
        if (s > best) best = s;
        if (best >= 1) return 1;
      }
    }
    return best;
  }

  anyContained(xs: readonly string[], ys: readonly string[]): boolean {
    for (const x of xs) for (const y of ys) if (this.contains(x, y)) return true;
    return false;
  }

  anyPartial(xs: readonly string[], ys: readonly string[]): boolean {
    for (const x of xs) for (const y of ys) if (this.partial(x, y)) return true;
    return false;
  }
}

function numbersConflict(a: string, b: string): boolean {
  return a !== '' && b !== '' && a !== b;
}

/* ---------------------------- union-find ---------------------------- */

class Clusters {
  readonly parent: number[];
  readonly members = new Map<number, number[]>();
  readonly vframes = new Map<number, Set<number>>();
  private readonly summary = new Map<number, { author: string | null; title: string }>();

  constructor(private readonly items: Item[]) {
    this.parent = items.map((_, i) => i);
    for (const it of items) {
      this.members.set(it.idx, [it.idx]);
      this.vframes.set(it.idx, new Set([it.vframe]));
    }
  }

  find(i: number): number {
    let r = i;
    while (this.parent[r] !== r) r = this.parent[r];
    let c = i;
    while (this.parent[c] !== r) {
      const next = this.parent[c];
      this.parent[c] = r;
      c = next;
    }
    return r;
  }

  sharesFrame(ra: number, rb: number): boolean {
    const a = this.vframes.get(ra)!;
    const b = this.vframes.get(rb)!;
    const [small, large] = a.size <= b.size ? [a, b] : [b, a];
    for (const v of small) if (large.has(v)) return true;
    return false;
  }

  /** dominant (confidence-weighted most frequent) author reading and normalised title of a cluster */
  dominant(root: number): { author: string | null; title: string } {
    let s = this.summary.get(root);
    if (s) return s;
    const authorW = new Map<string, { w: number; raw: string; first: number }>();
    const titleW = new Map<string, { w: number; first: number }>();
    for (const m of this.members.get(root)!) {
      const it = this.items[m];
      const w = Math.max(0.05, it.conf);
      for (const a of it.authors) {
        const k = foldForCompare(a);
        if (!k) continue;
        const e = authorW.get(k);
        if (e) e.w += w;
        else authorW.set(k, { w, raw: a, first: m });
      }
      const e = titleW.get(it.rawTitleNorm);
      if (e) e.w += w;
      else titleW.set(it.rawTitleNorm, { w, first: m });
    }
    let author: string | null = null;
    let bestA = -1;
    let bestAFirst = Infinity;
    for (const e of authorW.values()) {
      if (e.w > bestA || (e.w === bestA && e.first < bestAFirst)) {
        bestA = e.w;
        bestAFirst = e.first;
        author = e.raw;
      }
    }
    let title = '';
    let bestT = -1;
    let bestTFirst = Infinity;
    for (const [k, e] of titleW) {
      if (e.w > bestT || (e.w === bestT && e.first < bestTFirst)) {
        bestT = e.w;
        bestTFirst = e.first;
        title = k;
      }
    }
    s = { author, title };
    this.summary.set(root, s);
    return s;
  }

  union(ra: number, rb: number): number {
    const [keep, drop] = ra < rb ? [ra, rb] : [rb, ra];
    this.parent[drop] = keep;
    this.members.get(keep)!.push(...this.members.get(drop)!);
    this.members.delete(drop);
    for (const v of this.vframes.get(drop)!) this.vframes.get(keep)!.add(v);
    this.vframes.delete(drop);
    this.summary.delete(keep);
    this.summary.delete(drop);
    return keep;
  }
}

/* ---------------------------- display helpers ---------------------------- */

function diacriticCount(s: string): number {
  let n = 0;
  for (const ch of s) if (ch.normalize('NFD').length > 1) n++;
  return n;
}

function isAllCapsText(s: string): boolean {
  return s !== s.toLowerCase() && s === s.toUpperCase();
}

/**
 * Applies the letter case of `caseSource` to `target` when both have the same folded letters at the
 * same positions ("RUDOLF, A TRÓNÖRÖKÖS" + "Rudolf, a tronorokos" → "Rudolf, a trónörökös").
 */
function transferCase(target: string, caseSource: string): string | null {
  const t = [...target];
  const c = [...caseSource];
  if (t.length !== c.length) return null;
  const out: string[] = [];
  for (let i = 0; i < t.length; i++) {
    const ft = foldForCompare(t[i]);
    const fc = foldForCompare(c[i]);
    if (ft !== fc) return null;
    if (c[i] !== c[i].toUpperCase()) out.push(t[i].toLowerCase());
    else if (c[i] !== c[i].toLowerCase()) out.push(t[i].toUpperCase());
    else out.push(t[i]);
  }
  return out.join('');
}

interface Variant {
  s: string;
  w: number;
  first: number;
}

/** Best written form among strings that fold to the same text: accents first, then real casing, then weight. */
function pickVariant(variants: Variant[], kind: 'title' | 'name'): string {
  const byExact = new Map<string, Variant>();
  for (const v of variants) {
    const e = byExact.get(v.s);
    if (e) {
      e.w += v.w;
      e.first = Math.min(e.first, v.first);
    } else byExact.set(v.s, { ...v });
  }
  const list = [...byExact.values()];
  list.sort(
    (x, y) =>
      diacriticCount(y.s) - diacriticCount(x.s) ||
      Number(!isAllCapsText(y.s)) - Number(!isAllCapsText(x.s)) ||
      y.w - x.w ||
      x.first - y.first,
  );
  const best = list[0].s;
  if (isAllCapsText(best)) {
    const mixed = list.find((v) => !isAllCapsText(v.s));
    if (mixed) {
      const transferred = transferCase(best, mixed.s);
      if (transferred) return transferred;
    }
    return kind === 'title' ? sentenceCase(best) : nameCase(best);
  }
  return best;
}

/** Most frequent exact raw reading (count, then confidence, then first appearance). */
function mostFrequentExact(entries: { s: string | null; conf: number; order: number }[]): string | null {
  const m = new Map<string, { n: number; w: number; first: number }>();
  for (const e of entries) {
    if (!e.s) continue;
    const x = m.get(e.s);
    if (x) {
      x.n++;
      x.w += e.conf;
      x.first = Math.min(x.first, e.order);
    } else m.set(e.s, { n: 1, w: e.conf, first: e.order });
  }
  let best: string | null = null;
  let bn = -1;
  let bw = -1;
  let bf = Infinity;
  for (const [s, x] of m) {
    if (x.n > bn || (x.n === bn && (x.w > bw || (x.w === bw && x.first < bf)))) {
      best = s;
      bn = x.n;
      bw = x.w;
      bf = x.first;
    }
  }
  return best;
}

/** Name readings: a reading supports another when all its name tokens are contained in it ("HAMANN" ⊂ "Brigitte Hamann"). */
function nameSupport(candidate: string, other: string): number {
  if (candidate === other) return 1;
  const ct = candidate.split(' ').filter(Boolean);
  const ot = other.split(' ').filter(Boolean);
  if (!ct.length || !ot.length) return 0;
  const pool = [...ct];
  let allFound = true;
  for (const t of ot) {
    let bi = -1;
    let br = 0;
    for (let i = 0; i < pool.length; i++) {
      const r =
        t === pool[i]
          ? 1
          : t.length === 1 || pool[i].length === 1
            ? t[0] === pool[i][0]
              ? 0.9
              : 0
            : levenshteinRatio(t, pool[i]);
      if (r > br) {
        br = r;
        bi = i;
      }
    }
    if (bi < 0 || br < 0.8) {
      allFound = false;
      break;
    }
    pool.splice(bi, 1);
  }
  if (allFound && ot.length <= ct.length) return 1;
  return levenshteinRatio(candidate, other) * 0.8;
}

interface ClusterBuild {
  cluster: MergeCluster;
  members: Item[];
  /** normalised title readings of the cluster (display + raw + canonical) */
  titleNorms: string[];
  /** author readings used for matching (display + spine) */
  authorReadings: string[];
  vframes: Set<number>;
  numbers: string;
  firstPos: [number, number, number];
}

function buildCluster(members: Item[], sims: SimCache): ClusterBuild {
  const sorted = [...members].sort(
    (a, b) => a.obs.frameOrder - b.obs.frameOrder || a.vframe - b.vframe || a.rank - b.rank || a.idx - b.idx,
  );
  const weight = (it: Item) => Math.max(0.05, it.conf);

  /* ---- title ---- */
  const canonGroups = new Map<string, { n: number; w: number; maxConf: number; first: number }>();
  for (const it of sorted) {
    const c = cleanStr(it.obs.canonicalTitle);
    const k = c ? foldForCompare(c) : '';
    if (!k) continue;
    const g = canonGroups.get(k);
    if (g) {
      g.n++;
      g.w += weight(it);
      g.maxConf = Math.max(g.maxConf, it.conf);
    } else canonGroups.set(k, { n: 1, w: weight(it), maxConf: it.conf, first: it.idx });
  }
  const eligibleCanon = [...canonGroups.entries()]
    .filter(([, g]) => g.n >= 2 || g.maxConf >= 0.8)
    .sort((x, y) => y[1].n - x[1].n || y[1].w - x[1].w || x[1].first - y[1].first);

  // medoid of raw title readings
  const rawGroups = new Map<string, { w: number; first: number; norm: string }>();
  for (const it of sorted) {
    const k = foldForCompare(it.obs.title);
    const g = rawGroups.get(k);
    if (g) g.w += weight(it);
    else rawGroups.set(k, { w: weight(it), first: it.idx, norm: it.rawTitleNorm });
  }
  let medoidKey = '';
  let medoidNorm = '';
  {
    let best = -1;
    let bestOwn = -1;
    let bestFirst = Infinity;
    for (const [k, g] of rawGroups) {
      let score = 0;
      for (const h of rawGroups.values()) {
        const s = sims.title(g.norm, h.norm);
        score += h.w * (s >= SAME_TITLE_THRESHOLD ? s : s * 0.5);
      }
      if (score > best + 1e-9 || (Math.abs(score - best) <= 1e-9 && (g.w > bestOwn || (g.w === bestOwn && g.first < bestFirst)))) {
        best = score;
        bestOwn = g.w;
        bestFirst = g.first;
        medoidKey = k;
        medoidNorm = g.norm;
      }
    }
  }

  const titleKey = eligibleCanon.length ? eligibleCanon[0][0] : medoidKey;
  const titleVariants: Variant[] = [];
  for (const it of sorted) {
    if (foldForCompare(it.obs.title) === titleKey) titleVariants.push({ s: cleanStr(it.obs.title)!, w: weight(it), first: it.idx });
    const c = cleanStr(it.obs.canonicalTitle);
    if (c && foldForCompare(c) === titleKey) titleVariants.push({ s: c, w: weight(it) * 1.5, first: it.idx });
  }
  const title = titleVariants.length ? pickVariant(titleVariants, 'title') : cleanStr(sorted[0].obs.title)!;
  const titleNorm = normalizeTitle(title);

  /* ---- author ---- */
  const canonAuthors = new Map<string, { n: number; w: number; maxConf: number; first: number }>();
  for (const it of sorted) {
    const c = canonicalAuthorOf(it);
    const k = c ? foldForCompare(c) : '';
    if (!k) continue;
    const g = canonAuthors.get(k);
    if (g) {
      g.n++;
      g.w += weight(it);
      g.maxConf = Math.max(g.maxConf, it.conf);
    } else canonAuthors.set(k, { n: 1, w: weight(it), maxConf: it.conf, first: it.idx });
  }
  const eligibleCanonAuthor = [...canonAuthors.entries()]
    .filter(([, g]) => g.n >= 2 || g.maxConf >= 0.8)
    .sort((x, y) => y[1].n - x[1].n || y[1].w - x[1].w || x[1].first - y[1].first);

  const rawAuthorGroups = new Map<string, { w: number; first: number; raw: string }>();
  for (const it of sorted) {
    const a = authorOf(it);
    const k = a ? foldForCompare(a) : '';
    if (!k) continue;
    const g = rawAuthorGroups.get(k);
    if (g) g.w += weight(it);
    else rawAuthorGroups.set(k, { w: weight(it), first: it.idx, raw: a! });
  }
  let authorKey: string | null = null;
  if (eligibleCanonAuthor.length) authorKey = eligibleCanonAuthor[0][0];
  else if (rawAuthorGroups.size) {
    let best = -1;
    let bestOwn = -1;
    let bestFirst = Infinity;
    for (const [k, g] of rawAuthorGroups) {
      let score = 0;
      for (const [k2, h] of rawAuthorGroups) score += h.w * nameSupport(k, k2);
      if (score > best + 1e-9 || (Math.abs(score - best) <= 1e-9 && (g.w > bestOwn || (g.w === bestOwn && g.first < bestFirst)))) {
        best = score;
        bestOwn = g.w;
        bestFirst = g.first;
        authorKey = k;
      }
    }
  }
  let author: string | null = null;
  if (authorKey) {
    const variants: Variant[] = [];
    for (const it of sorted) {
      const a = authorOf(it);
      if (a && foldForCompare(a) === authorKey) variants.push({ s: a, w: weight(it), first: it.idx });
      const c = canonicalAuthorOf(it);
      if (c && foldForCompare(c) === authorKey) variants.push({ s: c, w: weight(it) * 1.5, first: it.idx });
    }
    author = variants.length ? pickVariant(variants, 'name') : null;
  }

  /* ---- spine readings, publisher ---- */
  const spineTitle = mostFrequentExact(sorted.map((it) => ({ s: cleanStr(it.obs.title), conf: it.conf, order: it.idx })));
  const spineAuthor = mostFrequentExact(sorted.map((it) => ({ s: authorOf(it), conf: it.conf, order: it.idx })));
  const pubGroups = new Map<string, Variant[]>();
  for (const it of sorted) {
    const p = cleanStr(it.obs.publisher);
    const k = p ? foldForCompare(p) : '';
    if (!k) continue;
    const list = pubGroups.get(k) ?? [];
    list.push({ s: p!, w: weight(it), first: it.idx });
    pubGroups.set(k, list);
  }
  let publisher: string | null = null;
  {
    let best = -1;
    let bestFirst = Infinity;
    for (const list of pubGroups.values()) {
      const w = list.reduce((acc, v) => acc + v.w, 0);
      const first = Math.min(...list.map((v) => v.first));
      if (w > best || (w === best && first < bestFirst)) {
        best = w;
        bestFirst = first;
        publisher = pickVariant(list, 'name');
      }
    }
  }

  /* ---- confidence / review ---- */
  const frameSet = new Set(sorted.map((it) => it.obs.frameOrder));
  const maxConf = Math.max(...sorted.map((it) => it.conf));
  const confidence = Math.min(1, maxConf + (frameSet.size >= 2 ? 0.1 : 0));

  let conflicting = false;
  if (eligibleCanon.length >= 2) {
    const a = normalizeTitle(eligibleCanon[0][0]);
    const b = normalizeTitle(eligibleCanon[1][0]);
    if (sims.title(a, b) < SAME_TITLE_THRESHOLD) conflicting = true;
  }
  if (eligibleCanon.length && medoidNorm) {
    const cn = normalizeTitle(eligibleCanon[0][0]);
    if (sims.title(cn, medoidNorm) < NEAR_DUPLICATE_THRESHOLD && !sims.contains(cn, medoidNorm)) conflicting = true;
  }
  {
    let total = 0;
    let agreeing = 0;
    for (const it of sorted) {
      const w = weight(it);
      total += w;
      if (sims.title(it.rawTitleNorm, titleNorm) >= SAME_TITLE_THRESHOLD || sims.contains(it.rawTitleNorm, titleNorm)) agreeing += w;
    }
    if (total > 0 && agreeing / total < 0.5) conflicting = true;
  }
  if (author) {
    for (const g of rawAuthorGroups.values()) {
      if (g.w >= 0.5 && !sims.author(g.raw, author)) {
        conflicting = true;
        break;
      }
    }
  }
  const needsReview = confidence < 0.6 || titleNorm.replace(/\s/g, '').length < 3 || conflicting;

  /* ---- best observation ---- */
  const withBbox = sorted.filter((it) => it.obs.hasBbox);
  const pool = withBbox.length ? withBbox : sorted;
  const frameOrders = [...frameSet].sort((a, b) => a - b);
  const median = frameOrders[Math.floor((frameOrders.length - 1) / 2)];
  const best = [...pool].sort(
    (a, b) =>
      b.conf - a.conf ||
      Math.abs(a.obs.frameOrder - median) - Math.abs(b.obs.frameOrder - median) ||
      a.obs.frameOrder - b.obs.frameOrder ||
      a.vframe - b.vframe ||
      a.rank - b.rank,
  )[0];

  const titleNorms = new Set<string>([titleNorm]);
  for (const it of sorted) for (const t of it.titles) titleNorms.add(t);
  const authorReadings = [author, spineAuthor].filter((a): a is string => !!a);

  const first = sorted[0];
  // cluster volume numbers: display title first, else any reading
  let numbers = numbersKey(title);
  if (!numbers) {
    const withNumbers = sorted.find((it) => it.numbers);
    if (withNumbers) numbers = withNumbers.numbers;
  }

  return {
    cluster: {
      observationKeys: sorted.map((it) => it.obs.key),
      bestObservationKey: best.obs.key,
      matchedBookId: null,
      author,
      title,
      spineAuthor,
      spineTitle,
      publisher,
      confidence,
      needsReview,
      firstFrameOrder: first.obs.frameOrder,
      ambiguousWith: [],
    },
    members: sorted,
    titleNorms: [...titleNorms],
    authorReadings,
    vframes: new Set(sorted.map((it) => it.vframe)),
    numbers,
    firstPos: [first.obs.frameOrder, orderOf(first), first.vframe],
  };
}

/* ---------------------------- alignment ---------------------------- */

interface AlignedPair {
  p: number;
  q: number;
  score: number;
}

/** Monotone alignment of two left→right spine sequences maximising the summed pair scores. */
function alignFrames(scores: number[][], m: number, n: number): AlignedPair[] {
  const dp: Float64Array[] = Array.from({ length: m + 1 }, () => new Float64Array(n + 1));
  for (let p = 1; p <= m; p++) {
    for (let q = 1; q <= n; q++) {
      let v = Math.max(dp[p - 1][q], dp[p][q - 1]);
      const s = scores[p - 1][q - 1];
      if (s > 0) v = Math.max(v, dp[p - 1][q - 1] + s);
      dp[p][q] = v;
    }
  }
  const out: AlignedPair[] = [];
  let p = m;
  let q = n;
  while (p > 0 && q > 0) {
    const s = scores[p - 1][q - 1];
    if (s > 0 && Math.abs(dp[p][q] - (dp[p - 1][q - 1] + s)) < 1e-9) {
      out.push({ p: p - 1, q: q - 1, score: s });
      p--;
      q--;
    } else if (Math.abs(dp[p][q] - dp[p - 1][q]) < 1e-9) p--;
    else q--;
  }
  return out.reverse();
}

/* ---------------------------- main ---------------------------- */

/**
 * Clusters the spine observations of ONE video into books (SPEC §4.4). Deterministic.
 *
 * Rules
 * - observations with an empty title are dropped; two observations are the same book when the title
 *   similarity is ≥ 0.85 and the authors are compatible (missing author ⇒ compatible) and their volume
 *   numbers do not conflict;
 * - two different spines of the same frame never merge (frames read twice by overlapping vision
 *   batches are detected as separate "passes" by a restart of `orderInFrame`);
 * - neighbouring frames are aligned (monotone sequence alignment); a weaker reading (similarity ≥ 0.6 or
 *   a partial title) at the same slot whose neighbour spine matches strongly is merged too;
 * - clusters stay author-consistent (identical titles by clearly different authors never merge);
 * - display values: canonical values confirmed by ≥ 2 observations or confidence ≥ 0.8 win, otherwise
 *   the confidence-weighted medoid of the spine readings; spine* keep the most frequent raw reading;
 * - output order = shelf order: first appearance (frameOrder, then orderInFrame). When the pan goes
 *   right→left (detected from the alignment) books are ordered by their last appearance instead, so
 *   the result is always the physical left→right order;
 * - clusters are matched one-to-one against `existing` books with the same rule (`matchedBookId`), but
 *   only when the shelf context agrees: a neighbouring cluster (±3) also matches a book near the
 *   existing one (same source video, ±4 positions), or the cluster is the first/last book of this video
 *   and the existing book the last/first of its video (a clip continuing the previous one), or the source has ≤ 3 books (a photo). A lone title match elsewhere on
 *   the shelf is a second physical copy, not a duplicate;
 * - `ambiguousWith` lists clusters never seen in the same frame whose titles are near-duplicates
 *   (similarity ≥ 0.6, authors compatible) – candidates for the LLM duplicate judge;
 * - phantom twins: a reading seen in a single frame that duplicates (title ≥ 0.9) a spine of the same
 *   frame which is also seen in ≥ 2 other frames without it is a double listing by the vision model and
 *   joins that spine; a phantom carrying the author of a neighbouring spine (title ≥ 0.95) joins too and
 *   its author reading is ignored. Real second copies are seen together in several frames.
 */
export function clusterObservations(
  obs: MergeObservation[],
  existing: ExistingBookRef[] = [],
  options: ClusterOptions = {},
): MergeCluster[] {
  const sims = new SimCache();

  /* ---- 1. items ---- */
  const seenKeys = new Set<string>();
  const raw: { obs: MergeObservation; input: number }[] = [];
  obs.forEach((o, input) => {
    if (!o || typeof o.key !== 'string' || seenKeys.has(o.key)) return;
    const title = cleanStr(o.title);
    if (!title || !normalizeTitle(title)) return;
    seenKeys.add(o.key);
    raw.push({ obs: o, input });
  });
  if (!raw.length) return [];

  /* ---- 2. virtual frames (frame + reading pass) ---- */
  const byFrame = new Map<number, { obs: MergeObservation; input: number }[]>();
  for (const r of raw) {
    const fo = Number.isFinite(r.obs.frameOrder) ? r.obs.frameOrder : Number.MAX_SAFE_INTEGER;
    const list = byFrame.get(fo) ?? [];
    list.push(r);
    byFrame.set(fo, list);
  }
  const vframeLists: { obs: MergeObservation; input: number }[][] = [];
  for (const fo of [...byFrame.keys()].sort((a, b) => a - b)) {
    let current: { obs: MergeObservation; input: number }[] = [];
    let lastOrder = -Infinity;
    for (const r of byFrame.get(fo)!) {
      const order = Number.isFinite(r.obs.orderInFrame) ? r.obs.orderInFrame : lastOrder + 1;
      if (current.length && order <= lastOrder) {
        vframeLists.push(current);
        current = [];
      }
      current.push(r);
      lastOrder = order;
    }
    if (current.length) vframeLists.push(current);
  }

  const items: Item[] = [];
  const vframes: Item[][] = [];
  vframeLists.forEach((list, v) => {
    const frameItems: Item[] = [];
    list.forEach((r, rank) => {
      const o = r.obs;
      const rawTitleNorm = normalizeTitle(o.title);
      const canon = cleanStr(o.canonicalTitle);
      const canonTitleNorm = canon ? normalizeTitle(canon) || null : null;
      const titles = canonTitleNorm && canonTitleNorm !== rawTitleNorm ? [rawTitleNorm, canonTitleNorm] : [rawTitleNorm];
      const authors = [cleanStr(o.author), cleanStr(o.canonicalAuthor)].filter(
        (a, i, arr): a is string => !!a && foldForCompare(a) !== '' && arr.indexOf(a) === i,
      );
      const rawNumbers = numbersKey(o.title);
      const item: Item = {
        idx: items.length,
        obs: o,
        conf: clamp01(o.confidence),
        vframe: v,
        rank,
        titles,
        rawTitleNorm,
        canonTitleNorm,
        authors,
        numbers: rawNumbers || (canon ? numbersKey(canon) : ''),
        ignoreAuthor: false,
        phantom: false,
      };
      items.push(item);
      frameItems.push(item);
    });
    vframes.push(frameItems);
  });

  const pairOk = (x: Item, y: Item) => !numbersConflict(x.numbers, y.numbers) && sims.authorLists(x.authors, y.authors);

  /* ---- 3. strong edges (title ≥ 0.85, authors compatible) ---- */
  const edges = new Map<string, Edge>();
  const addEdge = (a: number, b: number, weight: number, kind: EdgeKind) => {
    if (a === b) return;
    const [x, y] = a < b ? [a, b] : [b, a];
    const k = `${x}:${y}`;
    const e = edges.get(k);
    if (!e || e.kind < kind || (e.kind === kind && e.weight < weight)) edges.set(k, { a: x, b: y, weight, kind });
  };

  const titleIds = new Map<string, number>();
  const titleItems: number[][] = [];
  const titleList: string[] = [];
  for (const it of items) {
    for (const t of it.titles) {
      let id = titleIds.get(t);
      if (id === undefined) {
        id = titleList.length;
        titleIds.set(t, id);
        titleList.push(t);
        titleItems.push([]);
      }
      titleItems[id].push(it.idx);
    }
  }
  const index = new TrigramIndex();
  titleList.forEach((t, id) => index.add(id, t));
  const strongPairs = new Map<string, number>();
  for (let ta = 0; ta < titleList.length; ta++) {
    for (const tb of index.candidates(titleList[ta], 0.3)) {
      if (tb < ta) continue;
      const s = sims.title(titleList[ta], titleList[tb]);
      if (s < SAME_TITLE_THRESHOLD) continue;
      for (const i of titleItems[ta]) {
        for (const j of titleItems[tb]) {
          if (i === j) continue;
          const x = items[i];
          const y = items[j];
          if (x.vframe === y.vframe || !pairOk(x, y)) continue;
          const k = i < j ? `${i}:${j}` : `${j}:${i}`;
          if ((strongPairs.get(k) ?? 0) < s) strongPairs.set(k, s);
        }
      }
    }
  }
  for (const [k, s] of strongPairs) {
    const [a, b] = k.split(':').map(Number);
    addEdge(a, b, s, 2);
  }

  /* ---- 4. alignment of neighbouring frames (positional prior) ---- */
  /** median (rank in u − rank in v) of the strongly matching spines of frames u and v */
  const shiftOf = new Map<string, number>();
  for (let v = 1; v < vframes.length; v++) {
    for (let u = v - 1; u >= Math.max(0, v - ALIGN_WINDOW); u--) {
      const A = vframes[u];
      const B = vframes[v];
      const scores: number[][] = A.map((x) =>
        B.map((y) => {
          if (!pairOk(x, y)) return 0;
          const s = sims.bestTitle(x.titles, y.titles);
          if (s >= ALIGN_THRESHOLD) return s;
          return sims.anyContained(x.titles, y.titles) ? ALIGN_THRESHOLD : 0;
        }),
      );
      const aligned = alignFrames(scores, A.length, B.length);
      const strongAt = new Set(aligned.filter((pr) => pr.score >= SAME_TITLE_THRESHOLD).map((pr) => `${pr.p}:${pr.q}`));
      const shifts: number[] = [];
      for (const pr of aligned) {
        const x = A[pr.p];
        const y = B[pr.q];
        if (pr.score >= SAME_TITLE_THRESHOLD) {
          addEdge(x.idx, y.idx, pr.score, 3);
          shifts.push(pr.p - pr.q);
          continue;
        }
        const anchored = strongAt.has(`${pr.p - 1}:${pr.q - 1}`) || strongAt.has(`${pr.p + 1}:${pr.q + 1}`);
        if (!anchored) continue;
        const weakEnough = pr.score >= NEAR_DUPLICATE_THRESHOLD || sims.anyPartial(x.titles, y.titles);
        if (weakEnough) addEdge(x.idx, y.idx, pr.score, 1);
      }
      if (shifts.length) {
        shifts.sort((a, b) => a - b);
        const mid = shifts.length >> 1;
        shiftOf.set(`${u}:${v}`, shifts.length % 2 ? shifts[mid] : (shifts[mid - 1] + shifts[mid]) / 2);
      }
    }
  }

  // shelf coordinate of every observation: rank inside its frame + frame offset along the pan
  const offsets = new Array<number>(vframes.length).fill(0);
  {
    let pos = 0;
    let neg = 0;
    for (let v = 1; v < vframes.length; v++) {
      const s = shiftOf.get(`${v - 1}:${v}`);
      if (s !== undefined && s > 0) pos++;
      else if (s !== undefined && s < 0) neg++;
    }
    const leftToRight = pos >= neg;
    let minPos = 0;
    let maxPos = vframes.length ? vframes[0].length - 1 : 0;
    for (let v = 1; v < vframes.length; v++) {
      const s1 = shiftOf.get(`${v - 1}:${v}`);
      const s2 = v >= 2 ? shiftOf.get(`${v - 2}:${v}`) : undefined;
      let off: number;
      if (s1 !== undefined) off = offsets[v - 1] + s1;
      else if (s2 !== undefined) off = offsets[v - 2] + s2;
      else off = leftToRight ? maxPos + 1 : minPos - vframes[v].length; // no overlap: continue the pan
      offsets[v] = off;
      minPos = Math.min(minPos, off);
      maxPos = Math.max(maxPos, off + vframes[v].length - 1);
    }
  }

  /* ---- 5. forced links ---- */
  if (options.extraLinks?.length) {
    const byKey = new Map(items.map((it) => [it.obs.key, it.idx]));
    for (const [ka, kb] of options.extraLinks) {
      const a = byKey.get(ka);
      const b = byKey.get(kb);
      if (a !== undefined && b !== undefined) addEdge(a, b, 1, 0 as EdgeKind);
    }
  }

  /* ---- 6. constrained union-find ---- */
  const forced = new Set<string>();
  if (options.extraLinks?.length) {
    const byKey = new Map(items.map((it) => [it.obs.key, it.idx]));
    for (const [ka, kb] of options.extraLinks) {
      const a = byKey.get(ka);
      const b = byKey.get(kb);
      if (a !== undefined && b !== undefined && a !== b) forced.add(a < b ? `${a}:${b}` : `${b}:${a}`);
    }
  }
  const priority = (e: Edge) => (forced.has(`${e.a}:${e.b}`) ? 4 : e.kind);
  const ordered = [...edges.values()].sort(
    (x, y) => priority(y) - priority(x) || y.weight - x.weight || x.a - y.a || x.b - y.b,
  );
  const uf = new Clusters(items);
  for (const e of ordered) {
    const ra = uf.find(e.a);
    const rb = uf.find(e.b);
    if (ra === rb) continue;
    if (uf.sharesFrame(ra, rb)) continue;
    const isForced = priority(e) === 4;
    const da = uf.dominant(ra);
    const db_ = uf.dominant(rb);
    if (da.author && db_.author && !sims.author(da.author, db_.author)) continue;
    if (!isForced) {
      const ts = sims.title(da.title, db_.title);
      if (ts < NEAR_DUPLICATE_THRESHOLD && !sims.partial(da.title, db_.title)) continue;
    }
    uf.union(ra, rb);
  }

  /* ---- 6b. phantom twins ---- */
  // Vision models sometimes list one spine twice in a frame: an identical second entry, or the same title
  // with the author of the neighbouring spine. A single reading seen in ONE frame whose near-identical
  // twin shares that frame, while the twin is also seen in ≥ 2 other frames without it, is such a phantom
  // and joins its twin. A real second copy stands next to the first one and is seen together with it.
  {
    const frameOfVframe = vframes.map((list) => list[0]?.obs.frameOrder ?? -1);
    const maxConfOf = (root: number) => Math.max(...uf.members.get(root)!.map((i) => items[i].conf));
    const authorNear = (x: Item, exclude: Set<number>): boolean => {
      for (let u = x.vframe - 1; u <= x.vframe + 1; u++) {
        if (u < 0 || u >= vframes.length) continue;
        for (const y of vframes[u]) {
          const r = uf.find(y.idx);
          if (exclude.has(r)) continue;
          const author = uf.dominant(r).author;
          if (author && sims.authorLists(x.authors, [author])) return true;
        }
      }
      return false;
    };
    const singles = [...uf.members.entries()]
      .filter(([, m]) => m.length === 1)
      .map(([root]) => root)
      .sort((a, b) => a - b);
    for (const c of singles) {
      if (uf.find(c) !== c || uf.members.get(c)!.length !== 1) continue;
      const x = items[c];
      let best: { root: number; score: number; bled: boolean } | null = null;
      for (const y of vframes[x.vframe]) {
        const s = uf.find(y.idx);
        if (s === c) continue;
        let otherFrames = 0;
        for (const v of uf.vframes.get(s)!) if (frameOfVframe[v] !== x.obs.frameOrder) otherFrames++;
        if (otherFrames < PHANTOM_MIN_OTHER_FRAMES) continue;
        const dom = uf.dominant(s);
        if (numbersConflict(x.numbers, y.numbers)) continue;
        const titleScore = sims.bestTitle(x.titles, dom.title ? [dom.title, ...y.titles] : y.titles);
        if (titleScore < PHANTOM_TITLE_THRESHOLD) continue;
        if (x.conf > maxConfOf(s) + 1e-9) continue;
        const compatible = sims.authorLists(x.authors, y.authors) && (!dom.author || sims.authorLists(x.authors, [dom.author]));
        const bled = !compatible && titleScore >= PHANTOM_BLED_TITLE_THRESHOLD && authorNear(x, new Set([c, s]));
        if (!compatible && !bled) continue;
        const score = titleScore + (compatible ? 0.01 : 0);
        if (!best || score > best.score) best = { root: s, score, bled };
      }
      if (best) {
        x.phantom = true;
        if (best.bled) {
          x.ignoreAuthor = true;
          x.authors = [];
        }
        uf.union(c, best.root);
      }
    }
  }

  /* ---- 7. build + order ---- */
  const builds: ClusterBuild[] = [];
  for (const memberIdx of uf.members.values()) builds.push(buildCluster(memberIdx.map((i) => items[i]), sims));
  const coordinate = new Map<ClusterBuild, number>();
  for (const b of builds) {
    const placed = b.members.some((it) => !it.phantom) ? b.members.filter((it) => !it.phantom) : b.members;
    const sum = placed.reduce((acc, it) => acc + it.rank + offsets[it.vframe], 0);
    coordinate.set(b, sum / placed.length);
  }
  builds.sort((x, y) => {
    const d = coordinate.get(x)! - coordinate.get(y)!;
    if (Math.abs(d) > 1e-9) return d;
    return (
      x.firstPos[0] - y.firstPos[0] ||
      x.firstPos[1] - y.firstPos[1] ||
      x.firstPos[2] - y.firstPos[2] ||
      x.members[0].idx - y.members[0].idx
    );
  });
  // direct evidence beats the estimate: neighbours seen together in frames keep their left→right order
  {
    const rankIn = builds.map((b) => new Map(b.members.filter((it) => !it.phantom).map((it) => [it.vframe, it.rank])));
    for (let pass = 0; pass < builds.length; pass++) {
      let swapped = false;
      for (let i = 0; i + 1 < builds.length; i++) {
        let before = 0;
        let after = 0;
        for (const [v, ra] of rankIn[i]) {
          const rb = rankIn[i + 1].get(v);
          if (rb === undefined) continue;
          if (ra < rb) before++;
          else after++;
        }
        if (after > before) {
          [builds[i], builds[i + 1]] = [builds[i + 1], builds[i]];
          [rankIn[i], rankIn[i + 1]] = [rankIn[i + 1], rankIn[i]];
          swapped = true;
        }
      }
      if (!swapped) break;
    }
  }

  /* ---- 8. match existing books (one-to-one) ---- */
  if (existing.length) {
    const exTitles: string[] = [];
    const exOwner: number[] = [];
    const exIndex = new TrigramIndex();
    existing.forEach((b, bi) => {
      const ts = new Set([normalizeTitle(b.title), normalizeTitle(b.spineTitle)].filter(Boolean));
      for (const t of ts) {
        exIndex.add(exTitles.length, t);
        exTitles.push(t);
        exOwner.push(bi);
      }
    });
    const exAuthors = existing.map((b) => [cleanStr(b.author), cleanStr(b.spineAuthor)].filter((a): a is string => !!a));
    const exNumbers = existing.map((b) => numbersKey(b.title) || numbersKey(b.spineTitle));
    const candidates: { ci: number; bi: number; score: number }[] = [];
    builds.forEach((cb, ci) => {
      const best = new Map<number, number>();
      for (const t of cb.titleNorms) {
        for (const ti of exIndex.candidates(t, 0.3)) {
          const s = sims.title(t, exTitles[ti]);
          if (s < SAME_TITLE_THRESHOLD) continue;
          const bi = exOwner[ti];
          if ((best.get(bi) ?? 0) < s) best.set(bi, s);
        }
      }
      for (const [bi, s] of best) {
        if (numbersConflict(cb.numbers, exNumbers[bi])) continue;
        if (!sims.authorLists(cb.authorReadings, exAuthors[bi])) continue;
        candidates.push({ ci, bi, score: s });
      }
    });

    // shelf context of existing books: block (source video) + rank inside the block
    const hasPositions = existing.some((b) => typeof b.shelfPosition === 'number' && Number.isFinite(b.shelfPosition));
    const block = existing.map((b) =>
      hasPositions && typeof b.shelfPosition === 'number' && Number.isFinite(b.shelfPosition)
        ? Math.floor(b.shelfPosition / 100000)
        : hasPositions
          ? -1
          : 0,
    );
    const rankInBlock = new Array<number>(existing.length).fill(0);
    const blockSize = new Map<number, number>();
    {
      const order = existing
        .map((b, bi) => ({ bi, pos: hasPositions ? (b.shelfPosition ?? Number.POSITIVE_INFINITY) : bi }))
        .sort((x, y) => block[x.bi] - block[y.bi] || x.pos - y.pos || x.bi - y.bi);
      for (const { bi } of order) {
        const n = blockSize.get(block[bi]) ?? 0;
        rankInBlock[bi] = n;
        blockSize.set(block[bi], n + 1);
      }
    }
    const nClusters = builds.length;
    const byCluster = new Map<number, { bi: number }[]>();
    for (const c of candidates) {
      const list = byCluster.get(c.ci) ?? [];
      list.push({ bi: c.bi });
      byCluster.set(c.ci, list);
    }
    const supported = (ci: number, bi: number): boolean => {
      // a photo / very short clip has no shelf context
      if (nClusters <= 3) return true;
      // neighbouring clusters match neighbouring existing books → the same shelf filmed again
      for (let d = -NEIGHBOUR_CLUSTERS; d <= NEIGHBOUR_CLUSTERS; d++) {
        if (d === 0) continue;
        for (const other of byCluster.get(ci + d) ?? []) {
          if (other.bi === bi || block[other.bi] !== block[bi]) continue;
          if (Math.abs(rankInBlock[other.bi] - rankInBlock[bi]) <= NEIGHBOUR_BOOKS) return true;
        }
      }
      // continuation: the edge of this video overlaps the edge of an earlier video
      const atClusterEdge = ci < EDGE_SPAN || ci >= nClusters - EDGE_SPAN;
      const size = blockSize.get(block[bi]) ?? 0;
      const atBookEdge = rankInBlock[bi] < EDGE_SPAN || rankInBlock[bi] >= size - EDGE_SPAN;
      return atClusterEdge && atBookEdge;
    };
    const supportedCandidates = candidates.filter((c) => supported(c.ci, c.bi));
    supportedCandidates.sort((x, y) => y.score - x.score || x.ci - y.ci || x.bi - y.bi);
    const usedC = new Set<number>();
    const usedB = new Set<number>();
    for (const c of supportedCandidates) {
      if (usedC.has(c.ci) || usedB.has(c.bi)) continue;
      usedC.add(c.ci);
      usedB.add(c.bi);
      builds[c.ci].cluster.matchedBookId = existing[c.bi].id;
    }
  }

  /* ---- 9. near-duplicate candidates ---- */
  const cIndex = new TrigramIndex();
  const cTitleOwner: number[] = [];
  const cTitles: string[] = [];
  builds.forEach((cb, ci) => {
    const own = new Set([normalizeTitle(cb.cluster.title), normalizeTitle(cb.cluster.spineTitle)].filter(Boolean));
    for (const t of own) {
      cIndex.add(cTitles.length, t);
      cTitles.push(t);
      cTitleOwner.push(ci);
    }
  });
  const ambiguous = builds.map(() => new Set<number>());
  cTitles.forEach((t, ti) => {
    const ci = cTitleOwner[ti];
    for (const tj of cIndex.candidates(t, 0.15)) {
      const cj = cTitleOwner[tj];
      if (cj <= ci || ambiguous[ci].has(cj)) continue;
      const a = builds[ci];
      const b = builds[cj];
      let shared = false;
      for (const v of a.vframes) if (b.vframes.has(v)) { shared = true; break; }
      if (shared) continue;
      const s = sims.title(t, cTitles[tj]);
      if (s < NEAR_DUPLICATE_THRESHOLD && !sims.contains(t, cTitles[tj])) continue;
      if (numbersConflict(a.numbers, b.numbers)) continue;
      if (!sims.authorLists(a.authorReadings, b.authorReadings)) continue;
      ambiguous[ci].add(cj);
      ambiguous[cj].add(ci);
    }
  });
  builds.forEach((cb, ci) => {
    cb.cluster.ambiguousWith = [...ambiguous[ci]].sort((a, b) => a - b);
  });

  return builds.map((b) => b.cluster);
}

/** Title similarity of two clusters' display titles (used to prioritise duplicate questions). */
export function clusterPairSimilarity(a: MergeCluster, b: MergeCluster): number {
  return titleSimilarityNormalized(normalizeTitle(a.title), normalizeTitle(b.title));
}

/* ================================================================== */
/* DB wrapper                                                          */
/* ================================================================== */

type Tx = Parameters<Parameters<DB['transaction']>[0]>[0];
type Queryable = DB | Tx;

interface DetectionInput {
  id: string;
  frameId: string | null;
  frameIdx: number | null;
  frameTime: number | null;
  rawAuthor: string | null;
  rawTitle: string;
  publisher: string | null;
  confidence: number;
  bbox: BBox | null;
  orderInFrame: number | null;
  createdAt: Date;
}

interface CanonicalHintLike {
  canonicalAuthor: string | null;
  canonicalTitle: string | null;
}

export interface MergeVideoOptions {
  /** canonical_author / canonical_title per detection id (default: the vision step's in-process hints) */
  canonicalHints?: ReadonlyMap<string, CanonicalHintLike>;
  /** ask the text provider about near-duplicate pairs (default true) */
  judgeDuplicates?: boolean;
}

/** Max duplicate questions per video. */
const MAX_DUPLICATE_QUESTIONS = 30;
const FRAMELESS_ORDER_BASE = 1_000_000_000;

function describeErr(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 300 ? `${msg.slice(0, 300)}…` : msg;
}

async function loadDetections(q: Queryable, videoId: string): Promise<DetectionInput[]> {
  const rows = await q
    .select({
      id: detections.id,
      frameId: detections.frameId,
      frameIdx: frames.idx,
      frameTime: frames.timeSec,
      rawAuthor: detections.rawAuthor,
      rawTitle: detections.rawTitle,
      publisher: detections.publisher,
      confidence: detections.confidence,
      bbox: detections.bbox,
      orderInFrame: detections.orderInFrame,
      createdAt: detections.createdAt,
    })
    .from(detections)
    .leftJoin(frames, eq(frames.id, detections.frameId))
    .where(and(eq(detections.videoId, videoId), isNull(detections.bookId)));
  return rows;
}

const bboxCenterX = (b: BBox | null) => (b ? (Number(b.x0) + Number(b.x1)) / 2 : Number.POSITIVE_INFINITY);

/**
 * Converts detection rows to merge observations in reading order: frame, insertion time (one vision
 * batch per insert), order in frame (bbox centre when the model gave no order).
 */
export function detectionsToObservations(
  rows: DetectionInput[],
  hints: ReadonlyMap<string, CanonicalHintLike> = new Map(),
): MergeObservation[] {
  const sorted = [...rows].sort((a, b) => {
    const fa = a.frameIdx ?? Number.POSITIVE_INFINITY;
    const fb = b.frameIdx ?? Number.POSITIVE_INFINITY;
    if (fa !== fb) return fa - fb;
    const ta = a.createdAt instanceof Date ? a.createdAt.getTime() : 0;
    const tb = b.createdAt instanceof Date ? b.createdAt.getTime() : 0;
    if (ta !== tb) return ta - tb;
    const oa = a.orderInFrame ?? Number.POSITIVE_INFINITY;
    const ob = b.orderInFrame ?? Number.POSITIVE_INFINITY;
    if (oa !== ob) return oa - ob;
    const xa = bboxCenterX(a.bbox);
    const xb = bboxCenterX(b.bbox);
    if (xa !== xb) return xa - xb;
    return cmpStr(a.id, b.id);
  });
  let frameless = 0;
  const lastOrderByGroup = new Map<string, number>();
  return sorted.map((r) => {
    const frameOrder = r.frameIdx ?? FRAMELESS_ORDER_BASE + frameless++;
    const group = `${frameOrder}|${r.createdAt instanceof Date ? r.createdAt.getTime() : 0}`;
    let order = r.orderInFrame;
    if (order === null || !Number.isFinite(order)) {
      // no order from the model: continue after the previous observation of the same batch/frame
      order = (lastOrderByGroup.get(group) ?? 0) + 1;
    }
    lastOrderByGroup.set(group, Math.max(lastOrderByGroup.get(group) ?? 0, order));
    const hint = hints.get(r.id);
    return {
      key: r.id,
      frameOrder,
      orderInFrame: order,
      author: r.rawAuthor,
      title: r.rawTitle,
      canonicalAuthor: hint?.canonicalAuthor ?? null,
      canonicalTitle: hint?.canonicalTitle ?? null,
      publisher: r.publisher,
      confidence: r.confidence,
      hasBbox: !!r.bbox,
    };
  });
}

async function loadExisting(q: Queryable, collectionId: string): Promise<ExistingBookRef[]> {
  return q
    .select({
      id: books.id,
      author: books.author,
      title: books.title,
      spineAuthor: books.spineAuthor,
      spineTitle: books.spineTitle,
      shelfPosition: books.shelfPosition,
    })
    .from(books)
    .where(eq(books.collectionId, collectionId))
    .orderBy(books.shelfPosition, books.createdAt, books.id);
}

async function defaultCanonicalHints(videoId: string): Promise<ReadonlyMap<string, CanonicalHintLike>> {
  try {
    const mod = await import('./vision-step');
    return mod.getCanonicalHints(videoId);
  } catch (e) {
    console.warn('[merge] canonical hints unavailable', { videoId, error: describeErr(e) });
    return new Map();
  }
}

/** Asks the text provider whether suspicious near-duplicate NEW clusters are the same book. */
async function judgeNearDuplicates(collectionId: string, clusters: MergeCluster[]): Promise<Array<[string, string]>> {
  const pairs: { i: number; j: number; sim: number }[] = [];
  clusters.forEach((c, i) => {
    if (c.matchedBookId) return;
    for (const j of c.ambiguousWith) {
      if (j <= i || clusters[j].matchedBookId) continue;
      pairs.push({ i, j, sim: clusterPairSimilarity(c, clusters[j]) });
    }
  });
  if (!pairs.length) return [];
  pairs.sort((a, b) => b.sim - a.sim || a.i - b.i || a.j - b.j);
  const selected = pairs.slice(0, MAX_DUPLICATE_QUESTIONS);
  try {
    const { getTextProvider } = await import('@/lib/ai');
    const provider = getTextProvider();
    const questions = selected.map((p) => ({
      id: `q${p.i}_${p.j}`,
      a: { author: clusters[p.i].author, title: clusters[p.i].title },
      b: { author: clusters[p.j].author, title: clusters[p.j].title },
    }));
    const { same, usage } = await provider.judgeDuplicates(questions);
    try {
      const { recordUsage } = await import('@/lib/ai/usage');
      await recordUsage(collectionId, usage);
    } catch (e) {
      console.warn('[merge] recordUsage failed', { collectionId, error: describeErr(e) });
    }
    const links: Array<[string, string]> = [];
    for (const p of selected) {
      if (same?.[`q${p.i}_${p.j}`] === true) links.push([clusters[p.i].bestObservationKey, clusters[p.j].bestObservationKey]);
    }
    console.info('[merge] duplicate judge', { collectionId, asked: selected.length, same: links.length });
    return links;
  } catch (e) {
    console.warn('[merge] duplicate judge skipped', { collectionId, error: describeErr(e) });
    return [];
  }
}

/**
 * Bibliographic book fields the owner can edit through the API. An edit is recorded as
 * `enrichment = { …, userEdited: true, userEditedFields: [field names] }` (manual books list the
 * fields that were provided); automatic steps never overwrite a listed field.
 */
export const OWNER_BIBLIOGRAPHIC_FIELDS: readonly string[] = [
  'title',
  'subtitle',
  'author',
  'originalTitle',
  'series',
  'publisher',
  'language',
  'firstPublishedYear',
  'editionYear',
  'isbn',
  'pageCount',
  'category',
  'topics',
  'tags',
];

export interface OwnerEditGuard {
  /** legacy `userEdited: true` without a field list → every bibliographic field is protected */
  all: boolean;
  /** fields the owner edited (never overwritten by merge / enrichment) */
  fields: Set<string>;
  /** the owner accepted the book in the review view (its identity must not be rewritten) */
  reviewed: boolean;
}

/**
 * Reads the owner-edit markers of a book. Protection is PER FIELD (`enrichment.userEditedFields`);
 * older markers are understood too: `userEdited` as a list / map of field names, or `userEdited: true`
 * with no list (all bibliographic fields). A book is never skipped as a whole – only its listed fields
 * are protected.
 */
export function ownerEditedFields(book: Pick<BookRow, 'enrichment' | 'reviewed'>): OwnerEditGuard {
  const fields = new Set<string>();
  const enrichment = book.enrichment && typeof book.enrichment === 'object' && !Array.isArray(book.enrichment)
    ? (book.enrichment as Record<string, unknown>)
    : null;
  const addAll = (v: unknown) => {
    if (Array.isArray(v)) {
      for (const f of v) if (typeof f === 'string' && f) fields.add(f);
    } else if (v && typeof v === 'object') {
      for (const [k, on] of Object.entries(v as Record<string, unknown>)) if (on) fields.add(k);
    }
  };
  const ue = enrichment?.userEdited;
  const listed = enrichment?.userEditedFields;
  addAll(listed);
  addAll(ue);
  const hasList = Array.isArray(listed) || Array.isArray(ue) || (!!ue && typeof ue === 'object');
  const all = !hasList && (ue === true || ue === 'all');
  return { all, fields, reviewed: book.reviewed === true };
}

/** true when an automatic step must not write `field` of a book with this guard */
export function isFieldProtected(guard: OwnerEditGuard, field: string): boolean {
  if (guard.fields.has(field)) return true;
  return guard.all && OWNER_BIBLIOGRAPHIC_FIELDS.includes(field);
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Clusters the unassigned detections of one video into books (matching existing books of the
 * collection), inserts/updates `books`, sets `detections.book_id`, updates `videos.books_found`.
 */
export async function mergeVideoDetections(
  videoId: string,
  options: MergeVideoOptions = {},
): Promise<{ newBookIds: string[]; updatedBookIds: string[] }> {
  const database = db();
  const [video] = await database.select().from(videos).where(eq(videos.id, videoId)).limit(1);
  if (!video) throw new Error(`mergeVideoDetections: video ${videoId} not found`);

  const hints = options.canonicalHints ?? (await defaultCanonicalHints(videoId));

  // pre-pass outside the lock: find near-duplicates for the (slow) LLM judge
  let extraLinks: Array<[string, string]> = [];
  if (options.judgeDuplicates !== false) {
    const [rows, existing] = await Promise.all([loadDetections(database, videoId), loadExisting(database, video.collectionId)]);
    if (rows.length) {
      const pre = clusterObservations(detectionsToObservations(rows, hints), existing);
      extraLinks = await judgeNearDuplicates(video.collectionId, pre);
    }
  }

  const maxBooks = env().MAX_BOOKS_PER_COLLECTION;
  const result = await database.transaction(async (tx) => {
    // one merge per collection at a time (parallel videos of the same shelf must dedupe against each other)
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`exl-merge:${video.collectionId}`}, 0))`);

    const rows = await loadDetections(tx, videoId);
    const newBookIds: string[] = [];
    const updatedBookIds: string[] = [];
    if (rows.length) {
      const existing = await loadExisting(tx, video.collectionId);
      const observations = detectionsToObservations(rows, hints);
      const clusters = clusterObservations(observations, existing, { extraLinks });
      const rowById = new Map(rows.map((r) => [r.id, r]));
      const source = video.kind === 'image' ? 'image' : 'video';

      const [{ n: bookCount }] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(books)
        .where(eq(books.collectionId, video.collectionId));
      let room = Math.max(0, maxBooks - Number(bookCount));

      const assignments: { bookId: string; detectionIds: string[] }[] = [];
      const inserts: NewBookRow[] = [];
      let skipped = 0;
      const now = new Date();

      clusters.forEach((c, clusterIndex) => {
        if (c.matchedBookId) return;
        if (room <= 0) {
          skipped++;
          return;
        }
        room--;
        const best = rowById.get(c.bestObservationKey)!;
        const id = crypto.randomUUID();
        inserts.push({
          id,
          collectionId: video.collectionId,
          title: c.title,
          author: c.author,
          spineAuthor: c.spineAuthor,
          spineTitle: c.spineTitle,
          authorSort: authorSortKey(c.author ?? c.spineAuthor),
          titleSort: titleSortKey(c.title),
          publisher: c.publisher,
          source,
          confidence: c.confidence,
          needsReview: c.needsReview,
          bestFrameId: best.frameId,
          bestBbox: best.bbox,
          firstVideoId: video.id,
          firstTimeSec: best.frameTime,
          shelfPosition: video.sortOrder * 100000 + clusterIndex,
          detectionCount: c.observationKeys.length,
          createdAt: now,
          updatedAt: now,
        });
        newBookIds.push(id);
        assignments.push({ bookId: id, detectionIds: c.observationKeys });
      });
      if (skipped) {
        console.warn('[merge] MAX_BOOKS_PER_COLLECTION reached, clusters left unassigned', {
          collectionId: video.collectionId,
          videoId,
          skipped,
          max: maxBooks,
        });
      }
      for (const part of chunk(inserts, 200)) await tx.insert(books).values(part);

      // matched existing books
      const matched = clusters.filter((c) => c.matchedBookId);
      if (matched.length) {
        const ids = matched.map((c) => c.matchedBookId!);
        const lockedRows: BookRow[] = [];
        for (const part of chunk(ids, 500)) {
          lockedRows.push(...(await tx.select().from(books).where(inArray(books.id, part)).for('update')));
        }
        const byId = new Map(lockedRows.map((b) => [b.id, b]));
        for (const c of matched) {
          const book = byId.get(c.matchedBookId!);
          if (!book) continue;
          const guard = ownerEditedFields(book);
          const can = (field: string) => !isFieldProtected(guard, field);
          const best = rowById.get(c.bestObservationKey)!;
          const patch: Partial<NewBookRow> = {
            detectionCount: book.detectionCount + c.observationKeys.length,
            updatedAt: now,
          };
          const better = c.confidence > book.confidence;
          if (better) patch.confidence = c.confidence;
          if (best.bbox && best.frameId && (better || !book.bestBbox || !book.bestFrameId)) {
            patch.bestFrameId = best.frameId;
            patch.bestBbox = best.bbox;
          }
          if (!book.firstVideoId) {
            patch.firstVideoId = video.id;
            patch.firstTimeSec = best.frameTime;
          }
          if (can('author') && !book.author && c.author) {
            patch.author = c.author;
            patch.authorSort = authorSortKey(c.author, book.language);
          }
          if (can('spineAuthor') && !book.spineAuthor && c.spineAuthor) patch.spineAuthor = c.spineAuthor;
          if (can('spineTitle') && !book.spineTitle && c.spineTitle) patch.spineTitle = c.spineTitle;
          if (can('publisher') && !book.publisher && c.publisher) patch.publisher = c.publisher;
          if (!guard.reviewed && book.needsReview && !c.needsReview) patch.needsReview = false;
          await tx.update(books).set(patch).where(eq(books.id, book.id));
          updatedBookIds.push(book.id);
          assignments.push({ bookId: book.id, detectionIds: c.observationKeys });
        }
      }

      for (const a of assignments) {
        for (const part of chunk(a.detectionIds, 500)) {
          await tx
            .update(detections)
            .set({ bookId: a.bookId })
            .where(and(inArray(detections.id, part), isNull(detections.bookId)));
        }
      }
    }

    const [{ n: found }] = await tx
      .select({ n: sql<number>`count(distinct ${detections.bookId})::int` })
      .from(detections)
      .where(eq(detections.videoId, videoId));
    await tx.update(videos).set({ booksFound: Number(found) }).where(eq(videos.id, videoId));
    if (newBookIds.length || updatedBookIds.length) {
      await tx.update(collections).set({ updatedAt: new Date() }).where(eq(collections.id, video.collectionId));
    }
    return { newBookIds, updatedBookIds: [...new Set(updatedBookIds)] };
  });

  console.info('[merge] video merged', {
    videoId,
    collectionId: video.collectionId,
    newBooks: result.newBookIds.length,
    updatedBooks: result.updatedBookIds.length,
    llmLinks: extraLinks.length,
  });
  return result;
}
