/**
 * Book visuals – import from "@/components/books".
 * Pure helpers (colours, sorting, filtering, initials) live in "@/lib/book-utils".
 */
export { BookSpine, spineLabel, type BookSpineProps } from './BookSpine';
export { BookCover, type BookCoverProps } from './BookCover';
export { coverTitleSize, type CoverVariant } from './cover-layout';
export { Shelf, type ShelfProps } from './Shelf';
export { TopicChip, type TopicChipProps } from './TopicChip';
export { ReadingStatusBadge, READING_STATUS_META, type ReadingStatusBadgeProps } from './ReadingStatusBadge';
export { ConfidenceMeter, confidenceLevel, type ConfidenceMeterProps, type ConfidenceLevel } from './ConfidenceMeter';
export { CountryFlag, type CountryFlagProps } from './CountryFlag';
export { useFlagEmojiSupport, detectFlagEmojiSupport } from './flag-support';
export { LanguageLabel, type LanguageLabelProps } from './LanguageLabel';
export {
  SPINE_SIZES,
  SHELF_GEOMETRY,
  shelfRowHeight,
  spineBox,
  spineAppearance,
  spineTextLayout,
  type SpineSize,
  type SpineVariant,
} from './spine-layout';
export { makeSampleBook, SAMPLE_BOOKS } from './sample-books';
