'use client';

import { CircleAlert, CircleCheck, Film, Image as ImageIcon, Pause, Play, RotateCcw, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import type { MessageKey, Vars } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { IconButton } from '@/components/ui/IconButton';
import { ProgressBar, type ProgressTone } from '@/components/ui/ProgressBar';
import { cn } from '@/components/ui/cn';
import {
  estimateBytesSent,
  etaSeconds,
  inferUploadMime,
  sourceKindOfMime,
  uploadStore,
  type UploadItem,
} from '@/lib/client/upload-store';
import { etaParts, formatBytes, formatDuration } from './format';
import { useFileThumbnail, useNow, useUploadLimits } from './hooks';
import { formatUploadLimit, type UploadLimits } from './limits';

const ERROR_KEYS: Record<string, MessageKey> = {
  network: 'upload.error.network',
  server: 'upload.error.server',
  unsupported: 'upload.error.unsupported',
  too_large: 'upload.error.too_large',
  too_many_sources: 'upload.error.too_many_sources',
  rate_limited: 'upload.error.rate_limited',
  forbidden: 'upload.error.forbidden',
  not_found: 'upload.error.not_found',
  upload_closed: 'upload.error.upload_closed',
  upload_incomplete: 'upload.error.upload_incomplete',
  conflict: 'upload.error.upload_incomplete',
  file_missing: 'upload.error.file_missing',
  file_unreadable: 'upload.error.file_unreadable',
};

/** Localized explanation for a failed upload. `vars.max`: the per-file size limit ("1 GB", quoted for `too_large`). */
export function uploadErrorText(
  item: Pick<UploadItem, 'errorCode' | 'error'>,
  t: (key: MessageKey, vars?: Vars) => string,
  vars: { max: string },
): string {
  const key = item.errorCode ? ERROR_KEYS[item.errorCode] : undefined;
  if (key) return t(key, vars);
  return item.error || t('upload.error.generic');
}

function Thumb({ file, kind, size }: { file: Blob | undefined; kind: 'video' | 'image'; size: 'sm' | 'md' }) {
  const thumb = useFileThumbnail(file, kind);
  const Icon = kind === 'video' ? Film : ImageIcon;
  return (
    <div
      className={cn(
        'relative shrink-0 overflow-hidden rounded-lg border border-line bg-surface-2 text-muted',
        size === 'sm' ? 'size-11' : 'size-14',
      )}
      aria-hidden="true"
    >
      {thumb?.url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={thumb.url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
      ) : (
        <span className={cn('absolute inset-0 flex items-center justify-center', !thumb && 'animate-pulse')}>
          <Icon className="size-5" />
        </span>
      )}
      {thumb?.url && kind === 'video' ? (
        <span className="absolute right-0.5 bottom-0.5 rounded bg-black/65 px-1 text-[0.625rem] leading-4 font-medium text-white tabular-nums">
          {thumb.duration ? formatDuration(thumb.duration) : <Film className="my-0.5 size-3" />}
        </span>
      ) : null}
    </div>
  );
}

interface RowModel {
  key: string;
  name: string;
  size: number;
  kind: 'video' | 'image';
  file: Blob | undefined;
  item: UploadItem | null;
}

interface StatusOptions {
  /** per-file size limit, e.g. "1 GB" */
  maxSize: string;
  doneDetail?: (item: UploadItem) => ReactNode;
}

function StatusLine({ item, now, maxSize, doneDetail }: { item: UploadItem | null; now: number } & StatusOptions) {
  const { t, n } = useI18n();
  if (!item) {
    return <span className="text-muted">{t('upload.item.status.preparing')}</span>;
  }
  switch (item.status) {
    case 'queued':
      return <span className="text-muted">{t('upload.item.status.queued')}</span>;
    case 'uploading': {
      if (item.offline) {
        return (
          <span className="inline-flex items-center gap-1 text-warning">
            <WifiOff aria-hidden="true" className="size-3.5" />
            {t('upload.item.status.offline')}
          </span>
        );
      }
      if (item.retry) {
        return (
          <span className="text-warning">
            {t('upload.item.status.retrying', { attempt: n(item.retry.attempt), max: n(item.retry.max) })}
          </span>
        );
      }
      const pct = item.size > 0 ? Math.floor((estimateBytesSent(item, now) / item.size) * 100) : 0;
      const eta = etaParts(etaSeconds(item));
      return (
        <span className="text-muted tabular-nums">
          {t('upload.item.status.uploading', { percent: n(Math.min(99, pct)) })}
          {eta ? (
            <>
              <span aria-hidden="true"> · </span>
              {t(`upload.item.eta.${eta.unit}`, { count: n(eta.count) })}
            </>
          ) : null}
        </span>
      );
    }
    case 'paused':
      return <span className="text-accent">{t('upload.item.status.paused')}</span>;
    case 'finalizing':
      return <span className="text-muted">{t('upload.item.status.finalizing')}</span>;
    case 'done': {
      // "Uploaded" is all the upload store knows; where to go from there is the server's business
      const detail = doneDetail?.(item);
      return (
        <span>
          <span className="inline-flex items-center gap-1 text-success">
            <CircleCheck aria-hidden="true" className="size-3.5" />
            {t('upload.item.status.done')}
          </span>
          {detail ? (
            <>
              {' '}
              <span aria-hidden="true" className="text-muted">
                ·
              </span>{' '}
              {detail}
            </>
          ) : null}
        </span>
      );
    }
    case 'canceled':
      return <span className="text-muted">{t('upload.item.status.canceled')}</span>;
    case 'error':
      return (
        <span className="inline-flex items-start gap-1 text-danger">
          <CircleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
          <span>{uploadErrorText(item, t, { max: maxSize })}</span>
        </span>
      );
  }
}

function Row({
  row,
  now,
  size,
  onRemovePending,
  ...statusOptions
}: { row: RowModel; now: number; size: 'sm' | 'md'; onRemovePending?: (key: string) => void } & StatusOptions) {
  const { t, locale } = useI18n();
  const item = row.item;
  const status = item?.status;
  const value = !item
    ? null
    : status === 'done' || status === 'finalizing'
      ? 100
      : status === 'queued'
        ? 0
        : row.size > 0
          ? (estimateBytesSent(item, now) / row.size) * 100
          : 0;
  const tone: ProgressTone = status === 'error' ? 'danger' : status === 'done' ? 'success' : status === 'paused' ? 'gold' : 'primary';
  const indeterminate = !item || status === 'finalizing' || (status === 'uploading' && Boolean(item.retry || item.offline) && value === 0);
  const kindLabel = row.kind === 'video' ? t('upload.item.kind.video') : t('upload.item.kind.image');

  const remove = () => {
    if (item) void uploadStore.remove(item.localId);
    else onRemovePending?.(row.key);
  };

  return (
    <motion.li
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, height: 0, marginTop: 0, marginBottom: 0 }}
      transition={{ duration: 0.2 }}
      className="flex items-start gap-3 py-2.5"
    >
      <Thumb file={row.file} kind={row.kind} size={size} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="min-w-0 truncate text-sm font-medium text-ink" title={row.name}>
            {row.name}
          </p>
          <span className="shrink-0 text-xs text-muted tabular-nums">{formatBytes(row.size, locale)}</span>
        </div>
        <p className="mt-0.5 text-xs leading-snug">
          <span className="sr-only">{kindLabel}: </span>
          <StatusLine item={item} now={now} {...statusOptions} />
        </p>
        {status !== 'canceled' ? (
          <ProgressBar
            className="mt-1.5"
            size="xs"
            tone={tone}
            value={indeterminate ? null : value}
            label={t('upload.item.progressLabel', { name: row.name })}
          />
        ) : null}
      </div>
      <div className="-mt-0.5 -mr-1 flex shrink-0 items-center">
        {status === 'uploading' || status === 'queued' ? (
          <IconButton
            size="sm"
            aria-label={t('upload.item.pause', { name: row.name })}
            icon={<Pause />}
            onClick={() => uploadStore.pause(item!.localId)}
          />
        ) : null}
        {status === 'paused' ? (
          <IconButton
            size="sm"
            aria-label={t('upload.item.resume', { name: row.name })}
            icon={<Play />}
            onClick={() => uploadStore.resume(item!.localId)}
          />
        ) : null}
        {status === 'error' && item && item.errorCode !== 'file_missing' && uploadStore.getFile(item.localId) ? (
          <IconButton
            size="sm"
            aria-label={t('upload.item.retry', { name: row.name })}
            icon={<RotateCcw />}
            onClick={() => uploadStore.retry(item.localId)}
          />
        ) : null}
        {status !== 'finalizing' ? (
          <IconButton size="sm" aria-label={t('upload.item.remove', { name: row.name })} icon={<X />} onClick={remove} />
        ) : null}
      </div>
    </motion.li>
  );
}

export interface UploadFileListProps {
  items: readonly UploadItem[];
  /** picked files still waiting for their collection to be created */
  pending?: readonly { key: string; file: File }[];
  onRemovePending?: (key: string) => void;
  size?: 'sm' | 'md';
  /** the server's upload limits (quoted in errors); loaded from GET /api/config when not given */
  limits?: UploadLimits;
  /**
   * What happens to a finished upload now, shown after "Uploaded" – e.g. the processing state the server reports
   * for the source. Without it (or when it returns nothing) the row just says "Uploaded".
   */
  doneDetail?: (item: UploadItem) => ReactNode;
  className?: string;
  'aria-label'?: string;
}

/** Picked / uploading files with thumbnail, size, progress, pause / resume / retry / remove. */
export function UploadFileList({
  items,
  pending = [],
  onRemovePending,
  size = 'md',
  limits: knownLimits,
  doneDetail,
  className,
  'aria-label': ariaLabel,
}: UploadFileListProps) {
  const { t, locale } = useI18n();
  const limits = useUploadLimits(knownLimits);
  const visible = items.filter((i) => i.status !== 'canceled');
  const anyUploading = visible.some((i) => i.status === 'uploading');
  const now = useNow(anyUploading);
  const maxSize = formatUploadLimit(limits, locale);

  const rows: RowModel[] = [
    ...visible.map((item) => ({
      key: item.localId,
      name: item.name,
      size: item.size,
      kind: item.kind,
      file: uploadStore.getFile(item.localId),
      item,
    })),
    ...pending.map(({ key, file }) => ({
      key,
      name: file.name,
      size: file.size,
      kind: sourceKindOfMime(inferUploadMime(file)),
      file,
      item: null,
    })),
  ];
  if (rows.length === 0) return null;

  return (
    <ul aria-label={ariaLabel ?? t('upload.list.label')} className={cn('divide-y divide-line/70', className)}>
      <AnimatePresence initial={false}>
        {rows.map((row) => (
          <Row key={row.key} row={row} now={now} size={size} onRemovePending={onRemovePending} maxSize={maxSize} doneDetail={doneDetail} />
        ))}
      </AnimatePresence>
    </ul>
  );
}
