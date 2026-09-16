'use client';

/**
 * Live processing view shown on /<id> while the collection is draft / processing (owner: frontend-landing).
 *
 * - polls api.getStatus every 2 s (10 s while nothing can change, slower when the tab is hidden or the
 *   network fails) and api.getCollection every 5 s for the "books appearing" shelf (skipped while the
 *   book count is unchanged, at least every 20 s);
 * - shows the in-flight uploads of the module-level upload store, a card per source with the stage
 *   stepper, the share block (link, QR, owner link), owner-only "add more videos" and "e-mail me";
 * - calls onReady() once when the status becomes `ready`.
 */
import { CircleAlert, RefreshCw, UploadCloud, WifiOff } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { useCollectionUploads, useUploadLimits } from '@/components/upload/hooks';
import { Uploader } from '@/components/upload/Uploader';
import { UploadFileList } from '@/components/upload/UploadFileList';
import { api, ApiClientError } from '@/lib/client/api';
import { isActiveStatus, uploadStore, type UploadItem } from '@/lib/client/upload-store';
import type { BookDTO, CollectionStatusDTO, CollectionWithBooksDTO, VideoDTO } from '@/lib/types';
import { AppearingShelf } from './AppearingShelf';
import { EmailWhenReady } from './EmailWhenReady';
import {
  finishedUploadPhase,
  interruptedUploads,
  overallPhase,
  sortSources,
  sourceCounts,
  statusFromCollection,
  uploadTotals,
  type OverallPhase,
} from './model';
import { SharePanel } from './SharePanel';
import { SourceCard } from './SourceCard';
import { TipsCarousel } from './TipsCarousel';
import { usePolling } from './usePolling';

export interface ProcessingPanelProps {
  initial: CollectionWithBooksDTO;
  isOwner: boolean;
  onReady: () => void;
  /** extra classes for the outer element; the page provides the centred, padded container (CollectionPage does) */
  className?: string;
}

type Connection = 'ok' | 'offline' | 'gone' | 'forbidden';

const STATUS_MS = 2000;
const IDLE_STATUS_MS = 10_000;
const BOOKS_MS = 5000;
const BOOKS_MAX_AGE_MS = 20_000;
/** finished uploads disappear from the upload list this long after the last one completed (or the panel appeared) */
const CLEAR_FINISHED_MS = 8000;

const HEADLINE: Record<OverallPhase, MessageKey> = {
  empty: 'processing.headline.empty',
  uploading: 'processing.headline.uploading',
  interrupted: 'processing.headline.interrupted',
  processing: 'processing.headline.processing',
  enriching: 'processing.headline.enriching',
  ready: 'processing.headline.ready',
  error: 'processing.headline.error',
};

function subline(phase: OverallPhase, isOwner: boolean): MessageKey {
  switch (phase) {
    case 'empty':
      return isOwner ? 'processing.headline.empty.subOwner' : 'processing.headline.empty.subViewer';
    case 'uploading':
      return 'processing.headline.uploading.sub';
    case 'interrupted':
      return isOwner ? 'processing.headline.interrupted.subOwner' : 'processing.headline.interrupted.subViewer';
    case 'processing':
      return 'processing.headline.processing.sub';
    case 'enriching':
      return 'processing.headline.enriching.sub';
    case 'ready':
      return 'processing.headline.ready.sub';
    case 'error':
      return 'processing.headline.error.sub';
  }
}

export function ProcessingPanel({ initial, isOwner, onReady, className }: ProcessingPanelProps) {
  const { t, tp, n } = useI18n();
  const { toast } = useToast();
  const id = initial.id;
  const limits = useUploadLimits();

  const [status, setStatus] = useState<CollectionStatusDTO>(() => statusFromCollection(initial));
  const [books, setBooks] = useState<BookDTO[]>(initial.books);
  const [meta, setMeta] = useState(() => ({
    title: initial.title,
    email: initial.email,
    emailSentAt: initial.emailSentAt,
    publicUrl: initial.publicUrl,
  }));
  const [connection, setConnection] = useState<Connection>('ok');
  const [failures, setFailures] = useState(0);
  /**
   * The uploader leads an empty draft (nothing uploaded, nothing uploading from this tab). Decided once:
   * moving it between columns later would remount it and drop its messages. (A full page load starts
   * with an empty upload store on server and client alike, so hydration sees the same value.)
   */
  const [uploaderFirst] = useState(
    () =>
      initial.videos.length === 0 &&
      initial.status !== 'ready' &&
      !uploadStore.getSnapshot().items.some((i) => i.collectionId === initial.id && i.status !== 'canceled'),
  );
  const failuresRef = useRef(0);
  /** when the books were last fetched and how many there were (initial data counts as a fetch) */
  const booksFetchRef = useRef({ at: Date.now(), count: initial.books.length });

  // a fresher server render of the page (router.refresh) replaces the local state
  const initialRef = useRef(initial);
  useEffect(() => {
    if (initialRef.current === initial) return;
    initialRef.current = initial;
    setStatus(statusFromCollection(initial));
    setBooks(initial.books);
    setMeta({ title: initial.title, email: initial.email, emailSentAt: initial.emailSentAt, publicUrl: initial.publicUrl });
    booksFetchRef.current = { at: Date.now(), count: initial.books.length };
  }, [initial]);

  const statusRef = useRef(status);
  statusRef.current = status;

  const uploads = useCollectionUploads(id);
  const visibleUploads = useMemo(() => uploads.filter((u) => u.status !== 'canceled'), [uploads]);
  const activeUploads = visibleUploads.filter((u) => isActiveStatus(u.status));
  // finished here, but the last status poll still lists the source as uploading: not "interrupted"
  const awaitingSync = visibleUploads.filter(
    (u) => u.status === 'done' && u.videoId && status.videos.some((v) => v.id === u.videoId && v.uploadStatus === 'uploading'),
  ).length;
  const phase = overallPhase(status, activeUploads.length + awaitingSync);
  const terminal = connection === 'gone';
  const ready = status.status === 'ready';

  /* ---------------- polling ---------------- */

  const pollStatus = useCallback(async () => {
    try {
      const next = await api.getStatus(id);
      setStatus(next);
      setConnection('ok');
      failuresRef.current = 0;
      setFailures(0);
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 404) {
        setConnection('gone');
        return;
      }
      if (err instanceof ApiClientError && err.status === 403) {
        setConnection('forbidden');
        return;
      }
      // network error, 5xx, proxy error page: keep polling with back-off, say so after two misses
      failuresRef.current += 1;
      setFailures(failuresRef.current);
      if (failuresRef.current >= 2) setConnection('offline');
    }
  }, [id]);

  const idle = activeUploads.length === 0 && (phase === 'error' || phase === 'empty' || phase === 'interrupted');
  const statusInterval = (idle ? IDLE_STATUS_MS : STATUS_MS) * Math.min(8, 2 ** Math.max(0, failures - 1));
  // 403 (e.g. the PIN was changed meanwhile) needs a reload with the new credentials: stop asking
  const pollStatusNow = usePolling(pollStatus, statusInterval, !terminal && !ready && connection !== 'forbidden', { immediate: true });

  const pollBooks = useCallback(async () => {
    const last = booksFetchRef.current;
    if (statusRef.current.bookCount === last.count && Date.now() - last.at < BOOKS_MAX_AGE_MS) return;
    try {
      const c = await api.getCollection(id);
      booksFetchRef.current = { at: Date.now(), count: c.books.length };
      setBooks(c.books);
      setMeta({ title: c.title, email: c.email, emailSentAt: c.emailSentAt, publicUrl: c.publicUrl });
    } catch {
      // the status poll reports connection problems
    }
  }, [id]);
  usePolling(pollBooks, BOOKS_MS, !terminal && !ready && connection !== 'forbidden');

  // an upload finished (source queued for processing) → refresh at once
  useEffect(
    () =>
      uploadStore.onUploaded((item) => {
        if (item.collectionId === id) pollStatusNow();
      }),
    [id, pollStatusNow],
  );

  // a new upload was initialised → the server now lists the source
  const knownVideoIds = useMemo(() => new Set(status.videos.map((v) => v.id)), [status.videos]);
  const unknownLocal = visibleUploads.some((u) => u.videoId && !knownVideoIds.has(u.videoId));
  useEffect(() => {
    if (unknownLocal) pollStatusNow();
  }, [unknownLocal, pollStatusNow]);

  /* ---------------- ready ---------------- */

  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const readyCalled = useRef(false);
  useEffect(() => {
    if (!ready || readyCalled.current) return;
    readyCalled.current = true;
    onReadyRef.current();
  }, [ready]);

  /* ---------------- uploads housekeeping ---------------- */

  const allUploadsFinished = visibleUploads.length > 0 && visibleUploads.every((u) => u.status === 'done');
  const lastFinishedAt = allUploadsFinished ? Math.max(...visibleUploads.map((u) => u.finishedAt ?? 0)) : 0;
  const [shownAt] = useState(() => Date.now());
  useEffect(() => {
    if (!allUploadsFinished) return;
    // measured from fixed points in time: an effect that runs again (Fast Refresh, StrictMode) must not postpone it
    const wait = Math.max(0, Math.max(lastFinishedAt, shownAt) + CLEAR_FINISHED_MS - Date.now());
    const timer = setTimeout(() => uploadStore.clearFinished(id), wait);
    return () => clearTimeout(timer);
  }, [allUploadsFinished, lastFinishedAt, shownAt, id]);

  const localByVideo = useMemo(() => {
    const map = new Map<string, UploadItem>();
    for (const u of visibleUploads) if (u.videoId) map.set(u.videoId, u);
    return map;
  }, [visibleUploads]);

  const resumable = useMemo(
    () =>
      interruptedUploads(status.videos, new Set(localByVideo.keys())).map((v) => ({
        videoId: v.id,
        name: v.originalFilename,
        size: v.sizeBytes,
      })),
    [status.videos, localByVideo],
  );

  const removeSource = useCallback(
    async (video: VideoDTO) => {
      const local = localByVideo.get(video.id);
      try {
        if (local) {
          await uploadStore.remove(local.localId);
        } else {
          await api.deleteUpload(video.id);
        }
        setStatus((s) => ({ ...s, videos: s.videos.filter((v) => v.id !== video.id) }));
        toast({ title: t('processing.source.remove.done'), tone: 'success' });
        pollStatusNow();
      } catch (err) {
        if (err instanceof ApiClientError && err.status === 404) {
          setStatus((s) => ({ ...s, videos: s.videos.filter((v) => v.id !== video.id) }));
          pollStatusNow();
          return;
        }
        toast({ title: t('processing.source.remove.failed'), tone: 'error' });
        throw err;
      }
    },
    [localByVideo, pollStatusNow, t, toast],
  );

  /* ---------------- render ---------------- */

  if (connection === 'gone') {
    return (
      <div className={cn('mx-auto w-full max-w-3xl py-12', className)}>
        <EmptyState
          title={t('processing.poll.gone.title')}
          description={t('processing.poll.gone.description')}
          action={
            <Button href="/" variant="primary">
              {t('processing.poll.gone.home')}
            </Button>
          }
        />
      </div>
    );
  }

  const sources = sortSources(status.videos);
  const counts = sourceCounts(status.videos);
  const totals = uploadTotals(visibleUploads);
  const title = meta.title?.trim() || t('processing.title.fallback');
  const booksLine = status.bookCount > 0 ? tp('processing.progress.books', status.bookCount) : t('processing.progress.noBooksYet');
  const showBar = phase === 'uploading' || phase === 'processing' || phase === 'enriching' || phase === 'ready';
  const barValue =
    phase === 'uploading' ? totals.percent : phase === 'enriching' ? null : phase === 'ready' ? 100 : Math.max(0, Math.min(100, status.progress));

  // owner: add more videos (or the first one) – the main focus of an empty draft, a side tool otherwise
  const uploaderCard = isOwner ? (
    <Card as="section" aria-label={t('upload.compact.title')} className={cn('p-3 sm:p-4', uploaderFirst ? 'order-2' : 'order-7')}>
      {resumable.length > 0 ? (
        <div className="mb-3 rounded-lg border border-accent/35 bg-accent-soft/50 px-3 py-2.5 text-sm">
          <p className="font-semibold text-ink">{t('processing.more.resumeTitle')}</p>
          <p className="mt-0.5 text-muted text-pretty">{t('processing.more.resumeDescription')}</p>
        </div>
      ) : null}
      <Uploader
        variant="compact"
        collectionId={id}
        limits={limits}
        existingSourceCount={status.videos.length}
        resumableUploads={resumable}
        showFileList={false}
        onAllComplete={() => pollStatusNow()}
      />
    </Card>
  ) : null;

  return (
    <div className={cn('w-full', className)}>
      <div className="flex flex-col gap-5 lg:grid lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start lg:gap-6">
        {/* main column (display: contents on phones, so the `order` of every card applies to one flow) */}
        <div className="contents lg:flex lg:min-w-0 lg:flex-col lg:gap-6">
          <Card as="section" aria-labelledby="exl-processing-title" className="order-1 overflow-hidden p-5 sm:p-7">
            <p className="text-xs font-medium tracking-[0.14em] text-accent uppercase">{t('processing.title.label', { id })}</p>
            <h1 id="exl-processing-title" className="mt-1 font-display text-2xl leading-tight font-semibold text-ink text-balance sm:text-3xl">
              {title}
            </h1>
            <div aria-live="polite" className="mt-4">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -6 }}
                  transition={{ duration: 0.2 }}
                >
                  <p className="font-display text-xl leading-snug font-semibold text-ink text-balance">{t(HEADLINE[phase])}</p>
                  <p className="mt-1 text-[0.9375rem] leading-relaxed text-muted text-pretty">{t(subline(phase, isOwner))}</p>
                </motion.div>
              </AnimatePresence>
            </div>

            {showBar ? (
              <ProgressBar
                className="mt-5"
                size="md"
                tone={phase === 'uploading' ? 'gold' : phase === 'ready' ? 'success' : 'primary'}
                value={barValue}
                showValue={barValue !== null}
                label={phase === 'uploading' ? t('processing.uploads.title') : t('processing.progress.label')}
                detail={
                  phase === 'uploading'
                    ? t('processing.uploads.summary', { done: n(totals.done), total: n(totals.total) })
                    : counts.total > 1
                      ? t('processing.progress.sources', { done: n(counts.done), total: n(counts.total) })
                      : undefined
                }
              />
            ) : null}

            {/* not a live region: the count changes every few seconds and would drown out everything else */}
            <p className="mt-3 text-sm font-medium text-ink tabular-nums">{booksLine}</p>

            {connection === 'offline' ? (
              <p role="status" className="mt-3 flex items-center gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
                <WifiOff aria-hidden="true" className="size-4 shrink-0 text-accent" />
                {t('processing.poll.offline')}
              </p>
            ) : null}
            {connection === 'forbidden' ? (
              <div role="alert" className="mt-3 flex flex-wrap items-center gap-3 rounded-lg border border-danger/25 px-3 py-2 text-sm">
                <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold text-ink">{t('processing.poll.forbidden.title')}</p>
                  <p className="text-muted">{t('processing.poll.forbidden.description')}</p>
                </div>
                <Button size="sm" leftIcon={<RefreshCw />} onClick={() => window.location.reload()}>
                  {t('processing.poll.reload')}
                </Button>
              </div>
            ) : null}
            {!isOwner && phase !== 'ready' ? <p className="mt-3 text-sm text-muted">{t('processing.viewer.note')}</p> : null}
          </Card>

          {uploaderFirst ? uploaderCard : null}

          {visibleUploads.length > 0 ? (
            <Card as="section" aria-labelledby="exl-processing-uploads" className="order-2 p-4 sm:p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <h2 id="exl-processing-uploads" className="flex items-center gap-2 font-display text-lg font-semibold text-ink">
                  <UploadCloud aria-hidden="true" className="size-5 text-accent" />
                  {t('processing.uploads.title')}
                </h2>
                <span className="text-xs text-muted tabular-nums">
                  {t('processing.uploads.summary', { done: n(totals.done), total: n(totals.total) })}
                </span>
              </div>
              <p className={cn('mt-1 text-sm', activeUploads.length > 0 ? 'font-medium text-ink' : 'text-muted')}>
                {activeUploads.length > 0 ? t('processing.uploads.keepOpen') : t('processing.uploads.allDone')}
              </p>
              <UploadFileList
                items={visibleUploads}
                size="sm"
                limits={limits}
                doneDetail={(item) => {
                  // never "waiting to be processed" while the server says it is processing or done
                  const p = finishedUploadPhase(item, status);
                  return p ? <span className={p === 'error' ? 'text-danger' : 'text-muted'}>{t(`processing.source.phase.${p}`)}</span> : null;
                }}
                className="mt-2"
              />
              {activeUploads.length === 0 ? (
                <div className="mt-1 flex justify-end">
                  <Button size="sm" variant="ghost" onClick={() => uploadStore.clearFinished(id)}>
                    {t('processing.uploads.clear')}
                  </Button>
                </div>
              ) : null}
            </Card>
          ) : null}

          {sources.length > 0 ? (
            <section aria-labelledby="exl-processing-sources" className="order-5 flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3 px-1">
                <h2 id="exl-processing-sources" className="font-display text-lg font-semibold text-ink">
                  {t('processing.sources.title')}
                </h2>
                <span className="text-xs text-muted">{tp('processing.sources.count', sources.length)}</span>
              </div>
              <ul className="flex flex-col gap-3">
                <AnimatePresence initial={false}>
                  {sources.map((video) => (
                    <motion.li
                      key={video.id}
                      layout="position"
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.22 }}
                    >
                      <SourceCard
                        video={video}
                        collectionStatus={status.status}
                        upload={localByVideo.get(video.id) ?? null}
                        isOwner={isOwner}
                        onRemove={isOwner ? removeSource : undefined}
                        limits={limits}
                      />
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>
            </section>
          ) : null}

          {phase !== 'empty' || books.length > 0 ? <AppearingShelf books={books} className="order-6" /> : null}
        </div>

        {/* side column */}
        <div className="contents lg:flex lg:flex-col lg:gap-5">
          <SharePanel collectionId={id} publicUrl={meta.publicUrl} className="order-3" />

          {isOwner ? (
            <EmailWhenReady
              collectionId={id}
              email={meta.email}
              emailSentAt={meta.emailSentAt}
              onSaved={(email) => setMeta((m) => ({ ...m, email }))}
              className="order-4"
            />
          ) : null}

          {uploaderFirst ? null : uploaderCard}

          <TipsCarousel className="order-8" />
        </div>
      </div>
    </div>
  );
}
