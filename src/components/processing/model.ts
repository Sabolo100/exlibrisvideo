/**
 * Pure view-model helpers of the processing screen (no React, unit tested).
 */
import type { BookDTO, CollectionStatus, CollectionStatusDTO, CollectionWithBooksDTO, VideoDTO } from '@/lib/types';

export const PIPELINE_STAGES = ['probe', 'frames', 'vision', 'merge', 'crops', 'enrich'] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];
export type StepState = 'done' | 'active' | 'pending' | 'error';

export const VIDEO_ERROR_CODES = ['too_long', 'unreadable', 'no_frames', 'no_books', 'ai_failed', 'internal'] as const;
export type VideoErrorCode = (typeof VIDEO_ERROR_CODES)[number];

/** What a source card shows. */
export type SourcePhase =
  | 'uploading'
  | 'interrupted'
  | 'queued'
  | 'processing'
  | 'waiting_enrich'
  | 'enriching'
  | 'done'
  | 'error';

export function sourcePhase(video: VideoDTO, collectionStatus: CollectionStatus, uploadingHere: boolean): SourcePhase {
  if (video.uploadStatus === 'failed' || video.status === 'error') return 'error';
  if (video.uploadStatus === 'uploading') return uploadingHere ? 'uploading' : 'interrupted';
  if (video.status === 'pending' || video.status === 'queued') return 'queued';
  if (video.status === 'processing') return 'processing';
  // status done
  if (video.stage === 'enrich') return 'enriching';
  if (collectionStatus === 'ready') return 'done';
  return 'waiting_enrich';
}

/**
 * The processing state of a source whose upload finished in this tab, for the "Uploaded · …" label of the upload
 * list: null while the last status poll does not list the source as uploaded yet ("Uploaded" alone is right then).
 */
export function finishedUploadPhase(
  upload: { status: string; videoId?: string },
  status: Pick<CollectionStatusDTO, 'status' | 'videos'>,
): Exclude<SourcePhase, 'uploading' | 'interrupted'> | null {
  if (upload.status !== 'done' || !upload.videoId) return null;
  const video = status.videos.find((v) => v.id === upload.videoId);
  if (!video || video.uploadStatus === 'uploading') return null;
  const phase = sourcePhase(video, status.status, true);
  return phase === 'uploading' || phase === 'interrupted' ? null : phase;
}

/** State of every pipeline step for one source. */
export function stageSteps(video: VideoDTO, phase: SourcePhase): { stage: PipelineStage; state: StepState }[] {
  const idxOf = (s: string | null) => PIPELINE_STAGES.indexOf(s as PipelineStage);
  let states: StepState[];
  switch (phase) {
    case 'uploading':
    case 'interrupted':
    case 'queued':
      states = PIPELINE_STAGES.map(() => 'pending');
      break;
    case 'processing': {
      const current = Math.max(0, idxOf(video.stage));
      states = PIPELINE_STAGES.map((_, i) => (i < current ? 'done' : i === current ? 'active' : 'pending'));
      break;
    }
    case 'waiting_enrich':
      states = PIPELINE_STAGES.map((s) => (s === 'enrich' ? 'pending' : 'done'));
      break;
    case 'enriching':
      states = PIPELINE_STAGES.map((s) => (s === 'enrich' ? 'active' : 'done'));
      break;
    case 'done':
      states = PIPELINE_STAGES.map(() => 'done');
      break;
    case 'error': {
      const failedAt = video.uploadStatus === 'failed' ? 0 : Math.max(0, idxOf(video.stage));
      states = PIPELINE_STAGES.map((_, i) => (i < failedAt ? 'done' : i === failedAt ? 'error' : 'pending'));
      break;
    }
  }
  return PIPELINE_STAGES.map((stage, i) => ({ stage, state: states[i] }));
}

/** The step to describe in one line (active, failed, or the next pending one). */
export function focusStep(steps: { stage: PipelineStage; state: StepState }[]): { stage: PipelineStage; index: number } | null {
  const i =
    steps.findIndex((s) => s.state === 'error') >= 0
      ? steps.findIndex((s) => s.state === 'error')
      : steps.findIndex((s) => s.state === 'active');
  if (i < 0) return null;
  return { stage: steps[i].stage, index: i };
}

export function isVideoErrorCode(v: unknown): v is VideoErrorCode {
  return typeof v === 'string' && (VIDEO_ERROR_CODES as readonly string[]).includes(v);
}

/** Overall phase of the collection for the headline. */
export type OverallPhase = 'empty' | 'uploading' | 'interrupted' | 'processing' | 'enriching' | 'ready' | 'error';

/**
 * @param localUploads unfinished uploads of this collection running in this browser tab
 */
export function overallPhase(status: Pick<CollectionStatusDTO, 'status' | 'videos'>, localUploads: number): OverallPhase {
  if (status.status === 'ready') return 'ready';
  const videos = status.videos;
  if (videos.some((v) => v.status === 'processing' || v.status === 'queued')) return 'processing';
  if (videos.some((v) => v.stage === 'enrich')) return 'enriching';
  if (localUploads > 0) return 'uploading';
  const live = videos.filter((v) => v.uploadStatus !== 'failed' && v.status !== 'error');
  // an upload that nobody continues keeps the collection from finishing
  if (live.some((v) => v.uploadStatus === 'uploading')) return 'interrupted';
  // every uploaded source is done: enrichment is about to start
  if (live.some((v) => v.uploadStatus === 'uploaded')) return 'enriching';
  if (status.status === 'error' || videos.length > 0) return 'error';
  return 'empty';
}

/** Same formula as the API's computeCollectionProgress (for the first render from the page's DTO). */
export function estimateProgress(status: CollectionStatus, videos: readonly VideoDTO[]): number {
  const uploaded = videos.filter((v) => v.uploadStatus === 'uploaded');
  if (uploaded.length === 0) return status === 'ready' ? 100 : 0;
  const total = uploaded.reduce((sum, v) => {
    if (v.status === 'done' || v.status === 'error') return sum + 100;
    if (v.status === 'processing') return sum + Math.min(100, Math.max(0, v.progress || 0));
    return sum;
  }, 0);
  let progress = Math.round(total / uploaded.length);
  if (status !== 'ready' && status !== 'error') progress = Math.min(progress, 99);
  return Math.min(100, Math.max(0, progress));
}

export function statusFromCollection(c: CollectionWithBooksDTO): CollectionStatusDTO {
  return {
    id: c.id,
    status: c.status,
    progress: estimateProgress(c.status, c.videos),
    bookCount: c.bookCount,
    videos: c.videos,
    updatedAt: c.updatedAt,
  };
}

/** Books ordered as they stand on the shelf. */
export function shelfOrder(books: readonly BookDTO[]): BookDTO[] {
  return [...books].sort((a, b) => a.shelfPosition - b.shelfPosition || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/**
 * The books to show on the "appearing" shelf: the `limit` most recently recognised ones, in shelf order.
 * Returns the shown books and how many were left out.
 */
export function appearingBooks(books: readonly BookDTO[], limit: number): { shown: BookDTO[]; hidden: number } {
  if (books.length <= limit) return { shown: shelfOrder(books), hidden: 0 };
  const recent = [...books].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, limit);
  return { shown: shelfOrder(recent), hidden: books.length - limit };
}

/** Newest books first (for the "latest found" ticker). */
export function latestBooks(books: readonly BookDTO[], count: number): BookDTO[] {
  return [...books].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)).slice(0, count);
}

/** Ids present in `books` but not in `known`. */
export function newBookIds(known: ReadonlySet<string>, books: readonly BookDTO[]): string[] {
  return books.filter((b) => !known.has(b.id)).map((b) => b.id);
}

/** Upload-in-progress sources that the local upload store does not know (interrupted by a reload / another device). */
export function interruptedUploads(videos: readonly VideoDTO[], localVideoIds: ReadonlySet<string>): VideoDTO[] {
  return videos.filter((v) => v.uploadStatus === 'uploading' && !localVideoIds.has(v.id));
}

/** Why a source failed, as a localizable kind (null when it did not fail). Unknown codes / legacy messages → internal. */
export type SourceErrorKind = VideoErrorCode | 'upload_failed';

export function sourceErrorKind(video: Pick<VideoDTO, 'uploadStatus' | 'status' | 'error'>): SourceErrorKind | null {
  if (video.uploadStatus === 'failed') return 'upload_failed';
  if (video.status !== 'error') return null;
  return isVideoErrorCode(video.error) ? video.error : 'internal';
}

/** Sources in upload order. */
export function sortSources(videos: readonly VideoDTO[]): VideoDTO[] {
  return [...videos].sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

/** "2 / 3 sources done": finished (done or failed) sources out of all uploaded ones. */
export function sourceCounts(videos: readonly VideoDTO[]): { done: number; total: number } {
  const uploaded = videos.filter((v) => v.uploadStatus === 'uploaded');
  return { done: uploaded.filter((v) => v.status === 'done' || v.status === 'error').length, total: uploaded.length };
}

/** Combined progress of local uploads: bytes-weighted percent (0..100) plus finished / total file counts. */
export function uploadTotals(
  items: readonly { size: number; bytesSent: number; status: string }[],
): { percent: number; done: number; total: number } {
  const relevant = items.filter((i) => i.status !== 'canceled');
  const size = relevant.reduce((s, i) => s + Math.max(0, i.size), 0);
  const sent = relevant.reduce((s, i) => s + (i.status === 'done' ? Math.max(0, i.size) : Math.min(Math.max(0, i.bytesSent), i.size)), 0);
  const done = relevant.filter((i) => i.status === 'done').length;
  const percent = size > 0 ? Math.min(100, Math.max(0, (sent / size) * 100)) : relevant.length > 0 && done === relevant.length ? 100 : 0;
  return { percent, done, total: relevant.length };
}
