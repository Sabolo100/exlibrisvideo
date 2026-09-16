/**
 * Pure text helpers shared by merge, enrichment, API (sort keys) and exports.
 * Owner: merge-enrich. No I/O, no dependencies besides `fastest-levenshtein`.
 *
 * Conventions
 * - "fold" = lower-case, accents removed (ő→o, ű→u, á→a …), apostrophes dropped, every other
 *   non letter/digit character turned into a single space, trimmed.
 * - Hungarian names are printed family-name-first ("Esterházy Péter", "LENGYEL DÉNES"), foreign
 *   names given-name-first ("Elena Ferrante", "H. Perruchot"). Name helpers detect the order with a
 *   compact given-name list plus orthographic heuristics.
 */
import { distance } from 'fastest-levenshtein';

/* ------------------------------------------------------------------ */
/* Folding                                                             */
/* ------------------------------------------------------------------ */

const SPECIAL_LETTERS: Record<string, string> = {
  ß: 'ss',
  æ: 'ae',
  œ: 'oe',
  ø: 'o',
  ł: 'l',
  đ: 'd',
  ð: 'd',
  þ: 'th',
  ı: 'i',
  ħ: 'h',
  ŀ: 'l',
};
const SPECIAL_RE = /[ßæœøłđðþıħŀ]/g;
const APOSTROPHE_RE = /['’‘`´ʼ]/g;
const MARKS_RE = /\p{M}+/gu;
const NON_ALNUM_RE = /[^\p{L}\p{N}]+/gu;

function foldLetters(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKD')
    .replace(MARKS_RE, '')
    .replace(SPECIAL_RE, (ch) => SPECIAL_LETTERS[ch] ?? ch);
}

/** lower-case, accents folded (ő→o, ű→u), punctuation removed, whitespace collapsed */
export function foldForCompare(s: string | null | undefined): string {
  if (!s) return '';
  return foldLetters(s).replace(APOSTROPHE_RE, '').replace(NON_ALNUM_RE, ' ').trim();
}

/** Leading articles ignored for comparison and sorting (only as the first word). */
export const LEADING_ARTICLES: ReadonlySet<string> = new Set([
  'a',
  'az',
  'the',
  'der',
  'die',
  'das',
  'le',
  'la',
  'les',
  'il',
  'el',
]);

/** Drops one leading article from an already folded string ("az uj nev" → "uj nev"); a lone article is kept. */
export function stripLeadingArticle(folded: string): string {
  const sp = folded.indexOf(' ');
  if (sp <= 0) return folded;
  return LEADING_ARTICLES.has(folded.slice(0, sp)) ? folded.slice(sp + 1) : folded;
}

/** Folded comparison form of a title: folded + leading article removed. */
export function normalizeTitle(title: string | null | undefined): string {
  return stripLeadingArticle(foldForCompare(title));
}

/* ------------------------------------------------------------------ */
/* Similarity                                                          */
/* ------------------------------------------------------------------ */

/** 1 − levenshtein / max length (1 for two empty strings). Compares the strings as given. */
export function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - distance(a, b) / max;
}

function tokenize(normalized: string): string[] {
  return normalized ? normalized.split(' ').filter(Boolean) : [];
}

/**
 * Order-insensitive "token-set" ratio on two normalised strings. Tokens common to both are
 * aligned first, near-identical tokens (typos, ratio ≥ 0.75, length ≥ 3) are paired next, and the
 * rebuilt strings are compared with the Levenshtein ratio. Unlike fuzzywuzzy's variant a strict
 * subset does NOT score 1 ("alapitvany" vs "alapitvany es birodalom" are different books).
 */
function tokenSetRatioNormalized(na: string, nb: string): number {
  if (na === nb) return 1;
  const ta = [...new Set(tokenize(na))].sort();
  const tb = [...new Set(tokenize(nb))].sort();
  if (!ta.length || !tb.length) return 0;
  const setB = new Set(tb);
  const common = ta.filter((t) => setB.has(t));
  const commonSet = new Set(common);
  const restA = ta.filter((t) => !commonSet.has(t));
  const restB = tb.filter((t) => !commonSet.has(t));

  const candidates: { a: string; b: string; r: number }[] = [];
  for (const a of restA) {
    if (a.length < 3) continue;
    for (const b of restB) {
      if (b.length < 3) continue;
      const r = levenshteinRatio(a, b);
      if (r >= 0.75) candidates.push({ a, b, r });
    }
  }
  candidates.sort((x, y) => y.r - x.r || (x.a < y.a ? -1 : x.a > y.a ? 1 : x.b < y.b ? -1 : x.b > y.b ? 1 : 0));
  const usedA = new Set<string>();
  const usedB = new Set<string>();
  const pairs: { a: string; b: string }[] = [];
  for (const c of candidates) {
    if (usedA.has(c.a) || usedB.has(c.b)) continue;
    usedA.add(c.a);
    usedB.add(c.b);
    pairs.push(c);
  }
  pairs.sort((x, y) => (x.a < y.a ? -1 : x.a > y.a ? 1 : 0));
  const s1 = [...common, ...pairs.map((p) => p.a), ...restA.filter((t) => !usedA.has(t))].join(' ');
  const s2 = [...common, ...pairs.map((p) => p.b), ...restB.filter((t) => !usedB.has(t))].join(' ');
  return levenshteinRatio(s1, s2);
}

/** Token-set ratio of two raw strings (folded, leading article removed). */
export function tokenSetRatio(a: string, b: string): number {
  return tokenSetRatioNormalized(normalizeTitle(a), normalizeTitle(b));
}

/** titleSimilarity on strings already passed through normalizeTitle() – hot path for clustering. */
export function titleSimilarityNormalized(na: string, nb: string): number {
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  const lev = levenshteinRatio(na, nb);
  if (lev >= 0.999) return lev;
  return Math.max(lev, tokenSetRatioNormalized(na, nb));
}

/** 0..1 similarity of two titles (max of normalised Levenshtein ratio and token-set ratio, articles ignored) */
export function titleSimilarity(a: string, b: string): number {
  return titleSimilarityNormalized(normalizeTitle(a), normalizeTitle(b));
}

/**
 * True when every significant token of the shorter title is (fuzzily) contained in the longer one,
 * e.g. a partial spine reading "Rudolf" of "Rudolf, a trónörökös". Needs ≥ 4 contained letters.
 * Inputs must be normalizeTitle() output.
 */
export function titleContainedNormalized(na: string, nb: string): boolean {
  return titleContainment(na, nb) > 0;
}

/**
 * Share of the longer title's letters covered by the shorter title when the shorter one is contained
 * in it (see titleContainedNormalized), else 0. "Pápai vizeken" in "Pápai vizeken ne kalózkodj!" → 0.5.
 */
export function titleContainment(na: string, nb: string): number {
  const ta = tokenize(na);
  const tb = tokenize(nb);
  if (!ta.length || !tb.length) return 0;
  const la = ta.join('').length;
  const lb = tb.join('').length;
  const [small, large, lSmall, lLarge] = la <= lb ? [ta, tb, la, lb] : [tb, ta, lb, la];
  if (small.length > large.length) return 0;
  const pool = [...large];
  let letters = 0;
  for (const t of small) {
    let best = -1;
    let bestR = 0;
    for (let i = 0; i < pool.length; i++) {
      const r = t === pool[i] ? 1 : t.length >= 3 && pool[i].length >= 3 ? levenshteinRatio(t, pool[i]) : 0;
      if (r > bestR) {
        bestR = r;
        best = i;
      }
    }
    if (best < 0 || bestR < 0.8) return 0;
    pool.splice(best, 1);
    letters += t.length;
  }
  if (letters < 4) return 0;
  return Math.min(1, lSmall / Math.max(1, lLarge));
}

/* ------------------------------------------------------------------ */
/* Volume / number markers                                             */
/* ------------------------------------------------------------------ */

const ROMAN_RE = /^(x{0,3})(ix|iv|v?i{0,3})$/;
const ROMAN_VALUES: Record<string, number> = { i: 1, v: 5, x: 10 };
const HU_ORDINALS: Record<string, number> = {
  elso: 1,
  masodik: 2,
  harmadik: 3,
  negyedik: 4,
  otodik: 5,
  hatodik: 6,
  hetedik: 7,
  nyolcadik: 8,
  kilencedik: 9,
  tizedik: 10,
};

function romanToInt(s: string): number {
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const v = ROMAN_VALUES[s[i]];
    const next = ROMAN_VALUES[s[i + 1]] ?? 0;
    total += v < next ? -v : v;
  }
  return total;
}

/** Numbers that identify a volume / edition inside a title: digits, roman numerals (i–xxxix), Hungarian ordinals. */
export function titleNumbers(title: string | null | undefined): Set<number> {
  const out = new Set<number>();
  for (const tok of tokenize(foldForCompare(title))) {
    if (/^\d+$/.test(tok)) out.add(Number.parseInt(tok, 10));
    else if (tok.length <= 6 && ROMAN_RE.test(tok)) out.add(romanToInt(tok));
    else if (HU_ORDINALS[tok] !== undefined) out.add(HU_ORDINALS[tok]);
  }
  return out;
}

/** True when both titles carry volume/number markers and those differ ("Háború és béke I." vs "… II."). */
export function titleNumbersConflict(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = titleNumbers(a);
  if (!na.size) return false;
  const nb = titleNumbers(b);
  if (!nb.size) return false;
  if (na.size !== nb.size) return true;
  for (const n of na) if (!nb.has(n)) return true;
  return false;
}

/* ------------------------------------------------------------------ */
/* Names                                                               */
/* ------------------------------------------------------------------ */

/** ~160 common Hungarian given names (folded). Used to detect family-name-first order. */
const HU_GIVEN_NAMES: ReadonlySet<string> = new Set(
  (
    // male
    'adam adorjan agoston akos aladar alajos albert alfred andor andras antal arpad attila balazs balint ' +
    'barnabas bela bence benedek bertalan boldizsar botond csaba daniel david denes dezso domokos elek emil ' +
    'endre erno ervin ferenc frigyes fulop gabor gaspar gedeon gergely gergo geza gusztav gyorgy gyozo gyula ' +
    'henrik huba ignac imre istvan ivan jakab janos jeno jozsef kalman karoly kazmer kornel kristof krisztian ' +
    'lajos laszlo lorand lorinc marcell marton mate matyas menyhert mihaly miklos mor nandor norbert odon ' +
    'orban oszkar pal peter rezso robert sandor sebestyen szabolcs szilard tamas tibor tihamer tivadar vazul ' +
    'vencel viktor vilmos vince zoltan zsigmond zsolt abel barna ede egon elemer gellert hugo kolos lehel ' +
    'lorant mark miksa oliver otto pongrac rudolf soma szilveszter todor zeno zsombor ' +
    // female
    'agnes agota aniko anna andrea anita beata borbala brigitta csilla dora dorottya edit emese emma eniko ' +
    'erika erzsebet eszter etelka eva flora gabriella gizella hajnalka hanna ibolya ildiko ilona iren jolan ' +
    'judit julia julianna kata katalin klara krisztina lilla livia magda magdolna margit maria marta melinda ' +
    'monika nora noemi orsolya piroska reka rozsa sara sarolta szilvia terez timea veronika viktoria zita ' +
    'zsofia zsuzsa zsuzsanna aranka bernadett boglarka edina emoke gyongyi irma kinga lenke nikolett petra ' +
    'szabina tunde vanda'
  ).split(' '),
);

/** Common foreign given names (folded) – only used to decide name order, never for nationality. */
const FOREIGN_GIVEN_NAMES: ReadonlySet<string> = new Set(
  (
    'agatha al alan albert aldous alexander alexandre alexandra alice andre andrea andy anne anthony anton ' +
    'antoine antonia arthur ashlee astrid auguste bernardino bill boris bram brian brigitte carl carlos ' +
    'carmine charles charlotte chris colin dan daniel dave david desmond douglas edgar edith edward elena ' +
    'eliot elliot elizabeth emile emily eric erin ernest erich francis franz francois frank fred friedrich ' +
    'fyodor fjodor gabriel george georges gerald guy gunter gustave hans harry haruki heinrich helmuth henri ' +
    'henry hermann honore ian isaac isabel italo jack jacob jacques james jane jean jennifer jerry jim jo ' +
    'johann john jonas jorge jose joseph jules julian karl kathryn ken kurt leo lev lewis lindsey louis lucy ' +
    'marcel margaret mario mark martin mary michael michel miguel mikhail milan neal neil nicholas niccolo ' +
    'nikolai noam oscar orhan pablo pamela patrick paul philip pierre ray raymond richard roald robert roger ' +
    'rudyard salman sarah sigmund simon stanley stefan stephen steve steven sylvia terry thomas tom toni tony ' +
    'truman umberto ursula victor virginia vladimir walter william winston wolfgang yuval'
  ).split(' '),
);

/** Frequent Hungarian family names and classic Hungarian authors (folded). */
const HU_FAMILY_NAMES: ReadonlySet<string> = new Set(
  (
    'nagy kovacs toth szabo horvath varga kiss molnar nemeth farkas balogh papp takacs juhasz lakatos meszaros ' +
    'olah racz fekete szilagyi torok feher gal kis szucs kocsis fodor pinter szalai sipos magyar gulyas biro ' +
    'kiraly katona bogdan boros fazekas kelemen somogyi vincze hegedus deak bakos lengyel jokai moricz petofi ' +
    'arany ady kosztolanyi karinthy mikszath gardonyi madach eotvos szerb esterhazy nadas konrad kertesz ' +
    'weores radnoti illyes orkeny tamasi wass marai krudy babits rejto vorosmarty kolcsey zrinyi szechenyi ' +
    'csath ottlik pilinszky nemes jozsef mora benedek fekete szabo gion spiro darvasi krasznahorkai'
  ).split(' '),
);

const HONORIFICS: ReadonlySet<string> = new Set(['dr', 'prof', 'ifj', 'id', 'jr', 'sr', 'sir', 'dame', 'szerk', 'ed', 'eds']);
/** academic degrees / generational suffixes after a name: "Eric Berne, M.D.", "Martin Luther King, Jr." */
const DEGREE_SUFFIX_RE = /,?\s*\b(?:M\.?\s?D|Ph\.?\s?D|D\.?\s?Sc|Jr|Sr)\.?\s*$/i;

function isGivenName(folded: string): boolean {
  return HU_GIVEN_NAMES.has(folded) || FOREIGN_GIVEN_NAMES.has(folded);
}

interface NameToken {
  raw: string;
  folded: string;
  initial: boolean;
}

interface ParsedName {
  tokens: NameToken[];
  /** tokens that are not initials */
  words: NameToken[];
  familyFirst: boolean;
  /** true when the order was decided by a strong rule (comma, initials, given-name list) */
  confident: boolean;
  /** number of leading `words` that form the family name when written "Family, Given" */
  commaFamilyWords: number;
}

/** Folds one name token; hyphenated parts are joined ("Saint-Exupéry" → "saintexupery"). */
function foldNameToken(raw: string): string {
  return foldLetters(raw).replace(APOSTROPHE_RE, '').replace(/[^\p{L}\p{N}]+/gu, '');
}

function nameTokens(raw: string): NameToken[] {
  const out: NameToken[] = [];
  // "H.Perruchot" → "H. Perruchot"
  const spaced = raw.replace(/\.(?=\p{L})/gu, '. ');
  for (const piece of spaced.split(/\s+/)) {
    const trimmed = piece.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}.]+$/gu, '');
    if (!trimmed) continue;
    const folded = foldNameToken(trimmed);
    if (!folded) continue;
    if (HONORIFICS.has(folded) && (trimmed.endsWith('.') || folded.length > 2)) continue;
    const initial = folded.length === 1 || (/^\p{L}{1,3}\.$/u.test(trimmed) && folded.length <= 3);
    out.push({ raw: trimmed.replace(/\.$/, initial ? '.' : ''), folded, initial });
  }
  return out;
}

const HU_DOUBLE_ACUTE_RE = /[őűŐŰ]/;
const HU_ACCENT_RE = /[áéíóöúüÁÉÍÓÖÚÜ]/g;
const HU_DIGRAPH_RE = /(cs|sz|zs|gy|ny|ty|ly)/;
const FOREIGN_ORTHO_RE = /(w|x|q|th|ph|ck|ou|ee|oo|ch)/;

/** Heuristic score of how Hungarian a two-word name looks (≥ 1.5 → Hungarian family-first order). */
function hungarianScore(first: NameToken, last: NameToken, language?: string | null): number {
  let score = 0;
  const rawBoth = `${first.raw} ${last.raw}`;
  if (HU_DOUBLE_ACUTE_RE.test(rawBoth)) score += 2;
  score += Math.min(1, (rawBoth.match(HU_ACCENT_RE)?.length ?? 0) * 0.5);
  if (HU_DIGRAPH_RE.test(first.folded)) score += 0.5;
  if (HU_DIGRAPH_RE.test(last.folded)) score += 0.25;
  if (FOREIGN_ORTHO_RE.test(first.folded) || FOREIGN_ORTHO_RE.test(last.folded)) score -= 1;
  if (language && language.toLowerCase().startsWith('hu')) score += 0.5;
  return score;
}

function parsePerson(person: string, language?: string | null): ParsedName | null {
  const commaIdx = person.indexOf(',');
  if (commaIdx > 0) {
    const familyPart = nameTokens(person.slice(0, commaIdx));
    const givenPart = nameTokens(person.slice(commaIdx + 1));
    if (familyPart.length) {
      const tokens = [...familyPart, ...givenPart];
      const words = tokens.filter((t) => !t.initial);
      return {
        tokens,
        words: words.length ? words : tokens,
        familyFirst: true,
        confident: true,
        commaFamilyWords: Math.max(1, familyPart.filter((t) => !t.initial).length),
      };
    }
  }
  const tokens = nameTokens(person);
  if (!tokens.length) return null;
  const words = tokens.filter((t) => !t.initial);
  if (words.length <= 1) {
    // single word (maybe with initials): it is the family name; initials before it → Western order
    const firstIsInitial = tokens[0].initial && words.length === 1;
    return {
      tokens,
      words: words.length ? words : tokens,
      familyFirst: !firstIsInitial,
      confident: true,
      commaFamilyWords: 0,
    };
  }
  const first = words[0];
  const last = words[words.length - 1];
  const fGiven = isGivenName(first.folded);
  const lGiven = isGivenName(last.folded);
  const leadingInitial = tokens[0].initial && !tokens[tokens.length - 1].initial;
  const trailingInitial = tokens[tokens.length - 1].initial && !tokens[0].initial;
  let familyFirst: boolean;
  let confident = true;
  if (HU_GIVEN_NAMES.has(last.folded) && !fGiven) {
    familyFirst = true; // "Gy. Szabó Béla", "Esterházy Péter"
  } else if (leadingInitial) {
    familyFirst = false; // leading initials: given-name-first order ("J. R. R. Tolkien", "H. G. Wells")
  } else if (trailingInitial) {
    familyFirst = true; // "Esterházy P."
  } else if (lGiven && !fGiven) {
    if (HU_GIVEN_NAMES.has(last.folded)) familyFirst = true;
    else {
      // a foreign given name at the end is often a family name too ("Dylan Thomas", "Henry James")
      confident = false;
      familyFirst = hungarianScore(first, last, language) >= 1.5;
    }
  } else if (fGiven && !lGiven) familyFirst = false;
  else if (fGiven && lGiven) {
    const fHu = HU_GIVEN_NAMES.has(first.folded);
    const lHu = HU_GIVEN_NAMES.has(last.folded);
    if (lHu && !fHu) familyFirst = true;
    else if (fHu && !lHu) familyFirst = false;
    else {
      confident = false;
      familyFirst = fHu && lHu ? true : hungarianScore(first, last, language) >= 1.5;
    }
  } else {
    const fFam = HU_FAMILY_NAMES.has(first.folded);
    const lFam = HU_FAMILY_NAMES.has(last.folded);
    if (fFam && !lFam) familyFirst = true;
    else if (lFam && !fFam) familyFirst = false;
    else {
      confident = false;
      familyFirst = hungarianScore(first, last, language) >= 1.5;
    }
  }
  return { tokens, words, familyFirst, confident, commaFamilyWords: 0 };
}

function parseAuthors(author: string | null | undefined, language?: string | null): ParsedName[] {
  return splitAuthors(author)
    .map((p) => parsePerson(p, language))
    .filter((p): p is ParsedName => p !== null);
}

function primaryFamily(p: ParsedName): NameToken {
  if (p.commaFamilyWords > 0) return p.words[p.commaFamilyWords - 1];
  return p.familyFirst ? p.words[0] : p.words[p.words.length - 1];
}

/** All folded strings that may be the family name of a parsed person (for tolerant comparison). */
function familyCandidates(p: ParsedName): string[] {
  const out = new Set<string>();
  const w = p.words.map((t) => t.folded);
  if (p.commaFamilyWords > 0) {
    const fam = w.slice(0, p.commaFamilyWords);
    out.add(fam.join(''));
    for (const f of fam) if (!isGivenName(f) || fam.length === 1) out.add(f);
    return [...out];
  }
  out.add(primaryFamily(p).folded);
  if (w.length >= 2) {
    if (!p.confident) {
      out.add(p.familyFirst ? w[w.length - 1] : w[0]);
    }
    // compound family names: "García Márquez", "Saint Exupéry" (read with a space)
    if (w.length >= 3 || !p.confident) {
      if (p.familyFirst) out.add(w[0] + w[1]);
      else out.add(w[w.length - 2] + w[w.length - 1]);
    }
  }
  return [...out];
}

/** Rough cross-language phonetic fold for family names ("Tolsztoj" ≈ "Tolstoy", "Csehov" ≈ "Chekhov"). */
function phoneticFold(s: string): string {
  return s
    .replace(/tsch/g, 'c')
    .replace(/sch/g, 's')
    .replace(/kh/g, 'h')
    .replace(/sz/g, 's')
    .replace(/cz/g, 'c')
    .replace(/cs/g, 'c')
    .replace(/ch/g, 'c')
    .replace(/zs/g, 'z')
    .replace(/tz/g, 'c')
    .replace(/ts/g, 'c')
    .replace(/ck/g, 'k')
    .replace(/ph/g, 'f')
    .replace(/th/g, 't')
    .replace(/qu/g, 'kv')
    .replace(/x/g, 'ks')
    .replace(/w/g, 'v')
    .replace(/ou/g, 'u')
    .replace(/[yj]/g, 'i')
    .replace(/(.)\1+/g, '$1');
}

/** Similarity of two folded family names: max of plain and phonetic Levenshtein ratio. */
export function familyNameSimilarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  return Math.max(levenshteinRatio(a, b), levenshteinRatio(phoneticFold(a), phoneticFold(b)));
}

function personsCompatible(a: ParsedName, b: ParsedName): boolean {
  const ca = familyCandidates(a);
  const cb = familyCandidates(b);
  for (const x of ca) for (const y of cb) if (familyNameSimilarity(x, y) >= 0.8) return true;
  return false;
}

/**
 * Splits a multi-author string: "A; B", "A és B", "A and B", "A & B", "A - B", "A / B", "A, B".
 * A single comma between a family name and given names/initials ("Perruchot, Henri") is kept as one
 * person. Returns trimmed raw parts.
 */
export function splitAuthors(author: string | null | undefined): string[] {
  if (!author) return [];
  const coarse = author
    .split(/\s*[;|/]\s*|\s+(?:és|es|and|und|et|&)\s+|\s+-\s+|\s*[–—]\s*/iu)
    .map((p) => p.replace(DEGREE_SUFFIX_RE, ''))
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  for (const part of coarse) {
    if (!part.includes(',')) {
      out.push(part);
      continue;
    }
    const pieces = part
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
    if (pieces.length === 2 && isInvertedName(pieces[0], pieces[1])) {
      out.push(`${pieces[0]}, ${pieces[1]}`);
    } else {
      out.push(...pieces);
    }
  }
  return out.filter((p) => foldForCompare(p) !== '');
}

function isInvertedName(left: string, right: string): boolean {
  const l = nameTokens(left);
  const r = nameTokens(right);
  if (!l.length || !r.length || l.length > 3 || r.length > 3) return false;
  if (r.every((t) => t.initial || isGivenName(t.folded))) {
    // "Kiss, Nagy" style lists never have only given names on the right, but "Anna, Mária" has
    // given names on both sides → treat as two people
    return !l.every((t) => isGivenName(t.folded) && !HU_FAMILY_NAMES.has(t.folded));
  }
  return false;
}

/** true when either is missing or the family names match (≥ 0.8), handles "H. Perruchot" vs "Henri Perruchot", Hungarian order */
export function authorsCompatible(a: string | null | undefined, b: string | null | undefined): boolean {
  const pa = parseAuthors(a);
  if (!pa.length) return true;
  const pb = parseAuthors(b);
  if (!pb.length) return true;
  for (const x of pa) for (const y of pb) if (personsCompatible(x, y)) return true;
  return false;
}

/**
 * Family name of the (first) author as written, e.g. "Esterházy Péter" → "Esterházy",
 * "H. Perruchot" → "Perruchot", "García Márquez, Gabriel" → "García Márquez". null when missing.
 */
export function familyName(author: string | null | undefined, language?: string | null): string | null {
  const p = parseAuthors(author, language)[0];
  if (!p) return null;
  if (p.commaFamilyWords > 0) {
    return p.words
      .slice(0, p.commaFamilyWords)
      .map((t) => t.raw)
      .join(' ');
  }
  return primaryFamily(p).raw.replace(/\.$/, '');
}

/**
 * true when the (first) author looks like a Hungarian name printed in Hungarian family-name-first
 * order ("Esterházy Péter", "LENGYEL DENES"); false for given-name-first names ("Elena Ferrante",
 * "H. Perruchot", "Péter Esterházy") and for missing / single-word names.
 */
export function isLikelyHungarianName(author: string | null | undefined, language?: string | null): boolean {
  const p = parseAuthors(author, language)[0];
  if (!p || p.words.length < 2 || p.commaFamilyWords > 0) return false;
  return p.familyFirst;
}

function personSortKey(p: ParsedName): string {
  const folded = p.tokens.map((t) => t.folded);
  if (p.commaFamilyWords > 0 || p.familyFirst) return folded.join(' ');
  const fam = primaryFamily(p);
  const idx = p.tokens.indexOf(fam);
  return [fam.folded, ...folded.filter((_, i) => i !== idx)].join(' ');
}

/** family-name-first folded sort key, e.g. "Elena Ferrante" → "ferrante elena", "Esterházy Péter" → "esterhazy peter" */
export function authorSortKey(author: string | null | undefined, language?: string | null): string | null {
  const people = parseAuthors(author, language);
  if (!people.length) return null;
  const key = people
    .map(personSortKey)
    .filter(Boolean)
    .join('; ');
  return key || null;
}

/** folded title without leading article ("A", "Az", "The", …) */
export function titleSortKey(title: string): string {
  return normalizeTitle(title);
}

/* ------------------------------------------------------------------ */
/* Display casing                                                      */
/* ------------------------------------------------------------------ */

function isAllCaps(s: string): boolean {
  let cased = 0;
  for (const ch of s) {
    const lo = ch.toLowerCase();
    const up = ch.toUpperCase();
    if (lo === up) continue;
    if (ch !== up) return false;
    cased++;
  }
  return cased >= 2;
}

/** "LENGYEL DÉNES" → "Lengyel Dénes"; strings that are not all upper-case are returned unchanged. */
export function nameCase(s: string): string {
  if (!isAllCaps(s)) return s;
  let first = true;
  return s
    .split(/(\s+)/)
    .map((part) => {
      if (!part.trim()) return part;
      const lower = part.toLowerCase();
      const isParticle = !first && NAME_PARTICLES.has(lower);
      first = false;
      if (isParticle) return lower;
      return lower.replace(/(^|[\-'’.(])(\p{L})/gu, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
    })
    .join('');
}

const NAME_PARTICLES: ReadonlySet<string> = new Set(['de', 'da', 'di', 'du', 'del', 'della', 'der', 'den', 'van', 'von', 'le', 'la', 'y', 'e', 'és']);

const ROMAN_UPPER_RE = /^(X{0,3})(IX|IV|V?I{0,3})$/;

/** "RÉGI MAGYAR MONDÁK" → "Régi magyar mondák" (roman numerals kept); mixed-case strings unchanged. */
export function sentenceCase(s: string): string {
  if (!isAllCaps(s)) return s;
  const parts = s.split(/(\s+)/);
  let capitalizeNext = true;
  const out: string[] = [];
  for (const part of parts) {
    if (!part || /^\s+$/.test(part)) {
      out.push(part);
      continue;
    }
    const core = part.replace(/[^\p{L}\p{N}]/gu, '');
    const isNumeral = core !== '' && (ROMAN_UPPER_RE.test(core) || /^\d+$/.test(core));
    let word = isNumeral ? part : part.toLowerCase();
    if (capitalizeNext && !isNumeral) {
      word = word.replace(/\p{L}/u, (ch) => ch.toUpperCase());
    }
    if (core !== '' || /[-–—]/.test(part)) {
      // Hungarian ordinals ("II. kötet", "2. kiadás") do not end a sentence
      const endsSentence = /[!?:]$/.test(part) || (/\.$/.test(part) && !isNumeral && core.length > 1);
      capitalizeNext = endsSentence || /^[-–—]$/.test(part);
    }
    out.push(word);
  }
  return out.join('');
}
