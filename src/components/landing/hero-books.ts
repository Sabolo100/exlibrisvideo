/**
 * Illustration data for the landing page: Hungarian classics as they might stand on a home shelf.
 * Explicit ids and dates keep server and client renders identical (no hydration drift).
 */
import { makeSampleBook } from '@/components/books/sample-books';
import type { BookDTO } from '@/lib/types';

type HeroSeed = Pick<BookDTO, 'author' | 'title' | 'spineColor' | 'firstPublishedYear' | 'pageCount'> & {
  category?: string;
};

const SEEDS: HeroSeed[] = [
  { author: 'Jókai Mór', title: 'Az arany ember', spineColor: '#7b2d26', firstPublishedYear: 1872, pageCount: 520, category: 'classics' },
  { author: 'Gárdonyi Géza', title: 'Egri csillagok', spineColor: '#1f4d3a', firstPublishedYear: 1899, pageCount: 610, category: 'historical_fiction' },
  { author: 'Mikszáth Kálmán', title: 'Szent Péter esernyője', spineColor: '#e9dfc8', firstPublishedYear: 1895, pageCount: 240, category: 'classics' },
  { author: 'Madách Imre', title: 'Az ember tragédiája', spineColor: '#2c3e5c', firstPublishedYear: 1861, pageCount: 230, category: 'drama' },
  { author: 'Arany János', title: 'Toldi', spineColor: '#a4462f', firstPublishedYear: 1847, pageCount: 120, category: 'poetry' },
  { author: 'Kosztolányi Dezső', title: 'Édes Anna', spineColor: '#d8b25a', firstPublishedYear: 1926, pageCount: 260, category: 'literary_fiction' },
  { author: 'Móricz Zsigmond', title: 'Légy jó mindhalálig', spineColor: '#4f6b3a', firstPublishedYear: 1920, pageCount: 330, category: 'classics' },
  { author: 'Karinthy Frigyes', title: 'Így írtok ti', spineColor: '#f0e6d2', firstPublishedYear: 1912, pageCount: 380, category: 'humor' },
  { author: 'Petőfi Sándor', title: 'János vitéz', spineColor: '#8c2f39', firstPublishedYear: 1845, pageCount: 96, category: 'poetry' },
  { author: 'Szerb Antal', title: 'Utas és holdvilág', spineColor: '#27313f', firstPublishedYear: 1937, pageCount: 290, category: 'literary_fiction' },
  { author: 'Márai Sándor', title: 'A gyertyák csonkig égnek', spineColor: '#b98b3a', firstPublishedYear: 1942, pageCount: 190, category: 'literary_fiction' },
  { author: 'Szabó Magda', title: 'Abigél', spineColor: '#5b3a6b', firstPublishedYear: 1970, pageCount: 420, category: 'young_adult' },
  { author: 'Örkény István', title: 'Egyperces novellák', spineColor: '#e4d3a6', firstPublishedYear: 1968, pageCount: 300, category: 'short_stories' },
  { author: 'Fekete István', title: 'Tüskevár', spineColor: '#3f6b5a', firstPublishedYear: 1957, pageCount: 350, category: 'young_adult' },
  { author: 'Babits Mihály', title: 'A gólyakalifa', spineColor: '#6f4527', firstPublishedYear: 1916, pageCount: 170, category: 'literary_fiction' },
  { author: 'Rejtő Jenő', title: 'Piszkos Fred, a kapitány', spineColor: '#c65b2e', firstPublishedYear: 1940, pageCount: 280, category: 'humor' },
  { author: 'Weöres Sándor', title: 'Bóbita', spineColor: '#d9c27a', firstPublishedYear: 1955, pageCount: 80, category: 'poetry' },
  { author: 'Jókai Mór', title: 'A kőszívű ember fiai', spineColor: '#20364d', firstPublishedYear: 1869, pageCount: 640, category: 'classics' },
];

export const HERO_BOOKS: BookDTO[] = SEEDS.map((s, i) => {
  const created = new Date(Date.UTC(2026, 8, 1, 9, 0, i)).toISOString();
  return makeSampleBook({
    id: `hero-${String(i + 1).padStart(2, '0')}`,
    title: s.title,
    author: s.author,
    authorSort: null,
    spineAuthor: s.author,
    spineTitle: s.title,
    spineColor: s.spineColor,
    firstPublishedYear: s.firstPublishedYear,
    pageCount: s.pageCount,
    category: s.category ?? null,
    authorCountry: 'HU',
    shelfPosition: i + 1,
    firstTimeSec: i * 0.5,
    createdAt: created,
    updatedAt: created,
  });
});
