/**
 * Icons and label keys of the views, sort keys and export formats used by the shell.
 */
import {
  ChartColumn,
  ClipboardCheck,
  Film,
  History,
  LayoutGrid,
  Library,
  Shapes,
  Table2,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { MessageKey } from '@/i18n';
import type { CollectionDTO, ExportFormat, ViewKey } from '@/lib/types';
import type { SortKey } from './context';

export const VIEW_META: Record<ViewKey, { icon: LucideIcon; labelKey: MessageKey }> = {
  shelf: { icon: Library, labelKey: 'collection.view.shelf' },
  covers: { icon: LayoutGrid, labelKey: 'collection.view.covers' },
  table: { icon: Table2, labelKey: 'collection.view.table' },
  authors: { icon: Users, labelKey: 'collection.view.authors' },
  topics: { icon: Shapes, labelKey: 'collection.view.topics' },
  timeline: { icon: History, labelKey: 'collection.view.timeline' },
  stats: { icon: ChartColumn, labelKey: 'collection.view.stats' },
  frames: { icon: Film, labelKey: 'collection.view.frames' },
  review: { icon: ClipboardCheck, labelKey: 'collection.view.review' },
};

export const SORT_LABELS: Record<SortKey, MessageKey> = {
  shelf: 'collection.sort.shelf',
  author: 'collection.sort.author',
  title: 'collection.sort.title',
  year: 'collection.sort.year',
  added: 'collection.sort.added',
  rating: 'collection.sort.rating',
};

export const EXPORT_META: Record<ExportFormat, { labelKey: MessageKey; hintKey: MessageKey }> = {
  xlsx: { labelKey: 'collection.export.xlsx', hintKey: 'collection.export.xlsxHint' },
  csv: { labelKey: 'collection.export.csv', hintKey: 'collection.export.csvHint' },
  pdf: { labelKey: 'collection.export.pdf', hintKey: 'collection.export.pdfHint' },
  json: { labelKey: 'collection.export.json', hintKey: 'collection.export.jsonHint' },
  goodreads: { labelKey: 'collection.export.goodreads', hintKey: 'collection.export.goodreadsHint' },
};

/** Menu order of the export formats (most useful first). */
export const EXPORT_ORDER: readonly ExportFormat[] = ['xlsx', 'pdf', 'csv', 'goodreads', 'json'];

/** Views offered for this collection, in switcher order. */
export function availableViews(collection: Pick<CollectionDTO, 'isOwner' | 'videos'>): ViewKey[] {
  const views: ViewKey[] = ['shelf', 'covers', 'table', 'authors', 'topics', 'timeline', 'stats'];
  // "how we saw it" needs analysed frames
  if (collection.videos.some((v) => v.framesTotal > 0)) views.push('frames');
  if (collection.isOwner) views.push('review');
  return views;
}

/** Views whose content is the filtered book list (a "no results" state replaces them when empty). */
export const FILTERED_VIEWS: ReadonlySet<ViewKey> = new Set(['shelf', 'covers', 'table', 'authors', 'topics', 'timeline', 'stats']);
