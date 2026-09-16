/**
 * Fixed, bilingual topic taxonomy. The AI classifier MUST only return these keys,
 * so grouping, filtering, charts and exports stay consistent across collections.
 */
import type { Locale } from './types';

export interface TopicDef {
  key: string;
  hu: string;
  en: string;
  /** emoji used as a lightweight icon in chips and charts */
  icon: string;
  /** base hue (0–360) for chart / chip colours */
  hue: number;
  /** broad group for the topics view */
  group: 'fiction' | 'nonfiction' | 'arts' | 'young' | 'reference';
}

export const TOPICS: TopicDef[] = [
  // fiction
  { key: 'literary_fiction', hu: 'Szépirodalom', en: 'Literary fiction', icon: '📖', hue: 350, group: 'fiction' },
  { key: 'classics', hu: 'Klasszikusok', en: 'Classics', icon: '🏛️', hue: 30, group: 'fiction' },
  { key: 'hungarian_literature', hu: 'Magyar irodalom', en: 'Hungarian literature', icon: '📕', hue: 5, group: 'fiction' },
  { key: 'poetry', hu: 'Költészet', en: 'Poetry', icon: '🪶', hue: 280, group: 'fiction' },
  { key: 'drama', hu: 'Dráma', en: 'Drama & plays', icon: '🎭', hue: 300, group: 'fiction' },
  { key: 'crime_thriller', hu: 'Krimi, thriller', en: 'Crime & thriller', icon: '🔍', hue: 220, group: 'fiction' },
  { key: 'scifi', hu: 'Sci-fi', en: 'Science fiction', icon: '🚀', hue: 195, group: 'fiction' },
  { key: 'fantasy', hu: 'Fantasy', en: 'Fantasy', icon: '🐉', hue: 265, group: 'fiction' },
  { key: 'historical_fiction', hu: 'Történelmi regény', en: 'Historical fiction', icon: '⚔️', hue: 25, group: 'fiction' },
  { key: 'romance', hu: 'Romantikus', en: 'Romance', icon: '💌', hue: 335, group: 'fiction' },
  { key: 'humor', hu: 'Humor, szatíra', en: 'Humour & satire', icon: '😄', hue: 50, group: 'fiction' },
  { key: 'short_stories', hu: 'Novellák', en: 'Short stories', icon: '📝', hue: 15, group: 'fiction' },
  // non-fiction
  { key: 'history', hu: 'Történelem', en: 'History', icon: '📜', hue: 35, group: 'nonfiction' },
  { key: 'biography', hu: 'Életrajz, memoár', en: 'Biography & memoir', icon: '👤', hue: 45, group: 'nonfiction' },
  { key: 'science', hu: 'Tudomány', en: 'Science', icon: '🔬', hue: 180, group: 'nonfiction' },
  { key: 'nature', hu: 'Természet, földrajz', en: 'Nature & geography', icon: '🌿', hue: 120, group: 'nonfiction' },
  { key: 'technology', hu: 'Technika, informatika', en: 'Technology & computing', icon: '💻', hue: 205, group: 'nonfiction' },
  { key: 'philosophy', hu: 'Filozófia', en: 'Philosophy', icon: '🦉', hue: 250, group: 'nonfiction' },
  { key: 'religion', hu: 'Vallás, spiritualitás', en: 'Religion & spirituality', icon: '🕯️', hue: 40, group: 'nonfiction' },
  { key: 'psychology', hu: 'Pszichológia', en: 'Psychology', icon: '🧠', hue: 310, group: 'nonfiction' },
  { key: 'self_help', hu: 'Önfejlesztés', en: 'Self-help', icon: '🌱', hue: 95, group: 'nonfiction' },
  { key: 'society_politics', hu: 'Társadalom, politika', en: 'Society & politics', icon: '🏛', hue: 0, group: 'nonfiction' },
  { key: 'business_economics', hu: 'Üzlet, közgazdaság', en: 'Business & economics', icon: '📈', hue: 150, group: 'nonfiction' },
  { key: 'health_lifestyle', hu: 'Egészség, életmód', en: 'Health & lifestyle', icon: '🍎', hue: 110, group: 'nonfiction' },
  { key: 'cooking', hu: 'Gasztronómia', en: 'Food & cooking', icon: '🍳', hue: 20, group: 'nonfiction' },
  { key: 'travel', hu: 'Utazás', en: 'Travel', icon: '🧭', hue: 170, group: 'nonfiction' },
  { key: 'military', hu: 'Hadtörténet', en: 'Military history', icon: '🎖️', hue: 60, group: 'nonfiction' },
  // arts
  { key: 'art', hu: 'Művészet', en: 'Art', icon: '🎨', hue: 320, group: 'arts' },
  { key: 'music', hu: 'Zene', en: 'Music', icon: '🎼', hue: 275, group: 'arts' },
  { key: 'film_theatre', hu: 'Film, színház', en: 'Film & theatre', icon: '🎬', hue: 230, group: 'arts' },
  { key: 'architecture_design', hu: 'Építészet, design', en: 'Architecture & design', icon: '📐', hue: 190, group: 'arts' },
  // young readers
  { key: 'children', hu: 'Gyerekkönyv', en: "Children's books", icon: '🧸', hue: 45, group: 'young' },
  { key: 'young_adult', hu: 'Ifjúsági', en: 'Young adult', icon: '🎒', hue: 160, group: 'young' },
  { key: 'folk_tales', hu: 'Mese, monda, mítosz', en: 'Folk tales & myths', icon: '🏰', hue: 285, group: 'young' },
  { key: 'comics', hu: 'Képregény', en: 'Comics & graphic novels', icon: '💥', hue: 10, group: 'young' },
  // reference
  { key: 'reference', hu: 'Lexikon, szótár', en: 'Reference & dictionaries', icon: '📚', hue: 210, group: 'reference' },
  { key: 'education', hu: 'Tankönyv, oktatás', en: 'Education & textbooks', icon: '🎓', hue: 240, group: 'reference' },
  { key: 'language_learning', hu: 'Nyelvtanulás', en: 'Language learning', icon: '🗣️', hue: 140, group: 'reference' },
  { key: 'hobbies', hu: 'Hobbi, sport', en: 'Hobbies & sport', icon: '⚽', hue: 100, group: 'reference' },
  { key: 'other', hu: 'Egyéb', en: 'Other', icon: '🔖', hue: 0, group: 'reference' },
];

export const TOPIC_KEYS = TOPICS.map((t) => t.key);
const byKey = new Map(TOPICS.map((t) => [t.key, t]));

export function topicDef(key: string | null | undefined): TopicDef | undefined {
  return key ? byKey.get(key) : undefined;
}

export function topicLabel(key: string | null | undefined, locale: Locale): string {
  const d = topicDef(key);
  return d ? d[locale] : key ?? '';
}

export function isTopicKey(key: string): boolean {
  return byKey.has(key);
}

export const TOPIC_GROUP_LABELS: Record<TopicDef['group'], { hu: string; en: string }> = {
  fiction: { hu: 'Szépirodalom', en: 'Fiction' },
  nonfiction: { hu: 'Ismeretterjesztő', en: 'Non-fiction' },
  arts: { hu: 'Művészetek', en: 'Arts' },
  young: { hu: 'Gyerek és ifjúsági', en: 'Young readers' },
  reference: { hu: 'Kézikönyvek, egyéb', en: 'Reference & other' },
};
