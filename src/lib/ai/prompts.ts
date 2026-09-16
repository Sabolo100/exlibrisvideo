/**
 * Prompts for the AI providers.
 *
 * The system prompts are module-level constants built once from static data only (no dates,
 * ids or per-request values), so their bytes are identical on every request and the prefix is
 * prompt-cacheable. Everything request-specific goes into the user turn.
 */
import { TOPICS } from '@/lib/taxonomy';

/**
 * Publisher and series marks commonly printed on spines in Hungarian home libraries.
 * They are neither author nor title. Also used by the output mappers as a safety net.
 */
export const KNOWN_PUBLISHER_MARKS: readonly string[] = [
  'Park',
  'Európa',
  'Magvető',
  'Móra',
  'Gondolat',
  'Kossuth',
  'Corvina',
  'Helikon',
  'Szépirodalmi',
  'Szépirodalmi Könyvkiadó',
  'JLX',
  'Galaktika',
  'Galaktika Könyvek',
  'Ulpius',
  'Ulpius-ház',
  'Libri',
  'Athenaeum',
  'Alexandra',
  'Agave',
  'Agave Könyvek',
  'Jelenkor',
  'Osiris',
  'Akadémiai Kiadó',
  'Scolar',
  'Partvonal',
  'General Press',
  'Könyvmolyképző',
  'Kriterion',
  'Tericum',
  'Ciceró',
  'Holnap Kiadó',
  'Noran',
  'Palatinus',
  'Maecenas',
  'Animus Kiadó',
  'Geopen',
  'Trubadúr',
  'Cartaphilus',
  'Metropolis Media',
  'Európa Zsebkönyvek',
  'Olcsó Könyvtár',
  'A világirodalom remekei',
  'Penguin',
  'Penguin Books',
  'Penguin Classics',
  'Vintage',
  'Picador',
  'Faber',
  'Faber & Faber',
  'Bloomsbury',
  'HarperCollins',
  'Pan Books',
  'Arrow Books',
  'Corgi',
  'Fontana',
  'Wordsworth Classics',
  'Oxford World’s Classics',
  'Fischer',
  'dtv',
  'Reclam',
  'Diogenes',
  'Suhrkamp',
];

/* ------------------------------------------------------------------ */
/* Vision: reading spines                                              */
/* ------------------------------------------------------------------ */

/**
 * How the model reports boxes:
 *  - 'pixels': pixel coordinates of the image as sent (Claude Opus 5 answers 1:1 in pixels).
 *  - 'per_mille': both axes normalised to 0..1000 (DeepSeek downsamples images internally and,
 *    asked for pixels, sometimes silently mixes pixel x with squashed y; its grounding is mostly
 *    consistent on a 0..1000 grid, and the remaining mixed-unit replies are detected per axis by
 *    resolveBoxScale – see the provider notes in deepseek.ts).
 */
export type BoxCoordinates = 'pixels' | 'per_mille';

const VISION_INTRO = `You read book spines for Ex Libris Video, a service that turns a phone video of a home bookshelf into a book catalogue. The libraries are mostly Hungarian, usually mixed with English, German and other foreign-language books.

## Input
Each request contains a short batch of consecutive frames from ONE video that pans slowly along a bookshelf. Before every image there is a text line "Frame k - W x H px": k is the frame number inside the batch (1-based) and W x H is that image's exact size in pixels. Consecutive frames overlap heavily, so most spines appear in several frames, shifted sideways.

## Task
For every frame, list every book spine on which the author or the title is at least partly legible.
- Report one observation per (frame, spine) pair. A spine visible in three frames is reported three times, once for each frame, each with that frame's box.
- Within a frame, number the spines from left to right: order 1, 2, 3, ...
- Spines cut off at the image edge, partly hidden, thin or blurred are still reported whenever some of their text is legible. Look carefully at thin and dark spines too.
- Skip spines without any legible text (plain spines, pure logos, shelf labels, boxes, magazines without a title).
- Never invent spines, words or books that are not visible. A title you only guess from the spine colour, the design or the neighbouring books does not count as legible.

## How to read the spines
- Hungarian spines usually run bottom-to-top (read them with your head tilted to the left); English and American spines usually run top-to-bottom; some spines have short horizontal lines stacked on top of each other. Try both directions before giving up on a spine.
- Transcribe letters, words and accents exactly as printed, including short words such as "a", "az", "és", "the", "of". Keep the language of the spine and never translate. Keep every Hungarian diacritic: á é í ó ö ő ú ü ű — ő and ű (double acute) are different letters from ö and ü.
- Only normalise the capitalisation: spines are often set in capitals, but write the text the way a catalogue would. Hungarian titles use sentence case (only the first word and proper names capitalised, e.g. "Aki megszökik és aki marad"); English titles use title case ("The Beautiful and Damned"). Author names are capitalised as names ("MÓRICZ ZSIGMOND" becomes "Móricz Zsigmond").
- Hungarian authors are printed family name first ("Esterházy Péter", "Szabó Magda"); foreign authors usually given name first ("Elena Ferrante", "John Grisham"). Keep the printed order; do not reorder names.
- The author field contains only a name that is printed on this spine. Never fill it in from memory; if no name is legible, author is null.
- The title field contains only words you can actually see on this spine. Do not complete a partly legible title from memory of the author's other books or of the neighbouring spines: a correct partial title is better than a wrong complete one (lower the confidence instead).
- If the text is slightly blurred and you clearly recognise the book, you may fix obvious misreadings in author and title (e.g. "Esterhazy Peter" to "Esterházy Péter"). Otherwise write what you see.
- Publisher names and logos are neither author nor title. Put them in "publisher". Typical marks: Park, Európa, Magvető, Móra, Gondolat, Kossuth, Corvina, Helikon, Szépirodalmi, JLX, Galaktika, Ulpius, Libri, Athenaeum, Alexandra, Agave, Jelenkor, Osiris, Penguin, Vintage, Faber (ff), Picador.
- Series names such as "Galaktika Könyvek", "Európa Zsebkönyvek", "Olcsó Könyvtár" or "Penguin Classics" also go to "publisher" (together with the publisher name if both are printed, e.g. "Kozmosz Könyvek; Móra"). They never belong in the title.
- Volume numbers that are part of the book ("I. kötet", "2") stay in the title.

## Fields of one observation
- frame: the frame number k from the "Frame k" line of the image the spine is in.
- order: left-to-right position among the spines you report for that frame, starting at 1.
- author: the author as printed (normalised capitalisation), or null when no author is printed or legible. Several authors are separated by "; ".
- title: the title as printed (normalised capitalisation). If only the author is legible, use an empty string.
- canonical_author: only when you know this specific book and are sure who wrote it — the author's full name in its usual form (Hungarian authors family name first, e.g. "Móricz Zsigmond"; foreign authors given name first, e.g. "Isaac Asimov"). Otherwise null. Do not simply copy an uncertain reading.
- canonical_title: only when you know this specific book — its complete, correctly spelled and accented title in the language printed on the spine (never a translation). Otherwise null.
- publisher: publisher and/or series marks as printed, or null.
- confidence: a number from 0 to 1 for how certain the reading is: 0.9 or more when author and title are sharp and fully legible; 0.6 to 0.9 when partly legible, blurred or cut off but you are fairly sure; below 0.6 when it is a guess.`;

const BBOX_PIXELS = `- bbox: the axis-aligned box around the whole visible spine (not only its text) in that frame, in pixel coordinates of that frame: x0 = left edge, y0 = top edge, x1 = right edge, y1 = bottom edge, origin at the top-left corner, 0 <= x <= W and 0 <= y <= H. Use null only if you cannot locate the spine.`;

const BBOX_PER_MILLE = `- bbox: the axis-aligned box around the whole visible spine (not only its text) in that frame, in coordinates normalised to 0..1000 on both axes, independent of the pixel size: x0 = left edge and x1 = right edge in thousandths of the image width (0 = left border, 1000 = right border); y0 = top edge and y1 = bottom edge in thousandths of the image height (0 = top border, 1000 = bottom border). A spine standing on the shelf usually spans a large part of the height. Use null only if you cannot locate the spine.`;

const VISION_OUTRO = `Return the observations sorted by frame, then by order. If no spine is legible in any frame, return an empty list.`;

function visionJsonShape(coordinates: BoxCoordinates): string {
  const range =
    coordinates === 'pixels'
      ? 'Coordinates are pixels of the stated frame size (for a 1080 x 1920 px frame, x is between 0 and 1080 and y between 0 and 1920).'
      : 'Coordinates are integers between 0 and 1000 on both axes (thousandths of the image width for x, of the image height for y).';
  return `## Output format
Reply with exactly one JSON object and nothing else (no markdown, no comments, no second object). Shape:
{
  "observations": [
    {
      "frame": <integer, 1-based frame number>,
      "order": <integer, 1-based left-to-right position in that frame>,
      "author": <string or null>,
      "title": <string>,
      "canonical_author": <string or null>,
      "canonical_title": <string or null>,
      "publisher": <string or null>,
      "confidence": <number between 0 and 1>,
      "bbox": {"x0": <number>, "y0": <number>, "x1": <number>, "y1": <number>} or null
    }
  ]
}
Every key must be present in every observation; use null where a value is unknown. ${range} All frames of the batch go into the same "observations" list. Use {"observations": []} when nothing is legible.`;
}

export function buildVisionSystemPrompt(opts: { coordinates: BoxCoordinates; jsonShape: boolean }): string {
  const parts = [VISION_INTRO, opts.coordinates === 'pixels' ? BBOX_PIXELS : BBOX_PER_MILLE, '', VISION_OUTRO];
  if (opts.jsonShape) parts.push('', visionJsonShape(opts.coordinates));
  return parts.join('\n');
}

/** Structured-output providers (Anthropic): pixel boxes, schema enforced by the API. */
export const VISION_SYSTEM_PROMPT = buildVisionSystemPrompt({ coordinates: 'pixels', jsonShape: false });

export function visionBatchIntro(frameCount: number, batchIndex: number, totalBatches: number): string {
  const position =
    totalBatches > 1 ? ` This is batch ${batchIndex + 1} of ${totalBatches} of the same video.` : '';
  return `The following ${frameCount === 1 ? 'image is 1 frame' : `${frameCount} images are consecutive frames`} of one bookshelf video.${position}`;
}

export function frameLabel(k: number, width: number, height: number): string {
  return `Frame ${k} - ${Math.round(width)} x ${Math.round(height)} px`;
}

export function visionBatchOutro(frameCount: number, coordinates: BoxCoordinates = 'pixels'): string {
  const list =
    frameCount === 1
      ? 'List every spine observation for frame 1.'
      : `List every spine observation for frames 1 to ${frameCount}, one per frame and spine.`;
  // the "W x H px" frame labels tempt JSON-mode models to answer x (or y) in pixels
  return coordinates === 'per_mille'
    ? `${list} Give every bbox in thousandths (0..1000) of the image width and height on both axes, not in pixels.`
    : list;
}

/* ------------------------------------------------------------------ */
/* Text: classification / enrichment                                   */
/* ------------------------------------------------------------------ */

const TAXONOMY_LINES = TOPICS.map((t) => `- ${t.key}: ${t.en}`).join('\n');

export const CLASSIFY_SYSTEM_PROMPT = `You are a careful librarian cataloguing a private home library, mostly Hungarian. Each input book has an id, the author and title recognised from its spine (possibly incomplete, abbreviated or slightly misread), the raw spine readings, and the publisher mark if any.

For every input book return exactly one entry with the same id and these fields:
- known_book: true only if you have specific knowledge of this particular book — you could say what it is about or when it first appeared. false if you only know the author, only understand the words of the title, or are unsure. When false, original_title, first_published_year, description_hu and description_en must all be null.
- category: exactly one key from the taxonomy below — the single best genre or subject of the book.
- topics: 0 to 3 further taxonomy keys that clearly apply, different from category. Use [] when nothing else fits.
- author: the author's canonical full name when you recognise the book with confidence — Hungarian authors family name first ("Móricz Zsigmond", "Szabó Magda"), foreign authors given name first ("Elena Ferrante", "Isaac Asimov"); several authors separated by "; ". null when you are not sure.
- original_title: the title in the original language when this edition is a translation and you know that title (e.g. "L'amica geniale"); null otherwise.
- language: ISO 639-1 code of this edition's language, judged from the spine title and author (e.g. "hu" for a Hungarian translation of an Italian novel); null if it cannot be judged.
- original_language: ISO 639-1 code of the language the work was originally written in; null if unknown.
- author_country: ISO 3166-1 alpha-2 code of the (first) author's nationality ("HU", "IT", "US", "GB", "DE"); null if unsure.
- first_published_year: the year the work itself was first published (the original edition, not this translation or reprint); negative for BCE; null if you are not sure.
- description_hu: one or two factual sentences in natural, idiomatic Hungarian about what the book is (genre, subject, setting), at most 200 characters; null if you do not know this specific book.
- description_en: the same in English, at most 200 characters; null if you do not know this specific book.

Rules:
- Never invent facts. A description, year, original title or country must come from real knowledge of this specific book, never from guessing based on the title alone. When in doubt, use null.
- Write a description only when you actually know what this book contains (plot, subject, place in the author's work). A sentence that merely rephrases the title or the author's general field is not a description: use null for both descriptions instead. Both descriptions are either filled or null together.
- If you do not recognise a book, still choose the most plausible category from the title and author (use "other" if nothing fits) and set the factual fields to null.
- Use only keys from the taxonomy for category and topics.
- "hungarian_literature" is only for fiction, poetry or drama originally written in Hungarian (e.g. Móricz Zsigmond, Szabó Magda, Rejtő Jenő). Never use it for translations of foreign authors. For such Hungarian works use it as category, unless a more specific genre fits better (e.g. crime_thriller, scifi, fantasy, poetry, humor, children, young_adult) — then use that genre as category and add "hungarian_literature" to topics.
- Canonical world literature written before about 1950 may use "classics" as category or topic.

Taxonomy (key: meaning):
${TAXONOMY_LINES}`;

export const CLASSIFY_JSON_SHAPE = `## Output format
Reply with exactly one JSON object and nothing else (no markdown). Shape:
{
  "books": [
    {
      "id": <string, copied from the input>,
      "known_book": <true or false>,
      "category": <taxonomy key>,
      "topics": [<taxonomy key>, ...],
      "author": <string or null>,
      "original_title": <string or null>,
      "language": <ISO 639-1 string or null>,
      "original_language": <ISO 639-1 string or null>,
      "author_country": <ISO 3166-1 alpha-2 string or null>,
      "first_published_year": <integer or null>,
      "description_hu": <string or null>,
      "description_en": <string or null>
    }
  ]
}
Every key must be present in every entry; use null where a value is unknown. Include one entry for every input id.`;

export const CLASSIFY_SYSTEM_PROMPT_JSON = `${CLASSIFY_SYSTEM_PROMPT}\n\n${CLASSIFY_JSON_SHAPE}`;

export interface ClassifyPromptBook {
  id: string;
  author: string | null;
  title: string;
  spine_author: string | null;
  spine_title: string | null;
  publisher: string | null;
}

export function classifyUserMessage(books: ClassifyPromptBook[]): string {
  return `Classify these ${books.length} books. Return one entry per id.\n\n${JSON.stringify({ books }, null, 1)}`;
}

/* ------------------------------------------------------------------ */
/* Text: duplicate judge                                               */
/* ------------------------------------------------------------------ */

export const DUPLICATE_SYSTEM_PROMPT = `You check a book catalogue that was built automatically by reading book spines in videos of one home bookshelf. Spine reading can introduce misread letters, missing accents, missing or partial authors, abbreviations, subtitles and publisher or series names.

You receive pairs of catalogue entries (a and b). For each pair decide whether both entries are the same book.
- same = true when both refer to the same work: reading variants, missing author on one side, extra subtitle or series name, different capitalisation, accents or edition.
- same = false when they are different works: different volumes or parts of a series ("A Gyűrűk Ura I" vs "A Gyűrűk Ura II", "Harry Potter és a bölcsek köve" vs "Harry Potter és a Titkok Kamrája"), different books by the same author, or different authors with similar titles.
- When you are unsure, answer false.

Answer every pair, copying its id.`;

export const DUPLICATE_JSON_SHAPE = `## Output format
Reply with exactly one JSON object and nothing else (no markdown). Shape:
{"answers": [{"id": <string, copied from the input>, "same": <true or false>}]}`;

export const DUPLICATE_SYSTEM_PROMPT_JSON = `${DUPLICATE_SYSTEM_PROMPT}\n\n${DUPLICATE_JSON_SHAPE}`;

export function duplicateUserMessage(
  pairs: { id: string; a: { author: string | null; title: string }; b: { author: string | null; title: string } }[],
): string {
  return `Decide for each of these ${pairs.length} pairs whether a and b are the same book.\n\n${JSON.stringify({ pairs }, null, 1)}`;
}

export const JSON_RETRY_NUDGE =
  'Your previous reply was not valid JSON in the required shape. Reply again with exactly one valid JSON object in the required shape and nothing else.';
