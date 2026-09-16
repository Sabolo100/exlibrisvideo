import { describe, expect, it } from 'vitest';
import { huDecadeSuffix, oneDecimal, shelfLengthDisplay } from './format';

describe('huDecadeSuffix', () => {
  it('follows the last pronounced number word', () => {
    const cases: [number, string][] = [
      [1900, 'as'], // ezerkilencszáz
      [1910, 'es'], // tíz
      [1920, 'as'], // húsz
      [1930, 'as'], // harminc
      [1940, 'es'], // negyven
      [1950, 'es'], // ötven
      [1960, 'as'], // hatvan
      [1970, 'es'], // hetven
      [1980, 'as'], // nyolcvan
      [1990, 'es'], // kilencven
      [2000, 'es'], // kétezer
      [2010, 'es'],
      [2020, 'as'],
      [1800, 'as'],
      [1000, 'es'],
      [-400, 'as'],
    ];
    for (const [year, suffix] of cases) expect([year, huDecadeSuffix(year)]).toEqual([year, suffix]);
  });
});

describe('shelfLengthDisplay', () => {
  it('uses centimetres below a metre and metres above', () => {
    expect(shelfLengthDisplay(0)).toEqual({ value: 0, unit: 'cm' });
    expect(shelfLengthDisplay(81.4)).toEqual({ value: 81, unit: 'cm' });
    expect(shelfLengthDisplay(270)).toEqual({ value: 2.7, unit: 'm' });
    expect(shelfLengthDisplay(1234.5)).toEqual({ value: 12.3, unit: 'm' });
    expect(shelfLengthDisplay(27_000)).toEqual({ value: 270, unit: 'm' });
    expect(shelfLengthDisplay(Number.NaN)).toEqual({ value: 0, unit: 'cm' });
  });

  it('rounds averages to one decimal', () => {
    expect(oneDecimal(4 / 3)).toBe(1.3);
    expect(oneDecimal(Number.POSITIVE_INFINITY)).toBe(0);
  });
});
