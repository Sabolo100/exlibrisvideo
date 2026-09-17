import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mh = vi.hoisted(() => ({ maxBooks: 5000, judge: null as null | ((q: unknown[]) => unknown) }));

vi.mock('@/lib/env', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/env')>();
  return { ...actual, env: () => ({ ...actual.env(), MAX_BOOKS_PER_COLLECTION: mh.maxBooks }) };
});
vi.mock('@/lib/ai', () => ({
  getTextProvider: () => ({
    name: 'mock',
    model: 'judge-model',
    classifyBooks: async () => {
      throw new Error('not used');
    },
    judgeDuplicates: async (questions: unknown[]) => {
      if (!mh.judge) throw new Error('judge unavailable');
      return mh.judge(questions);
    },
  }),
}));
vi.mock('@/lib/ai/usage', () => ({ recordUsage: vi.fn(async () => {}) }));
vi.mock('./vision-step', () => ({ getCanonicalHints: () => new Map() }));

import { db, pool } from '@/db';
import { books, collections, detections, frames, videos, type BookRow } from '@/db/schema';
import type { DuplicateQuestion } from '@/lib/ai/types';
import { recordUsage } from '@/lib/ai/usage';
import type { BBox } from '@/lib/types';
import {
  clusterObservations,
  detectionsToObservations,
  isFieldProtected,
  mergeVideoDetections,
  ownerEditedFields,
  type ExistingBookRef,
  type MergeCluster,
  type MergeObservation,
} from './merge';

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

let keySeq = 0;
function ob(
  frameOrder: number,
  orderInFrame: number,
  title: string,
  author: string | null = null,
  extra: Partial<MergeObservation> = {},
): MergeObservation {
  return {
    key: extra.key ?? `k${++keySeq}`,
    frameOrder,
    orderInFrame,
    author,
    title,
    canonicalAuthor: null,
    canonicalTitle: null,
    publisher: null,
    confidence: 0.9,
    hasBbox: true,
    ...extra,
  };
}

/** frames of spine lists: each spine is [title, author?] */
function framesToObs(frames: Array<Array<[string, (string | null)?]>>, conf = 0.9): MergeObservation[] {
  const out: MergeObservation[] = [];
  frames.forEach((spines, f) => {
    spines.forEach(([title, author], i) => out.push(ob(f, i + 1, title, author ?? null, { confidence: conf })));
  });
  return out;
}

const titles = (cs: MergeCluster[]) => cs.map((c) => c.title);

/** mulberry32 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ------------------------------------------------------------------ */
/* basic behaviour                                                     */
/* ------------------------------------------------------------------ */

describe('clusterObservations – basics', () => {
  it('returns [] for empty input and drops empty titles', () => {
    expect(clusterObservations([])).toEqual([]);
    const cs = clusterObservations([ob(0, 1, ''), ob(0, 2, '   '), ob(0, 3, '!!!'), ob(1, 1, 'Alapítvány', 'Isaac Asimov')]);
    expect(titles(cs)).toEqual(['Alapítvány']);
  });

  it('4 overlapping frames with spines shifting position → one cluster per spine in shelf order', () => {
    const shelf: Array<[string, string]> = [
      ['Az új név története', 'Elena Ferrante'],
      ['Aki megszökik és aki marad', 'Elena Ferrante'],
      ['Az elvesztett gyerek története', 'Elena Ferrante'],
      ['Az Alapítvány barátai', 'Asimov'],
      ['Rokonok', 'Móricz Zsigmond'],
      ['Levelek Lilynek', 'Alan Macfarlane'],
      ['Az éjfél gyermekei', 'Salman Rushdie'],
    ];
    const frames = [0, 1, 2, 3].map((f) => shelf.slice(f, f + 4));
    const cs = clusterObservations(framesToObs(frames));
    expect(titles(cs)).toEqual(shelf.map((s) => s[0]));
    expect(cs.map((c) => c.observationKeys.length)).toEqual([1, 2, 3, 4, 3, 2, 1]);
    expect(cs.map((c) => c.firstFrameOrder)).toEqual([0, 0, 0, 0, 1, 2, 3]);
    // seen in ≥ 2 frames → +0.1
    expect(cs[0].confidence).toBeCloseTo(0.9, 5);
    expect(cs[1].confidence).toBeCloseTo(1, 5);
    expect(cs.every((c) => !c.needsReview)).toBe(true);
    expect(cs.every((c) => c.matchedBookId === null)).toBe(true);
  });

  it('merges noisy readings: accents, casing, typos, missing authors', () => {
    const cs = clusterObservations([
      ob(0, 1, 'PAPAI VIZEKEN NE KALOZKODJ', 'ESTERHAZY PETER'),
      ob(0, 2, 'Gauguin élete', 'H. Perruchot'),
      ob(1, 1, 'Pápai vizeken ne kalózkodj!', 'Esterházy Péter'),
      ob(1, 2, 'GAUGIN ELETE', null),
      ob(2, 1, 'Pápai vizeken ne kalózkodj!', null),
      ob(2, 2, 'Gauguin élete', 'Henri Perruchot'),
    ]);
    expect(cs).toHaveLength(2);
    expect(cs[0].title).toBe('Pápai vizeken ne kalózkodj!');
    expect(cs[0].author).toBe('Esterházy Péter');
    expect(cs[0].spineTitle).toBe('Pápai vizeken ne kalózkodj!');
    expect(cs[1].title).toBe('Gauguin élete');
    expect(cs[1].author).toMatch(/Perruchot/);
  });

  it('prefers the accented reading and transfers real casing to all-caps spines', () => {
    const cs = clusterObservations([
      ob(0, 1, 'RUDOLF, A TRÓNÖRÖKÖS', 'HAMANN'),
      ob(1, 1, 'Rudolf, a tronorokos', 'Hamann'),
      ob(2, 1, 'RUDOLF, A TRÓNÖRÖKÖS', 'HAMANN'),
    ]);
    expect(cs).toHaveLength(1);
    expect(cs[0].title).toBe('Rudolf, a trónörökös');
    expect(cs[0].spineTitle).toBe('RUDOLF, A TRÓNÖRÖKÖS');
    expect(cs[0].author).toBe('Hamann');
    expect(cs[0].spineAuthor).toBe('HAMANN');
  });

  it('sentence-cases all-caps titles without a mixed-case reading', () => {
    const cs = clusterObservations([ob(0, 1, 'RÉGI MAGYAR MONDÁK', 'LENGYEL DÉNES'), ob(1, 1, 'RÉGI MAGYAR MONDÁK', 'LENGYEL DÉNES')]);
    expect(cs[0].title).toBe('Régi magyar mondák');
    expect(cs[0].author).toBe('Lengyel Dénes');
  });

  it('same title with one author null merges', () => {
    const cs = clusterObservations([ob(0, 1, 'A Lusitania elsüllyesztése', 'Colin Simpson'), ob(1, 1, 'A Lusitania elsüllyesztése', null)]);
    expect(cs).toHaveLength(1);
    expect(cs[0].author).toBe('Colin Simpson');
  });

  it('identical titles by clearly different authors do not merge', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Versek', 'Petőfi Sándor'),
      ob(1, 1, 'Rokonok', 'Móricz Zsigmond'),
      ob(2, 1, 'Emberi játszmák', 'Eric Berne'),
      ob(3, 1, 'Versek', 'Ady Endre'),
    ]);
    expect(cs).toHaveLength(4);
    expect(cs.filter((c) => c.title === 'Versek').map((c) => c.author)).toEqual(['Petőfi Sándor', 'Ady Endre']);
  });

  it('a null-author reading between two same-title books by different authors never chains them', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Versek', 'Petőfi Sándor', { key: 'p1' }),
      ob(1, 1, 'Versek', null, { key: 'n1' }),
      ob(2, 1, 'Versek', 'Ady Endre', { key: 'a1' }),
    ]);
    const withP = cs.find((c) => c.observationKeys.includes('p1'))!;
    const withA = cs.find((c) => c.observationKeys.includes('a1'))!;
    expect(withP).not.toBe(withA);
  });

  it('different books by the same author sharing words do not merge', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Az új név története', 'Elena Ferrante'),
      ob(1, 1, 'Az elveszett gyerek tortenete', 'Elena Ferrante'),
      ob(2, 1, 'Az elvesztett gyerek története', 'ELENA FERRANTE'),
      ob(3, 1, 'AZ ÚJ NÉV TÖRTÉNETE', 'ELENA FERRANTE'),
    ]);
    // the two readings of vol. 4 merge; vol. 2 merges with its own caps reading
    expect(cs).toHaveLength(2);
    expect(cs.map((c) => c.observationKeys.length).sort()).toEqual([2, 2]);
  });

  it('series titles that contain each other stay separate books', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Alapítvány', 'Isaac Asimov'),
      ob(0, 2, 'Alapítvány és Birodalom', 'Isaac Asimov'),
      ob(0, 3, 'Második Alapítvány', 'Isaac Asimov'),
      ob(5, 1, 'Alapítvány', 'Asimov'),
      ob(6, 1, 'Alapítvány és Birodalom', null),
      ob(7, 1, 'Második Alapítvány', 'ASIMOV'),
    ]);
    expect(cs).toHaveLength(3);
    expect(cs.every((c) => c.observationKeys.length === 2)).toBe(true);
  });

  it('different volume numbers never merge', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Háború és béke I.', 'Tolsztoj'),
      ob(1, 1, 'Háború és béke II.', 'Tolsztoj'),
      ob(2, 1, 'HÁBORÚ ÉS BÉKE II', 'Lev Tolsztoj'),
    ]);
    expect(cs).toHaveLength(2);
    expect(cs[1].observationKeys).toHaveLength(2);
    expect(cs[1].title).toBe('Háború és béke II.');
  });

  it('two identical copies side by side in the same frames stay two books', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Rokonok', 'Móricz Zsigmond'], ['Anya, taníts engem!', 'Deákné B. Katalin'], ['Anya, taníts engem!', 'Deákné B. Katalin'], ['Freud húga', 'Goce Smilevski']],
        [['Anya, taníts engem!', 'Deákné B. Katalin'], ['Anya, taníts engem!', 'Deákné B. Katalin'], ['Freud húga', 'Goce Smilevski'], ['Bázis', 'Robert Charles Wilson']],
        [['Anya, taníts engem!', null], ['Freud húga', 'Goce Smilevski'], ['Bázis', 'Robert Charles Wilson']],
      ]),
    );
    expect(titles(cs)).toEqual(['Rokonok', 'Anya, taníts engem!', 'Anya, taníts engem!', 'Freud húga', 'Bázis']);
    expect(cs[1].observationKeys.length + cs[2].observationKeys.length).toBe(5);
  });

  it('a spine listed twice in one frame (phantom twin, real DeepSeek output) joins its twin', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Új és régi', 'Jókai Anna'], ['Válogatott elbeszélések', 'Erdélyi János'], ['A szőkékkel mindig baj van', 'Vaszary Gábor']],
        [['Új és régi', 'Jókai Anna'], ['Válogatott elbeszélések', 'Erdélyi János'], ['A szőkékkel mindig baj van', 'Vaszary Gábor']],
        [['Válogatott elbeszélések', 'Erdélyi János'], ['Válogatott elbeszélések', 'Erdélyi János'], ['A szőkékkel mindig baj van', 'Vaszary Gábor'], ['Az emberi butaság', 'Ráth-Végh István']],
        [['Válogatott elbeszélések', 'Erdélyi János'], ['A szőkékkel mindig baj van', 'Vaszary Gábor'], ['Az emberi butaság', 'Ráth-Végh István']],
      ]),
    );
    expect(cs.filter((c) => c.title === 'Válogatott elbeszélések')).toHaveLength(1);
    expect(cs.find((c) => c.title === 'Válogatott elbeszélések')!.observationKeys).toHaveLength(5);
  });

  it('a phantom reading with the author of the neighbouring spine joins its twin without spoiling the author', () => {
    const cs = clusterObservations(
      framesToObs([
        [['A szőkékkel mindig baj van', 'Vaszary Gábor'], ['Az emberi butaság', 'Ráth-Végh István'], ['Spielberg', 'John Baxter']],
        [['A szőkékkel mindig baj van', 'Vaszary Gábor'], ['Az emberi butaság', 'Ráth-Végh István'], ['Spielberg', 'John Baxter']],
        [['Az emberi butaság', 'Vaszary Gábor'], ['Az emberi butaság', 'Ráth-Végh'], ['Spielberg', 'John Baxter']],
        [['Az emberi butaság', 'Ráth-Végh'], ['Spielberg', 'John Baxter'], ['Cézanne élete', 'H. Perruchot']],
      ]),
    );
    expect(titles(cs)).toEqual(['A szőkékkel mindig baj van', 'Az emberi butaság', 'Spielberg', 'Cézanne élete']);
    expect(cs[1]).toMatchObject({ author: 'Ráth-Végh István', needsReview: false });
    expect(cs[1].observationKeys).toHaveLength(5);
  });

  it('same title by another author in one frame without neighbour evidence stays a separate book', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Rokonok', 'Móricz Zsigmond'], ['Versek', 'Petőfi Sándor'], ['Egri csillagok', 'Gárdonyi Géza']],
        [['Versek', 'Petőfi Sándor'], ['Versek', 'Ady Endre'], ['Egri csillagok', 'Gárdonyi Géza']],
        [['Versek', 'Petőfi Sándor'], ['Egri csillagok', 'Gárdonyi Géza'], ['Tüskevár', 'Fekete István']],
        [['Versek', 'Petőfi Sándor'], ['Egri csillagok', 'Gárdonyi Géza'], ['Tüskevár', 'Fekete István']],
      ]),
    );
    expect(cs.filter((c) => c.title === 'Versek').map((c) => c.author)).toEqual(['Petőfi Sándor', 'Ady Endre']);
  });

  it('a partial reading at the same slot, anchored by a matching neighbour, merges', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Gauguin élete', 'H. Perruchot'], ['Pápai vizeken ne kalózkodj!', 'Esterházy Péter'], ['Régi magyar mondák', 'Lengyel Dénes']],
        [['Gauguin élete', 'H. Perruchot'], ['PAPAI VIZEKEN', null], ['Régi magyar mondák', 'Lengyel Dénes']],
      ]),
    );
    expect(titles(cs)).toEqual(['Gauguin élete', 'Pápai vizeken ne kalózkodj!', 'Régi magyar mondák']);
  });

  it('a short title of a neighbouring book is not merged positionally into a longer one', () => {
    // frame 0 misses Sadie's "Mozart", frame 1 misses Parouty's "Mozart, az Isten kegyeltje"
    const cs = clusterObservations(
      framesToObs([
        [['Teller háborúja', 'William J. Broad'], ['Mozart, az Isten kegyeltje'], ['Fleming és a penicillin regénye', 'A. Maurois']],
        [['Teller háborúja', 'William J. Broad'], ['Mozart', 'Sadie'], ['Fleming és a penicillin regénye', 'A. Maurois']],
      ]),
    );
    expect(titles(cs)).toEqual(['Teller háborúja', 'Mozart, az Isten kegyeltje', 'Mozart', 'Fleming és a penicillin regénye']);
  });

  it('a lone partial reading elsewhere stays separate but is flagged as a near-duplicate', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Rudolf, a trónörökös', 'Brigitte Hamann'),
      ob(1, 1, 'Rudolf, a trónörökös', 'Brigitte Hamann'),
      ob(9, 1, 'Rudolf', null),
    ]);
    expect(cs).toHaveLength(2);
    expect(cs[0].ambiguousWith).toEqual([1]);
    expect(cs[1].ambiguousWith).toEqual([0]);
  });

  it('extraLinks force two clusters together', () => {
    const obs = [ob(0, 1, 'Rudolf, a trónörökös', 'Brigitte Hamann', { key: 'a' }), ob(9, 1, 'Rudolf', null, { key: 'b' })];
    expect(clusterObservations(obs)).toHaveLength(2);
    const merged = clusterObservations(obs, [], { extraLinks: [['a', 'b']] });
    expect(merged).toHaveLength(1);
    expect(merged[0].title).toBe('Rudolf, a trónörökös');
  });

  it('spines of the same frame are never flagged as near-duplicates of each other', () => {
    const cs = clusterObservations([ob(0, 1, 'Mozart, az Isten kegyeltje', null), ob(0, 2, 'Mozart', 'Sadie')]);
    expect(cs).toHaveLength(2);
    expect(cs[0].ambiguousWith).toEqual([]);
  });

  it('frames read twice by overlapping vision batches do not create duplicates', () => {
    // frame 3 is the overlap of batch 1 (frames 0-3) and batch 2 (frames 3-6)
    const shelf = ['Csontbrigád', 'The Committed', 'A gólyakalifa', 'Abaddon kapuja', 'Factfulness', 'On the Road'];
    const obs: MergeObservation[] = [];
    for (let f = 0; f < 5; f++) {
      const visible = shelf.slice(f, f + 3);
      const passes = f === 3 ? 2 : 1;
      for (let p = 0; p < passes; p++) visible.forEach((t, i) => obs.push(ob(f, i + 1, p === 1 ? t.toUpperCase() : t)));
    }
    const cs = clusterObservations(obs);
    expect(titles(cs)).toEqual(shelf);
  });

  it('detects a right-to-left pan and still returns physical left-to-right order', () => {
    const shelf = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((l, i) => `${l} könyv ${['alma', 'körte', 'szilva', 'barack', 'meggy', 'eper', 'dinnye'][i]}`);
    // camera moves left: first frame shows the right end
    const frames = [3, 2, 1, 0].map((s) => shelf.slice(s, s + 4).map((t): [string] => [t]));
    const cs = clusterObservations(framesToObs(frames));
    expect(titles(cs)).toEqual(shelf);
  });

  it('canonical values win only when confirmed by 2 observations or confidence ≥ 0.8', () => {
    const weak = clusterObservations([
      ob(0, 1, 'Tanulmany vorosben', 'Doyle', { canonicalTitle: 'Tanulmány vérvörösben', confidence: 0.5 }),
      ob(1, 1, 'Tanulmany vorosben', 'Doyle', { confidence: 0.5 }),
    ]);
    expect(weak[0].title).toBe('Tanulmany vorosben');

    const confirmed = clusterObservations([
      ob(0, 1, 'Tanulmany vorosben', 'Doyle', { canonicalTitle: 'Tanulmány vérvörösben', canonicalAuthor: 'Arthur Conan Doyle', confidence: 0.5 }),
      ob(1, 1, 'Tanulmany vorosben', 'Doyle', { canonicalTitle: 'Tanulmány vérvörösben', canonicalAuthor: 'Arthur Conan Doyle', confidence: 0.5 }),
    ]);
    expect(confirmed[0].title).toBe('Tanulmány vérvörösben');
    expect(confirmed[0].author).toBe('Arthur Conan Doyle');
    expect(confirmed[0].spineTitle).toBe('Tanulmany vorosben');
    expect(confirmed[0].spineAuthor).toBe('Doyle');

    const confident = clusterObservations([
      ob(0, 1, 'ALAPITVANY', 'ASIMOV', { canonicalTitle: 'Alapítvány', canonicalAuthor: 'Isaac Asimov', confidence: 0.85 }),
    ]);
    expect(confident[0].title).toBe('Alapítvány');
    expect(confident[0].author).toBe('Isaac Asimov');
  });

  it('expands a family-name-only reading to the full name when both are read', () => {
    const cs = clusterObservations([ob(0, 1, 'Rudolf, a trónörökös', 'HAMANN'), ob(1, 1, 'Rudolf, a trónörökös', 'Brigitte Hamann')]);
    expect(cs[0].author).toBe('Brigitte Hamann');
  });

  it('needsReview for low confidence, very short titles and conflicting readings', () => {
    expect(clusterObservations([ob(0, 1, 'Bázis', null, { confidence: 0.4 })])[0].needsReview).toBe(true);
    expect(clusterObservations([ob(0, 1, 'Ab', null), ob(1, 1, 'Ab', null)])[0].needsReview).toBe(true);
    const conflict = clusterObservations([
      ob(0, 1, 'Mozart bécsi levelei', null, { canonicalTitle: 'Mozart Bäsle-levelei', confidence: 0.9 }),
      ob(1, 1, 'Mozart bécsi levelei', null, { canonicalTitle: 'Mozart Bäsle-levelei', confidence: 0.9 }),
      ob(2, 1, 'Mozart bécsi levelei', null, { canonicalTitle: 'A varázsfuvola története', confidence: 0.9 }),
    ]);
    expect(conflict).toHaveLength(1);
    expect(conflict[0].needsReview).toBe(true);
    expect(clusterObservations([ob(0, 1, 'Bázis', null, { confidence: 0.55 }), ob(1, 1, 'Bázis', null, { confidence: 0.55 })])[0].needsReview).toBe(false);
  });

  it('best observation prefers a bbox, then confidence, then the middle frame', () => {
    const cs = clusterObservations([
      ob(0, 1, 'Bázis', null, { key: 'a', confidence: 0.95, hasBbox: false }),
      ob(1, 1, 'Bázis', null, { key: 'b', confidence: 0.7 }),
      ob(2, 1, 'Bázis', null, { key: 'c', confidence: 0.7 }),
      ob(3, 1, 'Bázis', null, { key: 'd', confidence: 0.7 }),
    ]);
    expect(cs[0].bestObservationKey).toBe('b');
    const cs2 = clusterObservations([ob(0, 1, 'Bázis', null, { key: 'x', hasBbox: false, confidence: 0.3 }), ob(1, 1, 'Bázis', null, { key: 'y', hasBbox: false, confidence: 0.6 })]);
    expect(cs2[0].bestObservationKey).toBe('y');
  });

  it('is deterministic', () => {
    const obs = framesToObs([
      [['Az új név története', 'Elena Ferrante'], ['Aki megszökik és aki marad', null], ['Rokonok', 'Móricz Zsigmond']],
      [['AZ UJ NEV TORTENETE', null], ['Aki megszokik es aki marad', 'Elena Ferrante'], ['Rokonok', null], ['Csontbrigád', 'Rejtő Jenő']],
    ]);
    const a = clusterObservations(obs);
    const b = clusterObservations(obs.map((o) => ({ ...o })));
    expect(b).toEqual(a);
  });
});

/* ------------------------------------------------------------------ */
/* existing books                                                      */
/* ------------------------------------------------------------------ */

describe('clusterObservations – existing books', () => {
  const existingShelf: ExistingBookRef[] = [
    { id: 'b1', author: 'Henri Perruchot', title: 'Cézanne élete', spineAuthor: 'Perruchot', spineTitle: 'Cézanne élete', shelfPosition: 7 },
    { id: 'b2', author: 'Esterházy Péter', title: 'Pápai vizeken ne kalózkodj!', spineAuthor: 'ESTERHAZY PETER', spineTitle: 'PAPAI VIZEKEN NE KALOZKODJ', shelfPosition: 8 },
    { id: 'b3', author: 'Henri Perruchot', title: 'Gauguin élete', spineAuthor: 'H. Perruchot', spineTitle: 'Gauguin élete', shelfPosition: 9 },
    { id: 'b4', author: 'Brigitte Hamann', title: 'Rudolf – A trónörökös', spineAuthor: 'Hamann', spineTitle: 'Rudolf – A trónörökös', shelfPosition: 10 },
    { id: 'b5', author: 'Lengyel Dénes', title: 'Régi magyar mondák', spineAuthor: 'Lengyel Dénes', spineTitle: 'Régi magyar mondák', shelfPosition: 11 },
    { id: 'b6', author: 'Philip Matyszak', title: 'Antik Róma napi öt denáriusból', spineAuthor: 'Matyszak', spineTitle: 'Antik Róma napi öt denáriusból', shelfPosition: 19 },
  ];

  it('the same shelf filmed again matches existing books (accents, order, casing)', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Kulcskérdések a biológiában', 'John Maynard Smith'], ['Pápai vizeken ne kalózkodj', 'Esterhazy Peter'], ['GAUGUIN ÉLETE', 'H. PERRUCHOT']],
        [['PAPAI VIZEKEN NE KALOZKODJ', null], ['Gauguin elete', 'Perruchot'], ['Rudolf, a trónörökös', 'HAMANN'], ['Régi magyar mondák', 'Dénes Lengyel']],
        [['Rudolf a tronorokos', null], ['Régi magyar mondák', 'Lengyel Dénes'], ['Az ezerarcú én', 'Hankiss Elemér'], ['Tunézia', null]],
      ]),
      existingShelf,
    );
    const byTitle = Object.fromEntries(cs.map((c) => [c.title, c.matchedBookId]));
    expect(byTitle['Pápai vizeken ne kalózkodj']).toBe('b2');
    expect(byTitle['Gauguin élete']).toBe('b3');
    expect(byTitle['Rudolf, a trónörökös']).toBe('b4');
    expect(byTitle['Régi magyar mondák']).toBe('b5');
    expect(byTitle['Kulcskérdések a biológiában']).toBeNull();
    expect(byTitle['Az ezerarcú én']).toBeNull();
  });

  it('a lone title match on another shelf is a second copy, not the existing book', () => {
    const cs = clusterObservations(
      framesToObs([
        [['A holtak küldöttei', 'Adam-Troy Castro'], ['Antik Róma napi öt denariusból', 'Matyszak'], ['Az ellopott futár', 'Rejtő Jenő']],
        [['Antik Róma napi öt denariusból', 'Matyszak'], ['Az ellopott futár', 'Rejtő Jenő'], ['A harcos', 'Stephen King']],
        [['Az ellopott futár', 'Rejtő Jenő'], ['A harcos', 'Stephen King'], ['A vád tanúja', 'Agatha Christie']],
        [['A harcos', 'Stephen King'], ['A vád tanúja', 'Agatha Christie'], ['Korszakhatáron', 'Schmidt Mária']],
      ]),
      existingShelf,
    );
    expect(cs).toHaveLength(6);
    expect(cs.every((c) => c.matchedBookId === null)).toBe(true);
  });

  it('a clip continuing the previous clip matches the overlapping edge books', () => {
    const cs = clusterObservations(
      framesToObs([
        [['Régi magyar mondák', 'Lengyel Dénes'], ['Az én Fellinim', 'Bernardino Zapponi'], ['Julius Caesar', 'Shakespeare']],
        [['Az én Fellinim', 'Bernardino Zapponi'], ['Julius Caesar', 'Shakespeare'], ['Teller háborúja', 'William J. Broad']],
        [['Julius Caesar', 'Shakespeare'], ['Teller háborúja', 'William J. Broad'], ['Spielberg', 'John Baxter']],
        [['Teller háborúja', 'William J. Broad'], ['Spielberg', 'John Baxter'], ['Mozart', 'Sadie']],
      ]),
      existingShelf.slice(0, 5),
    );
    expect(cs[0].matchedBookId).toBe('b5');
    expect(cs.slice(1).every((c) => c.matchedBookId === null)).toBe(true);
  });

  describe('a shelf filmed again (a second video to catch missed books)', () => {
    const firstVideo: ExistingBookRef[] = [
      ['Charles Nicholl', 'Leonardo da Vinci'],
      ['Brian Aldiss', 'A Science Fiction Omnibus'],
      ['Dave Eggers', 'The Circle'],
      ['Jonas Jonasson', 'The Hundred-Year-Old Man Who Climbed Out of the Window and Disappeared'],
      ['John Lanchester', 'Capital'],
      ['Bill Bryson', 'Down Under'],
      [null, 'Second World'],
      ['Ashlee Vance', 'Elon Musk'],
      ['Robert Winston', 'The Human Mind'],
      ['Simon Baron-Cohen', 'The Essential Difference'],
    ].map(([author, title], i) => ({ id: `e${i}`, author, title: title!, spineAuthor: null, spineTitle: null, shelfPosition: i }));

    it('matches partial, swapped and author-backed readings even where the neighbours are misread', () => {
      const J: [string, string] = ['The Hundred Year Old Man', 'Jonas Jonasson'];
      const C: [string, string] = ['Capital', 'John Lanchester'];
      const D: [string, string] = ['Down Under', 'Bill Bryson'];
      const SW: [string] = ['The Second World War'];
      const R: [string, string] = ['The Road to Little Dribbling', 'Bill Bryson'];
      const G: [string] = ['The Girl Who Saved the King of Sweden'];
      const F: [string, string] = ['The Fountains of Paradise', 'Arthur C. Clarke'];
      const E: [string, string] = ['Elon Musk', 'Ashlee Vance'];
      const S: [string, string] = ['Ashlee Vance', 'Elon Musk'];
      const B: [string, string] = ['Games People Play', 'Eric Berne'];
      const W: [string, string] = ['The Swerve', 'Stephen Greenblatt'];
      const cs = clusterObservations(
        framesToObs([
          [J, C, D],
          [C, D, SW],
          [D, SW, R],
          [SW, R, G],
          [R, G, F],
          [G, F, E],
          [F, S, B],
          [S, B, W],
        ]),
        firstVideo,
      );
      const byTitle = Object.fromEntries(cs.map((c) => [`${c.author ?? '–'} – ${c.title}`, c.matchedBookId]));
      expect(byTitle).toEqual({
        'Jonas Jonasson – The Hundred Year Old Man': 'e3',
        'John Lanchester – Capital': 'e4',
        'Bill Bryson – Down Under': 'e5',
        '– – The Second World War': 'e6',
        'Bill Bryson – The Road to Little Dribbling': null,
        '– – The Girl Who Saved the King of Sweden': null,
        'Arthur C. Clarke – The Fountains of Paradise': null,
        // no matching neighbour around it this time, but the video films the first video's shelf again
        'Ashlee Vance – Elon Musk': 'e7',
        // the same spine read the other way round in later frames joins the same book
        'Elon Musk – Ashlee Vance': 'e7',
        'Eric Berne – Games People Play': null,
        'Stephen Greenblatt – The Swerve': null,
      });
    });

    it('a partial title on another shelf is not enough', () => {
      const cs = clusterObservations(
        framesToObs([
          [['A holtak küldöttei', 'Adam-Troy Castro'], ['The Hundred Year Old Man', 'Jonas Jonasson'], ['Az ellopott futár', 'Rejtő Jenő']],
          [['The Hundred Year Old Man', 'Jonas Jonasson'], ['Az ellopott futár', 'Rejtő Jenő'], ['A harcos', 'Stephen King']],
          [['Az ellopott futár', 'Rejtő Jenő'], ['A harcos', 'Stephen King'], ['A vád tanúja', 'Agatha Christie']],
        ]),
        firstVideo,
      );
      expect(cs.every((c) => c.matchedBookId === null)).toBe(true);
    });
  });

  it('matching is one-to-one and respects authors and volume numbers', () => {
    const existing: ExistingBookRef[] = [
      { id: 'v1', author: 'Tolsztoj', title: 'Háború és béke I.', spineAuthor: null, spineTitle: null },
      { id: 'x1', author: 'Petőfi Sándor', title: 'Versek', spineAuthor: null, spineTitle: null },
    ];
    const cs = clusterObservations([ob(0, 1, 'Háború és béke II.', 'Tolsztoj'), ob(0, 2, 'Versek', 'Ady Endre')], existing);
    expect(cs.map((c) => c.matchedBookId)).toEqual([null, null]);
    const photo = clusterObservations([ob(0, 1, 'Háború és béke I', null), ob(0, 2, 'Versek', 'Petőfi')], existing);
    expect(photo.map((c) => c.matchedBookId)).toEqual(['v1', 'x1']);
  });
});

/* ------------------------------------------------------------------ */
/* DB row conversion                                                   */
/* ------------------------------------------------------------------ */

describe('detectionsToObservations', () => {
  it('orders by frame, batch insert time and order; fills missing orders; attaches canonical hints', () => {
    const t1 = new Date('2026-09-13T10:00:00Z');
    const t2 = new Date('2026-09-13T10:00:05Z');
    const base = { rawAuthor: null, publisher: null, confidence: 0.9, frameTime: 1 };
    const obs = detectionsToObservations(
      [
        { ...base, id: 'd4', frameId: 'f2', frameIdx: 2, rawTitle: 'B', bbox: null, orderInFrame: 1, createdAt: t2 },
        { ...base, id: 'd2', frameId: 'f1', frameIdx: 1, rawTitle: 'B', bbox: { x0: 50, y0: 0, x1: 60, y1: 10 }, orderInFrame: 2, createdAt: t1 },
        { ...base, id: 'd1', frameId: 'f1', frameIdx: 1, rawTitle: 'A', bbox: null, orderInFrame: 1, createdAt: t1 },
        { ...base, id: 'd3', frameId: 'f1', frameIdx: 1, rawTitle: 'A', bbox: null, orderInFrame: 1, createdAt: t2 },
        { ...base, id: 'd5', frameId: null, frameIdx: null, rawTitle: 'C', bbox: null, orderInFrame: null, createdAt: t2 },
      ],
      new Map([['d2', { canonicalAuthor: 'X Y', canonicalTitle: 'Bé' }]]),
    );
    expect(obs.map((o) => o.key)).toEqual(['d1', 'd2', 'd3', 'd4', 'd5']);
    expect(obs[1]).toMatchObject({ canonicalTitle: 'Bé', canonicalAuthor: 'X Y', hasBbox: true, frameOrder: 1, orderInFrame: 2 });
    expect(obs[4].orderInFrame).toBe(1);
    expect(obs[4].frameOrder).toBeGreaterThan(1_000_000);
  });
});

describe('ownerEditedFields', () => {
  it('protects exactly the fields listed by the API (userEdited + userEditedFields)', () => {
    expect(ownerEditedFields({ enrichment: null, reviewed: false })).toEqual({ all: false, fields: new Set(), reviewed: false });
    const g = ownerEditedFields({
      enrichment: { source: 'openlibrary', userEdited: true, userEditedFields: ['author', 'topics'] },
      reviewed: false,
    });
    expect(g.all).toBe(false);
    expect([...g.fields]).toEqual(['author', 'topics']);
    expect(isFieldProtected(g, 'author')).toBe(true);
    expect(isFieldProtected(g, 'topics')).toBe(true);
    expect(isFieldProtected(g, 'category')).toBe(false);
    expect(isFieldProtected(g, 'descriptionHu')).toBe(false);
    // manual book: only the provided fields are protected, the rest can still be enriched
    const manual = ownerEditedFields({ enrichment: { userEdited: true, userEditedFields: ['title'] }, reviewed: true });
    expect(manual.reviewed).toBe(true);
    expect(isFieldProtected(manual, 'title')).toBe(true);
    expect(isFieldProtected(manual, 'author')).toBe(false);
  });

  it('understands legacy markers', () => {
    const legacyAll = ownerEditedFields({ enrichment: { userEdited: true }, reviewed: false });
    expect(legacyAll.all).toBe(true);
    expect(isFieldProtected(legacyAll, 'author')).toBe(true);
    expect(isFieldProtected(legacyAll, 'descriptionEn')).toBe(false);
    expect(ownerEditedFields({ enrichment: null, reviewed: true })).toEqual({ all: false, fields: new Set(), reviewed: true });
    expect([...ownerEditedFields({ enrichment: { userEdited: ['title', 'author'] }, reviewed: false }).fields]).toEqual(['title', 'author']);
    expect([...ownerEditedFields({ enrichment: { userEdited: { author: true, title: false } }, reviewed: false }).fields]).toEqual(['author']);
  });
});

/* ------------------------------------------------------------------ */
/* simulated shelf pans (ground truth fixture or synthetic shelf)      */
/* ------------------------------------------------------------------ */

interface TruthBook {
  id: string;
  author: string | null;
  title: string;
  canonicalAuthor: string | null;
  canonicalTitle: string | null;
  legibility: 'clear' | 'partial' | 'guess';
}

interface TruthVideo {
  name: string;
  books: TruthBook[];
}

function loadTruth(): { source: string; videos: TruthVideo[] } {
  const file = path.resolve(__dirname, '../../../fixtures/sample-shelf/ground-truth.json');
  if (existsSync(file)) {
    type RawBook = {
      author: string | null;
      title: string;
      canonical_author: string | null;
      canonical_title: string | null;
      legibility: 'clear' | 'partial' | 'guess';
    };
    const raw = JSON.parse(readFileSync(file, 'utf8')) as { videos: { video: string; books: RawBook[] }[] };
    return {
      source: 'ground-truth.json',
      videos: raw.videos.map((v) => ({
        name: v.video,
        books: v.books.map((b, i) => ({
          id: `${v.video}#${i}`,
          author: b.author,
          title: b.title ?? '',
          canonicalAuthor: b.canonical_author,
          canonicalTitle: b.canonical_title,
          legibility: b.legibility,
        })),
      })),
    };
  }
  const shelf: Array<[string | null, string]> = [
    ['Elena Ferrante', 'Briliáns barátnőm'],
    ['Elena Ferrante', 'Az új név története'],
    ['Elena Ferrante', 'Aki megszökik és aki marad'],
    ['Elena Ferrante', 'Az elvesztett gyerek története'],
    ['Isaac Asimov', 'Alapítvány'],
    ['Isaac Asimov', 'Alapítvány és Birodalom'],
    ['Isaac Asimov', 'Második Alapítvány'],
    ['Brigitte Hamann', 'Rudolf, a trónörökös'],
    ['Esterházy Péter', 'Pápai vizeken ne kalózkodj!'],
    ['Colin Simpson', 'A Lusitania elsüllyesztése'],
    ['H. Perruchot', 'Gauguin élete'],
    ['H. Perruchot', 'Cézanne élete'],
    ['Lengyel Dénes', 'Régi magyar mondák'],
    ['Tolsztoj', 'Háború és béke I.'],
    ['Tolsztoj', 'Háború és béke II.'],
    ['Jókai Mór', 'A kőszívű ember fiai'],
    ['Gárdonyi Géza', 'Egri csillagok'],
    ['Molnár Ferenc', 'A Pál utcai fiúk'],
    ['Szabó Magda', 'Abigél'],
    ['Szabó Magda', 'Az ajtó'],
    [null, 'Görög regék'],
    ['Deákné B. Katalin', 'Anya, taníts engem!'],
    ['Deákné B. Katalin', 'Anya, taníts engem!'],
    ['Rejtő Jenő', 'Csontbrigád'],
    ['Rejtő Jenő', 'Az ellopott futár'],
    ['Kertész Imre', 'Sorstalanság'],
    ['Márai Sándor', 'A gyertyák csonkig égnek'],
    ['Karinthy Frigyes', 'Így írtok ti'],
    ['George Orwell', 'Állatfarm'],
    ['George Orwell', '1984'],
    [null, 'Mozart, az Isten kegyeltje'],
    ['Sadie', 'Mozart'],
    ['Örkény István', 'Egyperces novellák'],
    ['Wass Albert', 'Adjátok vissza a hegyeimet!'],
    ['Fekete István', 'Tüskevár'],
    ['Umberto Eco', 'A rózsa neve'],
    ['Antoine de Saint-Exupéry', 'A kis herceg'],
    ['Petőfi Sándor', 'Versek'],
    ['Ady Endre', 'Versek'],
    ['Móricz Zsigmond', 'Légy jó mindhalálig'],
  ];
  return {
    source: 'synthetic shelf',
    videos: [
      {
        name: 'synthetic',
        books: shelf.map(([author, title], i) => ({
          id: `s#${i}`,
          author,
          title,
          canonicalAuthor: author,
          canonicalTitle: title,
          legibility: i % 7 === 3 ? 'partial' : 'clear',
        })),
      },
    ],
  };
}

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').normalize('NFC');
}

function typo(s: string, r: () => number): string {
  const words = s.split(' ');
  const candidates = words.map((w, i) => ({ w, i })).filter((x) => x.w.length >= 5);
  if (!candidates.length) return s;
  const { w, i } = candidates[Math.floor(r() * candidates.length)];
  const chars = [...w];
  const pos = 1 + Math.floor(r() * (chars.length - 2));
  const op = r();
  const letter = 'aeioulnrst'[Math.floor(r() * 10)];
  if (op < 0.33) chars.splice(pos, 1);
  else if (op < 0.66) chars[pos] = letter;
  else chars.splice(pos, 0, letter);
  words[i] = chars.join('');
  return words.join(' ');
}

interface SimResult {
  observations: MergeObservation[];
  /** observation key → book identity (identical copies of one edition share an identity) */
  truthByKey: Map<string, string>;
  readableBooks: Set<string>;
  /** physical copies per identity */
  copies: Map<string, number>;
  /** identity → index of its first copy on the shelf */
  position: Map<string, number>;
}

const fold = (s: string | null) => (s ?? '').normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/** Simulates a slow pan: sliding window over the shelf, overlapping vision batches, noisy readings. */
function simulatePan(video: TruthVideo, seed: number): SimResult {
  const r = rng(seed);
  const books = video.books;
  // uneven pan: 5–7 spines per frame, the camera moves 1–3 spines between key frames
  const perFrame: { book: TruthBook; order: number }[][] = [];
  for (let start = 0; ; ) {
    const W = 5 + Math.floor(r() * 3);
    perFrame.push(books.slice(start, start + W).map((book, i) => ({ book, order: i + 1 })));
    if (start + W >= books.length) break;
    start += 1 + Math.floor(r() * 3);
  }
  const frameCount = perFrame.length;
  // overlapping vision batches of 4 frames (overlap 1) → boundary frames are read twice
  const passes: { frame: number; pass: number }[] = [];
  for (let start = 0; ; start += 3) {
    const end = Math.min(start + 4, frameCount);
    for (let f = start; f < end; f++) passes.push({ frame: f, pass: start });
    if (end >= frameCount) break;
  }
  passes.sort((a, b) => a.frame - b.frame || a.pass - b.pass);

  const observations: MergeObservation[] = [];
  const truthByKey = new Map<string, string>();
  const seenBooks = new Set<string>();
  const identity = (b: TruthBook) => `${video.name}|${fold(b.title)}|${fold(b.author)}`;
  const copies = new Map<string, number>();
  const position = new Map<string, number>();
  books.forEach((b, i) => {
    if (!b.title.trim()) return;
    copies.set(identity(b), (copies.get(identity(b)) ?? 0) + 1);
    if (!position.has(identity(b))) position.set(identity(b), i);
  });
  let n = 0;
  for (const { frame, pass } of passes) {
    let order = 0;
    for (const { book } of perFrame[frame]) {
      if (!book.title.trim()) continue;
      const leg = book.legibility;
      const pMiss = leg === 'clear' ? 0.12 : leg === 'partial' ? 0.3 : 0.45;
      if (r() < pMiss) continue;
      order++;
      let title = book.title;
      const pTypo = leg === 'clear' ? 0.1 : 0.3;
      if (r() < pTypo) title = typo(title, r);
      if (r() < 0.25) title = stripAccents(title);
      if (r() < 0.45) title = title.toUpperCase();
      if (leg !== 'clear' && r() < 0.15) title = title.replace(/[!?.…]+$/, '');
      let author = book.author;
      const pNoAuthor = leg === 'clear' ? 0.2 : 0.4;
      if (author && r() < pNoAuthor) author = null;
      if (author && r() < 0.25) author = stripAccents(author);
      if (author && r() < 0.35) author = author.toUpperCase();
      const knows = r() < (leg === 'clear' ? 0.5 : 0.25);
      const confidence = leg === 'clear' ? 0.7 + r() * 0.3 : leg === 'partial' ? 0.4 + r() * 0.35 : 0.2 + r() * 0.3;
      const key = `${video.name}:${frame}:${pass}:${n++}`;
      observations.push({
        key,
        frameOrder: frame,
        orderInFrame: order,
        author,
        title,
        canonicalAuthor: knows ? book.canonicalAuthor : null,
        canonicalTitle: knows ? book.canonicalTitle : null,
        publisher: null,
        confidence,
        hasBbox: r() < 0.95,
      });
      truthByKey.set(key, identity(book));
      seenBooks.add(identity(book));
    }
  }
  return { observations, truthByKey, readableBooks: seenBooks, copies, position };
}

function evaluate(clusters: MergeCluster[], sim: SimResult) {
  let falseMerges = 0;
  const clustersPerBook = new Map<string, number>();
  const impure: string[][] = [];
  const majorities: string[] = [];
  for (const c of clusters) {
    const counts = new Map<string, number>();
    for (const k of c.observationKeys) {
      const b = sim.truthByKey.get(k)!;
      counts.set(b, (counts.get(b) ?? 0) + 1);
    }
    if (counts.size > 1) {
      falseMerges++;
      impure.push([...counts.keys()]);
    }
    const majority = [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
    clustersPerBook.set(majority, (clustersPerBook.get(majority) ?? 0) + 1);
    majorities.push(majority);
  }
  let inOrder = 0;
  for (let i = 1; i < majorities.length; i++) {
    if (sim.position.get(majorities[i - 1])! <= sim.position.get(majorities[i])!) inOrder++;
  }
  const total = [...sim.readableBooks].reduce((acc, b) => acc + (sim.copies.get(b) ?? 1), 0);
  const recovered = [...sim.readableBooks].reduce(
    (acc, b) => acc + Math.min(sim.copies.get(b) ?? 1, clustersPerBook.get(b) ?? 0),
    0,
  );
  const duplicates = [...clustersPerBook.entries()].reduce((acc, [b, n]) => acc + Math.max(0, n - (sim.copies.get(b) ?? 1)), 0);
  return { falseMerges, impure, recovered, total, duplicates, clusters: clusters.length, inOrder, pairs: Math.max(0, majorities.length - 1) };
}

describe('clusterObservations – simulated shelf pans', () => {
  const truth = loadTruth();

  for (const seed of [1, 2, 3, 4, 5]) {
    it(`recovers ≥ 95 % of books as distinct clusters with no false merges (${truth.source}, seed ${seed})`, () => {
      let recovered = 0;
      let total = 0;
      let duplicates = 0;
      let falseMerges = 0;
      let inOrder = 0;
      let pairs = 0;
      const impure: string[][] = [];
      for (const video of truth.videos) {
        const sim = simulatePan(video, seed * 1000 + video.books.length);
        const clusters = clusterObservations(sim.observations);
        const e = evaluate(clusters, sim);
        recovered += e.recovered;
        total += e.total;
        duplicates += e.duplicates;
        falseMerges += e.falseMerges;
        impure.push(...e.impure);
        inOrder += e.inOrder;
        pairs += e.pairs;
      }
      console.info(
        `[merge.test] ${truth.source} seed ${seed}: recovered ${recovered}/${total} (${((100 * recovered) / total).toFixed(1)} %), extra clusters ${duplicates}, false merges ${falseMerges}, shelf order ${inOrder}/${pairs}`,
      );
      expect(impure).toEqual([]);
      expect(falseMerges).toBe(0);
      expect(recovered / total).toBeGreaterThanOrEqual(0.95);
      // distinct clusters: at most 5 % of the books are split into extra clusters
      expect(duplicates / total).toBeLessThanOrEqual(0.05);
      // shelf order: neighbouring clusters appear in physical order
      expect(inOrder / pairs).toBeGreaterThanOrEqual(0.97);
    });
  }

  it('whole collection: later videos neither match books of other shelves nor lose books', () => {
    if (truth.videos.length < 2) return;
    const existing: ExistingBookRef[] = [];
    let created = 0;
    let readable = 0;
    truth.videos.forEach((video, vi) => {
      const sim = simulatePan(video, 77 + vi);
      readable += sim.readableBooks.size;
      const clusters = clusterObservations(sim.observations, existing);
      const matched = clusters.filter((c) => c.matchedBookId);
      expect(matched.map((c) => `${c.title} → ${c.matchedBookId}`)).toEqual([]);
      clusters.forEach((c, ci) => {
        existing.push({ id: `${vi}:${ci}`, author: c.author, title: c.title, spineAuthor: c.spineAuthor, spineTitle: c.spineTitle, shelfPosition: vi * 100000 + ci });
      });
      created += clusters.length;
    });
    expect(created).toBeGreaterThanOrEqual(Math.floor(readable * 0.95));
  });

  it('the same video merged twice matches its own books instead of duplicating them', () => {
    const video = truth.videos[0];
    const first = clusterObservations(simulatePan(video, 11).observations);
    const existing = first.map((c, ci) => ({ id: `e${ci}`, author: c.author, title: c.title, spineAuthor: c.spineAuthor, spineTitle: c.spineTitle, shelfPosition: ci }));
    const second = clusterObservations(simulatePan(video, 12).observations, existing);
    const matched = second.filter((c) => c.matchedBookId).length;
    expect(matched / second.length).toBeGreaterThanOrEqual(0.85);
  });
});

/* ------------------------------------------------------------------ */
/* mergeVideoDetections against PostgreSQL                             */
/* ------------------------------------------------------------------ */

const dbAvailable = await pool()
  .query('SELECT 1 FROM detections LIMIT 1')
  .then(() => true)
  .catch(() => false);

describe.skipIf(!dbAvailable)('mergeVideoDetections (PostgreSQL)', () => {
  const createdCollections: string[] = [];
  type Spine = [title: string, author: string | null, confidence?: number, withBbox?: boolean];

  afterAll(async () => {
    if (createdCollections.length) await db().delete(collections).where(inArray(collections.id, createdCollections));
  });

  beforeEach(() => {
    vi.mocked(recordUsage).mockClear();
    mh.judge = null;
    mh.maxBooks = 5000;
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  const bboxAt = (rank: number): BBox => ({ x0: rank * 300, y0: 100, x1: rank * 300 + 250, y1: 1800 });

  async function newVideo(collectionId: string, sortOrder: number, kind: 'video' | 'image', frameSpines: Spine[][]) {
    const [video] = await db()
      .insert(videos)
      .values({ collectionId, kind, sortOrder, originalFilename: `v${sortOrder}.mp4`, mimeType: 'video/mp4', sizeBytes: 1000, status: 'processing' })
      .returning();
    const frameRows = [];
    for (const [idx, spines] of frameSpines.entries()) {
      const [frame] = await db()
        .insert(frames)
        .values({ videoId: video.id, collectionId, idx, timeSec: idx * 0.5, storagePath: `frames/${collectionId}/${video.id}/${idx}.jpg`, width: 1080, height: 1920, analyzed: true })
        .returning();
      frameRows.push(frame);
      await db()
        .insert(detections)
        .values(
          spines.map(([title, author, confidence = 0.9, withBbox = true], rank) => ({
            collectionId,
            videoId: video.id,
            frameId: frame.id,
            rawTitle: title,
            rawAuthor: author,
            confidence,
            bbox: withBbox ? bboxAt(rank) : null,
            orderInFrame: rank + 1,
            provider: 'mock',
            model: 'test',
          })),
        );
    }
    return { video, frames: frameRows };
  }

  const collectionBooks = (cid: string): Promise<BookRow[]> =>
    db().select().from(books).where(eq(books.collectionId, cid)).orderBy(books.shelfPosition);

  it('creates books in shelf order, asks the duplicate judge, then matches a re-filmed shelf and respects limits', async () => {
    const cid = String(100000000 + Math.floor(Math.random() * 899999999));
    await db().insert(collections).values({ id: cid, ownerTokenHash: 'test', status: 'processing' });
    createdCollections.push(cid);

    /* ---- video 1: four overlapping frames ---- */
    const v1 = await newVideo(cid, 0, 'video', [
      [['Az új név története', 'Elena Ferrante'], ['Aki megszökik és aki marad', 'Elena Ferrante'], ['Az elvesztett gyerek története', 'Elena Ferrante']],
      [['AKI MEGSZOKIK ES AKI MARAD', null], ['Az elvesztett gyerek tortenete', 'ELENA FERRANTE'], ['Rokonok', 'Móricz Zsigmond']],
      [['Rokonok', 'Moricz Zsigmond'], ['Levelek Lilynek', 'Alan Macfarlane'], ['Csontbrigád', 'Rejtő Jenő', 0.95, false]],
      [['Levelek Lilynek', null], ['CSONTBRIGAD', 'REJTO JENO', 0.7], ['Az új név törté', 'Ferrante']],
    ]);
    const asked: DuplicateQuestion[][] = [];
    mh.judge = (questions) => {
      const qs = questions as DuplicateQuestion[];
      asked.push(qs);
      return {
        same: Object.fromEntries(qs.map((q) => [q.id, true])),
        usage: { provider: 'mock', model: 'judge-model', inputTokens: 10, outputTokens: 2, estCostUsd: 0 },
      };
    };
    const r1 = await mergeVideoDetections(v1.video.id, { canonicalHints: new Map() });
    expect(r1.newBookIds).toHaveLength(6);
    expect(r1.updatedBookIds).toEqual([]);
    expect(asked).toHaveLength(1);
    expect(asked[0].map((q) => [q.a.title, q.b.title].sort())).toEqual([['Az új név törté', 'Az új név története']]);
    expect(recordUsage).toHaveBeenCalledWith(cid, expect.objectContaining({ model: 'judge-model' }));

    let rows = await collectionBooks(cid);
    expect(rows.map((b) => b.title)).toEqual([
      'Az új név története',
      'Aki megszökik és aki marad',
      'Az elvesztett gyerek története',
      'Rokonok',
      'Levelek Lilynek',
      'Csontbrigád',
    ]);
    expect(rows.map((b) => b.shelfPosition)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(rows[0]).toMatchObject({
      author: 'Elena Ferrante',
      authorSort: 'ferrante elena',
      titleSort: 'uj nev tortenete',
      detectionCount: 2,
      source: 'video',
      firstVideoId: v1.video.id,
    });
    expect(rows[3]).toMatchObject({ author: 'Móricz Zsigmond', authorSort: 'moricz zsigmond', detectionCount: 2 });
    // best observation: the one with a bbox wins over a more confident one without
    expect(rows[5]).toMatchObject({ author: 'Rejtő Jenő', bestFrameId: v1.frames[3].id, bestBbox: bboxAt(1), firstTimeSec: 1.5, detectionCount: 2 });
    expect(rows.every((b) => b.needsReview === false)).toBe(true);
    const unassigned1 = await db().select().from(detections).where(and(eq(detections.videoId, v1.video.id), isNull(detections.bookId)));
    expect(unassigned1).toEqual([]);
    expect((await db().select().from(videos).where(eq(videos.id, v1.video.id)))[0].booksFound).toBe(6);

    /* ---- owner edits before the shelf is filmed again ---- */
    const [, , s3, s4, s5, s6] = rows;
    await db().update(books).set({ author: null, enrichment: { userEdited: true, userEditedFields: ['author'] } }).where(eq(books.id, s4.id));
    await db().update(books).set({ author: null, needsReview: true, confidence: 0.5 }).where(eq(books.id, s5.id));

    /* ---- video 2: the same shelf again → existing books are updated, nothing new ---- */
    mh.judge = null; // provider errors must not break the merge
    const v2 = await newVideo(cid, 1, 'video', [
      [['Az elvesztett gyerek története', 'Elena Ferrante'], ['Rokonok', 'Móricz Zsigmond'], ['Levelek Lilynek', 'Alan Macfarlane', 0.97]],
      [['Az elvesztett gyerek története', null], ['ROKONOK', 'MÓRICZ ZSIGMOND'], ['Levelek Lilynek', 'Alan Macfarlane']],
      [['Rokonok', null], ['Levelek Lilynek', 'Alan Macfarlane'], ['Csontbrigád', 'Rejtő Jenő']],
    ]);
    const r2 = await mergeVideoDetections(v2.video.id);
    expect(r2.newBookIds).toEqual([]);
    expect([...r2.updatedBookIds].sort()).toEqual([s3.id, s4.id, s5.id, s6.id].sort());
    rows = await collectionBooks(cid);
    const byId = new Map(rows.map((b) => [b.id, b]));
    expect(rows).toHaveLength(6);
    expect(byId.get(s3.id)!.detectionCount).toBe(4);
    expect(byId.get(s4.id)).toMatchObject({ author: null, detectionCount: 5 }); // owner-cleared author stays empty
    expect(byId.get(s5.id)).toMatchObject({ author: 'Alan Macfarlane', authorSort: 'macfarlane alan', needsReview: false, confidence: 1, detectionCount: 5 });
    expect(byId.get(s6.id)!.detectionCount).toBe(3);
    expect(byId.get(s6.id)!.firstVideoId).toBe(v1.video.id);
    expect((await db().select().from(videos).where(eq(videos.id, v2.video.id)))[0].booksFound).toBe(4);

    /* ---- video 3: a photo of another shelf, only one more book fits ---- */
    mh.maxBooks = 7;
    const v3 = await newVideo(cid, 2, 'image', [[['Homo Deus', 'Yuval Noah Harari'], ['Ilium', 'Dan Simmons'], ['A nevetés', 'Henri Bergson']]]);
    const r3 = await mergeVideoDetections(v3.video.id);
    expect(r3.newBookIds).toHaveLength(1);
    rows = await collectionBooks(cid);
    expect(rows).toHaveLength(7);
    expect(rows[6]).toMatchObject({ title: 'Homo Deus', source: 'image', shelfPosition: 200000, authorSort: 'harari yuval noah' });
    const unassigned3 = await db().select().from(detections).where(and(eq(detections.videoId, v3.video.id), isNull(detections.bookId)));
    expect(unassigned3.map((d) => d.rawTitle).sort()).toEqual(['A nevetés', 'Ilium']);
    expect((await db().select().from(videos).where(eq(videos.id, v3.video.id)))[0].booksFound).toBe(1);

    /* ---- merging again is idempotent for assigned detections ---- */
    mh.maxBooks = 5000;
    const r4 = await mergeVideoDetections(v1.video.id);
    expect(r4).toEqual({ newBookIds: [], updatedBookIds: [] });
  });

  it('throws for an unknown video', async () => {
    await expect(mergeVideoDetections('00000000-0000-4000-8000-000000000000')).rejects.toThrow(/not found/);
  });
});
