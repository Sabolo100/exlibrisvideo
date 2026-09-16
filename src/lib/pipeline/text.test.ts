import { describe, expect, it } from 'vitest';
import {
  authorSortKey,
  authorsCompatible,
  familyName,
  familyNameSimilarity,
  foldForCompare,
  isLikelyHungarianName,
  levenshteinRatio,
  nameCase,
  normalizeTitle,
  sentenceCase,
  splitAuthors,
  stripLeadingArticle,
  titleContainedNormalized,
  titleNumbers,
  titleNumbersConflict,
  titleSimilarity,
  titleSortKey,
  tokenSetRatio,
} from './text';

describe('foldForCompare', () => {
  it('folds Hungarian accents including double acute', () => {
    expect(foldForCompare('Őszi fűzfa')).toBe('oszi fuzfa');
    expect(foldForCompare('ŐSZI FŰZFA')).toBe('oszi fuzfa');
    expect(foldForCompare('Árvíztűrő tükörfúrógép')).toBe('arvizturo tukorfurogep');
    expect(foldForCompare('Pápai vizeken ne kalózkodj!')).toBe('papai vizeken ne kalozkodj');
  });

  it('handles punctuation, whitespace, apostrophes and special letters', () => {
    expect(foldForCompare('  Rudolf,   a trónörökös  ')).toBe('rudolf a tronorokos');
    expect(foldForCompare('A Pál utcai fiúk — regény (1907)')).toBe('a pal utcai fiuk regeny 1907');
    expect(foldForCompare("L'Étranger")).toBe('letranger');
    expect(foldForCompare('Straße Øresund Łódź')).toBe('strasse oresund lodz');
    expect(foldForCompare('ﬁn')).toBe('fin');
  });

  it('returns empty string for missing input', () => {
    expect(foldForCompare(null)).toBe('');
    expect(foldForCompare(undefined)).toBe('');
    expect(foldForCompare('  !!! ')).toBe('');
  });
});

describe('articles and sort keys', () => {
  it('strips a leading article only as the first word', () => {
    expect(stripLeadingArticle('az uj nev tortenete')).toBe('uj nev tortenete');
    expect(stripLeadingArticle('rudolf a tronorokos')).toBe('rudolf a tronorokos');
    expect(stripLeadingArticle('a')).toBe('a');
  });

  it('titleSortKey drops a, az, the, der, die, das, le, la, les, il, el', () => {
    expect(titleSortKey('Az új név története')).toBe('uj nev tortenete');
    expect(titleSortKey('A Lusitania elsüllyesztése')).toBe('lusitania elsullyesztese');
    expect(titleSortKey('The Hobbit')).toBe('hobbit');
    expect(titleSortKey('Der Zauberberg')).toBe('zauberberg');
    expect(titleSortKey('Die Blechtrommel')).toBe('blechtrommel');
    expect(titleSortKey('Das Parfum')).toBe('parfum');
    expect(titleSortKey('Le Petit Prince')).toBe('petit prince');
    expect(titleSortKey('La Peste')).toBe('peste');
    expect(titleSortKey('Les Misérables')).toBe('miserables');
    expect(titleSortKey('Il nome della rosa')).toBe('nome della rosa');
    expect(titleSortKey('El amor en los tiempos del cólera')).toBe('amor en los tiempos del colera');
    expect(titleSortKey('Alapítvány')).toBe('alapitvany');
    expect(titleSortKey('A')).toBe('a');
    expect(titleSortKey('Rudolf, a trónörökös')).toBe('rudolf a tronorokos');
  });

  it('authorSortKey puts the family name first for both conventions', () => {
    expect(authorSortKey('Elena Ferrante')).toBe('ferrante elena');
    expect(authorSortKey('ELENA FERRANTE')).toBe('ferrante elena');
    expect(authorSortKey('Esterházy Péter')).toBe('esterhazy peter');
    expect(authorSortKey('ESTERHAZY PETER')).toBe('esterhazy peter');
    expect(authorSortKey('LENGYEL DÉNES')).toBe('lengyel denes');
    expect(authorSortKey('Lengyel Denes')).toBe('lengyel denes');
    expect(authorSortKey('H. Perruchot')).toBe('perruchot h');
    expect(authorSortKey('Henri Perruchot')).toBe('perruchot henri');
    expect(authorSortKey('Isaac Asimov')).toBe('asimov isaac');
    expect(authorSortKey('Brigitte Hamann')).toBe('hamann brigitte');
    expect(authorSortKey('Colin Simpson')).toBe('simpson colin');
    expect(authorSortKey('Péter Esterházy')).toBe('esterhazy peter');
    expect(authorSortKey('Szerb Antal')).toBe('szerb antal');
    expect(authorSortKey('Antal Szerb')).toBe('szerb antal');
    expect(authorSortKey('Asimov, Isaac')).toBe('asimov isaac');
    expect(authorSortKey('HAMANN')).toBe('hamann');
    expect(authorSortKey('Gy. Szabó Béla')).toBe('gy szabo bela');
  });

  it('authorSortKey handles multiple authors, empties and honorifics', () => {
    expect(authorSortKey('Esterházy Péter; Nádas Péter')).toBe('esterhazy peter; nadas peter');
    expect(authorSortKey('Isaac Asimov és Robert Silverberg')).toBe('asimov isaac; silverberg robert');
    expect(authorSortKey('Dr. Csernus Imre')).toBe('csernus imre');
    expect(authorSortKey(null)).toBeNull();
    expect(authorSortKey('   ')).toBeNull();
    expect(authorSortKey('—')).toBeNull();
  });

  it('language only breaks ties for names without known given names', () => {
    expect(authorSortKey('Haruki Murakami')).toBe('murakami haruki');
    expect(authorSortKey('Haruki Murakami', 'hu')).toBe('murakami haruki');
    expect(authorSortKey('Elena Ferrante', 'hu')).toBe('ferrante elena');
  });
});

describe('titleSimilarity', () => {
  it('is 1 for accent, casing and punctuation variants', () => {
    expect(titleSimilarity('Az új név története', 'AZ ÚJ NÉV TÖRTÉNETE')).toBe(1);
    expect(titleSimilarity('Az elveszett gyerek tortenete', 'Az elveszett gyerek története')).toBe(1);
    expect(titleSimilarity('Pápai vizeken ne kalózkodj!', 'PAPAI VIZEKEN NE KALOZKODJ')).toBe(1);
    expect(titleSimilarity('Rudolf, a trónörökös', 'Rudolf a trónörökös')).toBe(1);
    expect(titleSimilarity('Régi magyar mondák', 'regi magyar mondak')).toBe(1);
  });

  it('ignores a leading article', () => {
    expect(titleSimilarity('A Lusitania elsüllyesztése', 'Lusitania elsüllyesztése')).toBe(1);
    expect(titleSimilarity('The Hobbit', 'Hobbit')).toBe(1);
  });

  it('tolerates OCR-like typos and word order changes', () => {
    expect(titleSimilarity('A Lusitania elsüllyesztése', 'A Lusitania elsülyesztése')).toBeGreaterThanOrEqual(0.85);
    expect(titleSimilarity('Gauguin élete', 'Gaugin elete')).toBeGreaterThanOrEqual(0.85);
    expect(titleSimilarity('Alapítvány', 'Alapitvány')).toBe(1);
    expect(titleSimilarity('Alapítvány', 'Alapitvany')).toBe(1);
    expect(titleSimilarity('Alapítvány', 'Alapítvámy')).toBeGreaterThanOrEqual(0.85);
    expect(titleSimilarity('Rudolf, a trónörökös', 'A trónörökös, Rudolf')).toBeGreaterThanOrEqual(0.85);
  });

  it('folds double acute letters in titles (OCR accent loss)', () => {
    expect(titleSimilarity('A kőszívű ember fiai', 'A KOSZIVU EMBER FIAI')).toBe(1);
    expect(titleSimilarity('Egy előre bejelentett gyilkosság krónikája', 'Egy elore bejelentett gyilkossag kronikaja')).toBe(1);
    expect(titleSimilarity('Az elvesztett gyerek története', 'Az elveszett gyerek tortenete')).toBeGreaterThanOrEqual(0.85);
  });

  it('does not match different books that share words', () => {
    expect(titleSimilarity('Az uj nev tortenete', 'Az elveszett gyerek tortenete')).toBeLessThan(0.85);
    expect(titleSimilarity('AZ UJ NEV TORTENETE', 'Az elvesztett gyerek története')).toBeLessThan(0.6);
    expect(titleSimilarity('Az új név története', 'Az elveszett gyerek története')).toBeLessThan(0.85);
    expect(titleSimilarity('Az új név története', 'Aki elmegy és aki marad')).toBeLessThan(0.85);
    expect(titleSimilarity('Alapítvány', 'Alapítvány és Birodalom')).toBeLessThan(0.85);
    expect(titleSimilarity('Alapítvány', 'Második Alapítvány')).toBeLessThan(0.85);
    expect(titleSimilarity('Gauguin élete', 'Van Gogh élete')).toBeLessThan(0.85);
    expect(titleSimilarity('Régi magyar mondák', 'Régi magyar legendák')).toBeLessThan(0.85);
  });

  it('handles empty strings', () => {
    expect(titleSimilarity('', '')).toBe(0);
    expect(titleSimilarity('Alapítvány', '')).toBe(0);
  });

  it('is symmetric', () => {
    const pairs: [string, string][] = [
      ['Az új név története', 'Az elveszett gyerek története'],
      ['Gauguin élete', 'Gaugin elete'],
      ['Alapítvány', 'Második Alapítvány'],
    ];
    for (const [a, b] of pairs) expect(titleSimilarity(a, b)).toBeCloseTo(titleSimilarity(b, a), 10);
  });
});

describe('ratios and helpers', () => {
  it('levenshteinRatio', () => {
    expect(levenshteinRatio('', '')).toBe(1);
    expect(levenshteinRatio('abcd', 'abcd')).toBe(1);
    expect(levenshteinRatio('abcd', 'abce')).toBe(0.75);
    expect(levenshteinRatio('abc', '')).toBe(0);
  });

  it('tokenSetRatio is order-insensitive but does not treat subsets as equal', () => {
    expect(tokenSetRatio('magyar régi mondák', 'Régi magyar mondák')).toBe(1);
    expect(tokenSetRatio('Alapítvány', 'Alapítvány és Birodalom')).toBeLessThan(0.6);
  });

  it('titleContainedNormalized detects partial readings', () => {
    expect(titleContainedNormalized(normalizeTitle('Rudolf'), normalizeTitle('Rudolf, a trónörökös'))).toBe(true);
    expect(titleContainedNormalized(normalizeTitle('Papai vizeken'), normalizeTitle('Pápai vizeken ne kalózkodj!'))).toBe(true);
    expect(titleContainedNormalized(normalizeTitle('Az'), normalizeTitle('Az új név története'))).toBe(false);
    expect(titleContainedNormalized(normalizeTitle('Gauguin'), normalizeTitle('Van Gogh élete'))).toBe(false);
  });

  it('volume numbers', () => {
    expect([...titleNumbers('Háború és béke II. kötet')]).toEqual([2]);
    expect([...titleNumbers('Második kötet')]).toEqual([2]);
    expect([...titleNumbers('1984')]).toEqual([1984]);
    expect(titleNumbers('Alapítvány').size).toBe(0);
    expect(titleNumbersConflict('Háború és béke I.', 'Háború és béke II.')).toBe(true);
    expect(titleNumbersConflict('Háború és béke II.', 'HÁBORÚ ÉS BÉKE 2')).toBe(false);
    expect(titleNumbersConflict('Háború és béke', 'Háború és béke II.')).toBe(false);
    expect(titleNumbersConflict('Első kötet', 'Második kötet')).toBe(true);
  });
});

describe('names', () => {
  it('familyName for both orders, initials, commas', () => {
    expect(familyName('Esterházy Péter')).toBe('Esterházy');
    expect(familyName('Péter Esterházy')).toBe('Esterházy');
    expect(familyName('Elena Ferrante')).toBe('Ferrante');
    expect(familyName('H. Perruchot')).toBe('Perruchot');
    expect(familyName('Henri Perruchot')).toBe('Perruchot');
    expect(familyName('LENGYEL DÉNES')).toBe('LENGYEL');
    expect(familyName('Isaac Asimov')).toBe('Asimov');
    expect(familyName('García Márquez, Gabriel')).toBe('García Márquez');
    expect(familyName('HAMANN')).toBe('HAMANN');
    expect(familyName('Esterházy P.')).toBe('Esterházy');
    expect(familyName(null)).toBeNull();
  });

  it('isLikelyHungarianName', () => {
    expect(isLikelyHungarianName('Esterházy Péter')).toBe(true);
    expect(isLikelyHungarianName('ESTERHAZY PETER')).toBe(true);
    expect(isLikelyHungarianName('LENGYEL DENES')).toBe(true);
    expect(isLikelyHungarianName('Szabó Magda')).toBe(true);
    expect(isLikelyHungarianName('Jókai Mór')).toBe(true);
    expect(isLikelyHungarianName('Elena Ferrante')).toBe(false);
    expect(isLikelyHungarianName('H. Perruchot')).toBe(false);
    expect(isLikelyHungarianName('Isaac Asimov')).toBe(false);
    expect(isLikelyHungarianName('Brigitte Hamann')).toBe(false);
    expect(isLikelyHungarianName('Péter Esterházy')).toBe(false);
    expect(isLikelyHungarianName('Hamann')).toBe(false);
    expect(isLikelyHungarianName(null)).toBe(false);
  });

  it('splitAuthors', () => {
    expect(splitAuthors('Esterházy Péter; Nádas Péter')).toEqual(['Esterházy Péter', 'Nádas Péter']);
    expect(splitAuthors('Esterházy Péter és Nádas Péter')).toEqual(['Esterházy Péter', 'Nádas Péter']);
    expect(splitAuthors('ESTERHÁZY ÉS NÁDAS')).toEqual(['ESTERHÁZY', 'NÁDAS']);
    expect(splitAuthors('Esterhazy es Nadas')).toEqual(['Esterhazy', 'Nadas']);
    expect(splitAuthors('Lengyel Dénes - Szabó Magda')).toEqual(['Lengyel Dénes', 'Szabó Magda']);
    expect(splitAuthors('Kosztolányi, Karinthy')).toEqual(['Kosztolányi', 'Karinthy']);
    expect(splitAuthors('Asimov, Isaac')).toEqual(['Asimov, Isaac']);
    expect(splitAuthors('Perruchot, H.')).toEqual(['Perruchot, H.']);
    expect(splitAuthors('Isaac Asimov and Robert Silverberg')).toEqual(['Isaac Asimov', 'Robert Silverberg']);
    expect(splitAuthors('Saint-Exupéry')).toEqual(['Saint-Exupéry']);
    expect(splitAuthors(null)).toEqual([]);
    expect(splitAuthors(' ; ')).toEqual([]);
  });

  it('authorsCompatible: missing authors are compatible', () => {
    expect(authorsCompatible(null, 'Elena Ferrante')).toBe(true);
    expect(authorsCompatible('Elena Ferrante', undefined)).toBe(true);
    expect(authorsCompatible('', '')).toBe(true);
  });

  it('authorsCompatible: casing, accents, initials and name order', () => {
    expect(authorsCompatible('ELENA FERRANTE', 'Elena Ferrante')).toBe(true);
    expect(authorsCompatible('H. Perruchot', 'Henri Perruchot')).toBe(true);
    expect(authorsCompatible('Esterházy Péter', 'Péter Esterházy')).toBe(true);
    expect(authorsCompatible('ESTERHAZY PETER', 'Esterházy Péter')).toBe(true);
    expect(authorsCompatible('Lengyel Dénes', 'Dénes Lengyel')).toBe(true);
    expect(authorsCompatible('HAMANN', 'Brigitte Hamann')).toBe(true);
    expect(authorsCompatible('Perruchot, Henri', 'H. Perruchot')).toBe(true);
    expect(authorsCompatible('García Márquez, Gabriel', 'Gabriel García Márquez')).toBe(true);
    expect(authorsCompatible('Saint Exupéry', 'Antoine de Saint-Exupéry')).toBe(true);
    expect(authorsCompatible('Esterhzy Péter', 'Esterházy Péter')).toBe(true);
  });

  it('authorsCompatible: transliterated family names', () => {
    expect(authorsCompatible('Tolsztoj', 'Lev Tolstoy')).toBe(true);
    expect(authorsCompatible('Dosztojevszkij', 'Fyodor Dostoevsky')).toBe(true);
    expect(authorsCompatible('Csehov', 'Anton Chekhov')).toBe(true);
    expect(familyNameSimilarity('tolsztoj', 'tolstoy')).toBeGreaterThanOrEqual(0.8);
  });

  it('authorsCompatible: different people are incompatible', () => {
    expect(authorsCompatible('Petőfi Sándor', 'Ady Endre')).toBe(false);
    expect(authorsCompatible('Elena Ferrante', 'Isaac Asimov')).toBe(false);
    expect(authorsCompatible('Colin Simpson', 'Colin Wilson')).toBe(false);
    expect(authorsCompatible('Esterházy Péter', 'Nádas Péter')).toBe(false);
    expect(authorsCompatible('Brigitte Hamann', 'H. Perruchot')).toBe(false);
  });

  it('authorsCompatible: multi-author strings share one person', () => {
    expect(authorsCompatible('Esterházy Péter; Nádas Péter', 'Nádas Péter')).toBe(true);
    expect(authorsCompatible('Esterházy Péter és Nádas Péter', 'Ferrante')).toBe(false);
  });
});

describe('display casing', () => {
  it('sentenceCase keeps roman numerals and Hungarian ordinals lower-case', () => {
    expect(sentenceCase('RÉGI MAGYAR MONDÁK')).toBe('Régi magyar mondák');
    expect(sentenceCase('HÁBORÚ ÉS BÉKE II. KÖTET')).toBe('Háború és béke II. kötet');
    expect(sentenceCase('PÁPAI VIZEKEN NE KALÓZKODJ!')).toBe('Pápai vizeken ne kalózkodj!');
    expect(sentenceCase('GAUGUIN ÉLETE. REGÉNY')).toBe('Gauguin élete. Regény');
    expect(sentenceCase('Az új név története')).toBe('Az új név története');
  });

  it('nameCase', () => {
    expect(nameCase('LENGYEL DÉNES')).toBe('Lengyel Dénes');
    expect(nameCase('H. PERRUCHOT')).toBe('H. Perruchot');
    expect(nameCase('ANTOINE DE SAINT-EXUPÉRY')).toBe('Antoine de Saint-Exupéry');
    expect(nameCase("O'BRIEN")).toBe("O'Brien");
    expect(nameCase('ESTERHÁZY ÉS NÁDAS')).toBe('Esterházy és Nádas');
    expect(nameCase('Elena Ferrante')).toBe('Elena Ferrante');
  });
});
