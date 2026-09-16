import { describe, expect, it } from 'vitest';
import { exactTitleKey, scoreVideo, totalScore } from './eval-recognition';

const gt = [
  { author: 'FERRANTE', title: 'Az elvesztett gyerek története', canonical_author: 'Elena Ferrante', canonical_title: 'Az elvesztett gyerek története', legibility: 'clear' },
  { author: 'Asimov', title: 'Az Alapítvány barátai', canonical_author: 'Isaac Asimov', canonical_title: 'Az Alapítvány barátai', legibility: 'clear' },
  { author: 'Móricz Zsigmond', title: 'Rokonok', canonical_author: 'Móricz Zsigmond', canonical_title: 'Rokonok', legibility: 'partial' },
  { author: null, title: 'Tanulmány vérvörösben', canonical_author: 'Arthur Conan Doyle', canonical_title: 'Tanulmány vérvörösben', legibility: 'guess' },
];

describe('scoreVideo', () => {
  it('matches one-to-one, counts exact titles with accents significant', () => {
    const score = scoreVideo(gt, [
      { author: 'Elena Ferrante', title: 'Az elveszett gyerek története' },
      { author: 'Isaac Asimov', title: 'AZ ALAPÍTVÁNY BARÁTAI' },
      { author: 'Isaac Asimov', title: 'Az Alapítvány barátai' },
      { author: 'Móricz Zsigmond', title: 'Rokonok' },
      { author: 'Szabó Magda', title: 'Abigél' },
    ]);
    expect(score.matched).toBe(3);
    expect(score.precision).toBeCloseTo(3 / 5);
    expect(score.recall).toBeCloseTo(3 / 4);
    expect(score.recallClear).toBe(1);
    // Ferrante matched fuzzily (elveszett ≠ elvesztett), Asimov + Móricz exact
    expect(score.exactTitles).toBe(2);
    expect(score.missed).toEqual(['? – Tanulmány vérvörösben']);
    expect(score.spurious).toHaveLength(2);
  });

  it('rejects title matches with incompatible authors', () => {
    const score = scoreVideo([{ author: 'Szabó Magda', title: 'Az ajtó' }], [{ author: 'Franz Kafka', title: 'Az ajtó' }]);
    expect(score.matched).toBe(0);
  });

  it('aggregates micro averages', () => {
    const a = scoreVideo(gt, [{ author: null, title: 'Rokonok' }]);
    const b = scoreVideo([{ author: null, title: 'Az ajtó', legibility: 'clear' }], []);
    const t = totalScore([a, b]);
    expect(t).toMatchObject({ gtCount: 5, predictedCount: 1, matched: 1, precision: 1, recall: 0.2 });
    expect(exactTitleKey('  Aki megszökik, és aki MARAD! ')).toBe('aki megszökik és aki marad');
  });
});
