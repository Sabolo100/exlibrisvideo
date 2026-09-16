/**
 * Pure label helpers of the data views (owner: views-data). The words themselves live in the
 * i18n "data" area; these functions only pick grammatical forms and numbers. Unit-tested.
 */

/** Hungarian vowel-harmony suffix after a tens digit: 10 tíz-es, 20 húsz-as, 30 harminc-as … */
const HU_TENS_SUFFIX: Record<number, 'as' | 'es'> = {
  1: 'es',
  2: 'as',
  3: 'as',
  4: 'es',
  5: 'es',
  6: 'as',
  7: 'es',
  8: 'as',
  9: 'es',
};

/**
 * Suffix of a Hungarian decade label "<year>-as/-es évek", following the last pronounced number
 * word: 1960-as (hatvan), 1970-es (hetven), 1900-as (száz), 2000-es (ezer).
 */
export function huDecadeSuffix(year: number): 'as' | 'es' {
  const y = Math.abs(Math.trunc(year));
  const tens = Math.floor(y / 10) % 10;
  if (tens !== 0) return HU_TENS_SUFFIX[tens];
  if (Math.floor(y / 100) % 10 !== 0) return 'as';
  if (Math.floor(y / 1000) !== 0) return 'es';
  // single digits do not occur for decade starts other than 0 ("0-s évek" is not idiomatic anyway)
  return 'as';
}

/** Value and unit for the shelf length stat: centimetres below one metre, else metres (1 decimal below 100 m). */
export function shelfLengthDisplay(cm: number): { value: number; unit: 'cm' | 'm' } {
  const v = Number.isFinite(cm) ? Math.max(0, cm) : 0;
  if (v < 100) return { value: Math.round(v), unit: 'cm' };
  const m = v / 100;
  return { value: m < 100 ? Math.round(m * 10) / 10 : Math.round(m), unit: 'm' };
}

/** Rounds to one decimal (averages such as "2.4 books per author"). */
export function oneDecimal(v: number): number {
  return Number.isFinite(v) ? Math.round(v * 10) / 10 : 0;
}
