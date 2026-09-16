/**
 * Realistic fake collection (a Hungarian home library) for export / e-mail tests and
 * local sample generation. Not used by production code.
 */
import type { BookDTO, CollectionWithBooksDTO, ReadingStatus } from '@/lib/types';

type Seed = [
  author: string | null,
  authorSort: string | null,
  title: string,
  year: number | null,
  publisher: string | null,
  category: string | null,
  topics: string[],
  lang: string,
  country: string | null,
  color: string,
];

export const SAMPLE_SEEDS: Seed[] = [
  ['Szabó Magda', 'szabo magda', 'Az ajtó', 1987, 'Európa', 'hungarian_literature', ['literary_fiction'], 'hu', 'HU', '#7a2e2a'],
  ['Szabó Magda', 'szabo magda', 'Abigél', 1970, 'Móra', 'young_adult', ['hungarian_literature'], 'hu', 'HU', '#2f5d7c'],
  ['Esterházy Péter', 'esterhazy peter', 'Harmonia caelestis', 2000, 'Magvető', 'hungarian_literature', ['historical_fiction'], 'hu', 'HU', '#c9b27a'],
  ['Kertész Imre', 'kertesz imre', 'Sorstalanság', 1975, 'Magvető', 'hungarian_literature', ['history'], 'hu', 'HU', '#1c1c1c'],
  ['Márai Sándor', 'marai sandor', 'A gyertyák csonkig égnek', 1942, 'Helikon', 'hungarian_literature', ['classics'], 'hu', 'HU', '#5b3a29'],
  ['Örkény István', 'orkeny istvan', 'Egyperces novellák', 1968, 'Palatinus', 'short_stories', ['humor', 'hungarian_literature'], 'hu', 'HU', '#e0b03c'],
  ['Jókai Mór', 'jokai mor', 'Az arany ember', 1872, 'Szépirodalmi Könyvkiadó', 'classics', ['hungarian_literature'], 'hu', 'HU', '#8c6d1f'],
  ['Mikszáth Kálmán', 'mikszath kalman', 'Különös házasság', 1900, 'Szépirodalmi Könyvkiadó', 'classics', [], 'hu', 'HU', '#4d6b3c'],
  ['Móricz Zsigmond', 'moricz zsigmond', 'Légy jó mindhalálig', 1920, 'Móra', 'classics', ['young_adult'], 'hu', 'HU', '#9b3d2f'],
  ['Karinthy Frigyes', 'karinthy frigyes', 'Így írtok ti', 1912, 'Holnap', 'humor', ['hungarian_literature'], 'hu', 'HU', '#355c7d'],
  ['Kosztolányi Dezső', 'kosztolanyi dezso', 'Édes Anna', 1926, 'Osiris', 'hungarian_literature', ['classics'], 'hu', 'HU', '#b85c38'],
  ['Kosztolányi Dezső', 'kosztolanyi dezso', 'Esti Kornél', 1933, 'Osiris', 'short_stories', [], 'hu', 'HU', '#6a4c93'],
  ['Nádas Péter', 'nadas peter', 'Párhuzamos történetek', 2005, 'Jelenkor', 'hungarian_literature', [], 'hu', 'HU', '#2b2b2b'],
  ['Krasznahorkai László', 'krasznahorkai laszlo', 'Sátántangó', 1985, 'Magvető', 'hungarian_literature', ['literary_fiction'], 'hu', 'HU', '#3e4a3d'],
  ['Rejtő Jenő', 'rejto jeno', 'Piszkos Fred, a kapitány', 1940, 'Nova', 'humor', ['crime_thriller'], 'hu', 'HU', '#d35400'],
  ['Fekete István', 'fekete istvan', 'Tüskevár', 1957, 'Móra', 'young_adult', ['nature'], 'hu', 'HU', '#3b7d3b'],
  ['Gárdonyi Géza', 'gardonyi geza', 'Egri csillagok', 1901, 'Móra', 'historical_fiction', ['classics'], 'hu', 'HU', '#a83232'],
  ['Molnár Ferenc', 'molnar ferenc', 'A Pál utcai fiúk', 1906, 'Móra', 'young_adult', ['classics'], 'hu', 'HU', '#2e6f95'],
  ['Weöres Sándor', 'weores sandor', 'Bóbita', 1955, 'Móra', 'children', ['poetry'], 'hu', 'HU', '#f2c14e'],
  ['Radnóti Miklós', 'radnoti miklos', 'Tajtékos ég', 1946, 'Magvető', 'poetry', [], 'hu', 'HU', '#556b8d'],
  ['Szerb Antal', 'szerb antal', 'Utas és holdvilág', 1937, 'Magvető', 'hungarian_literature', ['literary_fiction'], 'hu', 'HU', '#1f3b57'],
  ['Ottlik Géza', 'ottlik geza', 'Iskola a határon', 1959, 'Magvető', 'hungarian_literature', [], 'hu', 'HU', '#7b8b6f'],
  ['Csáth Géza', 'csath geza', 'A varázsló kertje', 1908, 'Szépirodalmi Könyvkiadó', 'short_stories', [], 'hu', 'HU', '#5e2750'],
  ['Spiró György', 'spiro gyorgy', 'Fogság', 2005, 'Magvető', 'historical_fiction', ['hungarian_literature'], 'hu', 'HU', '#c2a878'],
  ['Lázár Ervin', 'lazar ervin', 'A Négyszögletű Kerek Erdő', 1985, 'Móra', 'children', ['folk_tales'], 'hu', 'HU', '#4caf50'],
  ['Petőfi Sándor', 'petofi sandor', 'János vitéz', 1845, 'Móra', 'poetry', ['classics'], 'hu', 'HU', '#b22222'],
  ['Arany János', 'arany janos', 'Toldi', 1847, 'Európa', 'poetry', ['classics'], 'hu', 'HU', '#8b5a2b'],
  ['Madách Imre', 'madach imre', 'Az ember tragédiája', 1861, 'Osiris', 'drama', ['classics', 'philosophy'], 'hu', 'HU', '#2c3e50'],
  ['Böszörményi Gyula', 'boszormenyi gyula', 'Gergő és az álomfogók', 2002, 'Könyvmolyképző', 'fantasy', ['children'], 'hu', 'HU', '#6c3483'],
  ['Mándy Iván', 'mandy ivan', 'Őrizetlenek', 1957, 'Magvető', 'short_stories', [], 'hu', 'HU', '#95a5a6'],
  ['Arthur C. Clarke', 'clarke arthur c', '2001: Űrodüsszeia', 1968, 'Galaktika', 'scifi', [], 'hu', 'GB', '#0b3d91'],
  ['Umberto Eco', 'eco umberto', 'A rózsa neve', 1980, 'Európa', 'historical_fiction', ['crime_thriller'], 'hu', 'IT', '#7f1d1d'],
  ['Gabriel García Márquez', 'garcia marquez gabriel', 'Száz év magány', 1967, 'Magvető', 'literary_fiction', ['classics'], 'hu', 'CO', '#e67e22'],
  ['George Orwell', 'orwell george', '1984', 1949, 'Európa', 'literary_fiction', ['scifi', 'society_politics'], 'hu', 'GB', '#c0392b'],
  ['J. R. R. Tolkien', 'tolkien j r r', 'A Gyűrűk Ura', 1954, 'Európa', 'fantasy', ['classics'], 'hu', 'GB', '#1e8449'],
  ['Agatha Christie', 'christie agatha', 'Gyilkosság az Orient expresszen', 1934, 'Európa', 'crime_thriller', [], 'hu', 'GB', '#154360'],
  ['Yuval Noah Harari', 'harari yuval noah', 'Sapiens – Az emberiség rövid története', 2011, 'Animus', 'history', ['science'], 'hu', 'IL', '#f4d03f'],
  ['Romsics Ignác', 'romsics ignac', 'Magyarország története a XX. században', 1999, 'Osiris', 'history', [], 'hu', 'HU', '#7d6608'],
  ['Csányi Vilmos', 'csanyi vilmos', 'Az emberi természet', 1999, 'Vince', 'science', ['psychology'], 'hu', 'HU', '#117864'],
  ['Horváth Ilona', 'horvath ilona', 'Szakácskönyv', 1954, 'Minerva', 'cooking', [], 'hu', 'HU', '#dc7633'],
  [null, null, 'Magyar értelmező kéziszótár', 2003, 'Akadémiai Kiadó', 'reference', ['language_learning'], 'hu', null, '#5d6d7e'],
  ['Dzsida Jenő', 'dzsida jeno', 'Út a Kálváriára', 1933, 'Kriterion', 'poetry', ['religion'], 'hu', 'RO', '#4a235a'],
];

const STATUSES: ReadingStatus[] = ['read', 'read', 'unknown', 'to_read', 'reading', 'read', 'abandoned', 'unknown'];

export function makeSampleBook(i: number, seed: Seed, variant = 0): BookDTO {
  const [author, authorSort, title, year, publisher, category, topics, lang, country, color] = seed;
  const suffix = variant > 0 ? ` (${variant + 1}. kötet)` : '';
  const created = new Date(Date.UTC(2026, 8, 12, 19, 30, 0) + i * 61_000).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    title: `${title}${suffix}`,
    subtitle: i % 11 === 3 ? 'Válogatott írások' : null,
    author,
    spineAuthor: author,
    spineTitle: title,
    authorSort,
    titleSort: title.toLowerCase(),
    originalTitle: title === 'A rózsa neve' ? 'Il nome della rosa' : title === '1984' ? 'Nineteen Eighty-Four' : null,
    series: i % 9 === 0 ? 'Európa Zsebkönyvek' : null,
    publisher,
    language: lang,
    originalLanguage: country === 'GB' ? 'en' : country === 'IT' ? 'it' : lang,
    authorCountry: country,
    firstPublishedYear: year,
    editionYear: year ? Math.max(year, 1960 + (i % 60)) : null,
    isbn: i % 4 === 0 ? `978963${String(1000000 + i * 7).slice(-7)}` : null,
    pageCount: 120 + ((i * 37) % 600),
    category,
    topics: category ? [category, ...topics] : topics,
    tags: [],
    descriptionHu: i % 3 === 0 ? 'Rövid, tárgyszerű leírás a könyvről – ékezetekkel: árvíztűrő tükörfúrógép.' : null,
    descriptionEn: null,
    coverImage: i % 5 === 0 ? `https://covers.openlibrary.org/b/id/${8_000_000 + i}-L.jpg` : i % 5 === 1 ? `/api/media/covers/334345435/${i}.jpg` : null,
    coverFromOriginalEdition: i % 7 === 3,
    spineImage: `/api/media/spines/334345435/${i}.jpg`,
    spineColor: color,
    source: i % 17 === 5 ? 'manual' : i % 13 === 7 ? 'image' : 'video',
    confidence: i % 7 === 2 ? 0.52 : 0.93,
    needsReview: i % 7 === 2,
    reviewed: false,
    bestFrameId: null,
    bestBbox: null,
    firstVideoId: null,
    firstTimeSec: i * 0.4,
    shelfPosition: i,
    detectionCount: 2 + (i % 4),
    readingStatus: STATUSES[i % STATUSES.length],
    rating: i % 6 === 0 ? 5 : i % 6 === 1 ? 4 : i % 6 === 2 ? 3 : null,
    favorite: i % 8 === 0,
    notes: i % 10 === 0 ? 'Nagymamától kaptam; "dedikált" példány, =SUM(A1) nem képlet' : null,
    lentTo: i % 12 === 0 ? 'Kovács Ödön' : null,
    lentAt: i % 12 === 0 ? '2026-08-01' : null,
    enriched: true,
    createdAt: created,
    updatedAt: created,
  };
}

export function makeSampleCollection(opts: { bookCount?: number; isOwner?: boolean; title?: string | null } = {}): CollectionWithBooksDTO {
  const count = opts.bookCount ?? SAMPLE_SEEDS.length;
  const books: BookDTO[] = [];
  for (let i = 0; i < count; i++) {
    const seed = SAMPLE_SEEDS[i % SAMPLE_SEEDS.length];
    books.push(makeSampleBook(i, seed, Math.floor(i / SAMPLE_SEEDS.length)));
  }
  return {
    id: '334345435',
    title: opts.title === undefined ? 'Nagyszülők könyvespolca – Tőzsér-hagyaték' : opts.title,
    description: 'A nappali nagy diófa polca: magyar klasszikusok, kortárs szerzők és egy kis sci-fi. Őszi leltár, 2026.',
    ownerName: 'Budaházy Ödön',
    locale: 'hu',
    visibility: 'link',
    status: 'ready',
    isOwner: opts.isOwner ?? true,
    email: 'tulajdonos@example.com',
    publicUrl: 'https://www.exlibrisvideo.hu/334345435',
    bookCount: books.length,
    videos: [],
    createdAt: '2026-09-12T19:21:03.000Z',
    updatedAt: '2026-09-12T19:45:00.000Z',
    emailSentAt: null,
    books,
  };
}
