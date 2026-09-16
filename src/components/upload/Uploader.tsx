'use client';

/**
 * Multi-file, chunked, resumable uploader (videos + photos). Owner: frontend-landing.
 *
 * - Without `collectionId` (landing hero): the first picked file creates the collection
 *   (api.createCollection), remembers the owner token (rememberCollection) and starts uploading at once;
 *   the optional title / name / e-mail are PATCHed when "start processing" is pressed, which then
 *   navigates to /<id> while the uploads continue in the module-level upload store.
 * - With `collectionId` (owner on the collection page): uploads straight into that collection.
 */
import { ArrowRight, CircleAlert, Info, WifiOff, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/components/ui/cn';
import { api, ApiClientError } from '@/lib/client/api';
import { forgetCollection, rememberCollection } from '@/lib/client/my-collections';
import { fileKey, isActiveStatus, uploadStore, type ResumableUpload } from '@/lib/client/upload-store';
import type { CollectionPatch, CreateCollectionResponse } from '@/lib/types';
import { DropZone } from './DropZone';
import { formatBytes } from './format';
import { useCollectionUploads, useOnline, useUploadLimits, useUploadState } from './hooks';
import { formatUploadLimit, maxUploadBytes, type UploadLimits } from './limits';
import { UploadFileList } from './UploadFileList';
import { isPlausibleEmail, validateFiles, type Rejection } from './validate';

export interface UploaderProps {
  collectionId?: string;
  variant?: 'hero' | 'compact';
  /** the server's upload limits when a Server Component read them; otherwise loaded from GET /api/config */
  limits?: UploadLimits;
  onCollectionCreated?: (res: CreateCollectionResponse) => void;
  /** fired when every file of the current batch finished uploading and was queued */
  onAllComplete?: (collectionId: string) => void;
  className?: string;
  /** sources the collection already has (server side) – for the per-collection file limit */
  existingSourceCount?: number;
  /** unfinished server-side uploads (e.g. after a page reload) that a re-picked identical file continues */
  resumableUploads?: readonly ResumableUpload[];
  /** hide the built-in file list (when the parent renders the uploads itself) */
  showFileList?: boolean;
}

interface PendingFile {
  key: string;
  file: File;
}

type CreateState = { status: 'idle' } | { status: 'creating' } | { status: 'error'; message: string };

function errorReason(err: unknown): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const d = err.details as { reason?: unknown } | undefined;
  return typeof d?.reason === 'string' ? d.reason : err.code;
}

export function Uploader({
  collectionId,
  variant = 'hero',
  limits: knownLimits,
  onCollectionCreated,
  onAllComplete,
  className,
  existingSourceCount = 0,
  resumableUploads,
  showFileList = true,
}: UploaderProps) {
  const { t, tp, locale } = useI18n();
  const router = useRouter();
  const { toast } = useToast();
  const online = useOnline();
  const limits = useUploadLimits(knownLimits);
  const maxFiles = limits.maxSourcesPerCollection;
  const maxSize = formatUploadLimit(limits, locale);
  const { draft } = useUploadState();
  const standalone = !collectionId;
  const hero = variant === 'hero';
  const targetId = collectionId ?? draft?.collectionId ?? null;
  const items = useCollectionUploads(targetId);

  const [pending, setPending] = useState<PendingFile[]>([]);
  const pendingRef = useRef<PendingFile[]>([]);
  const [rejections, setRejections] = useState<Rejection[]>([]);
  const [createState, setCreateState] = useState<CreateState>({ status: 'idle' });
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [title, setTitle] = useState(() => (standalone ? (uploadStore.getSnapshot().draft?.sent.title ?? '') : ''));
  const [ownerName, setOwnerName] = useState(() => (standalone ? (uploadStore.getSnapshot().draft?.sent.ownerName ?? '') : ''));
  const [email, setEmail] = useState(() => (standalone ? (uploadStore.getSnapshot().draft?.sent.email ?? '') : ''));
  const [emailError, setEmailError] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  const fieldsRef = useRef({ title, ownerName, email });
  fieldsRef.current = { title, ownerName, email };
  const creatingRef = useRef<Promise<string | null> | null>(null);
  const batchRef = useRef(new Set<string>());
  const submittedRef = useRef(false);
  const onCreatedRef = useRef(onCollectionCreated);
  onCreatedRef.current = onCollectionCreated;
  const onAllCompleteRef = useRef(onAllComplete);
  onAllCompleteRef.current = onAllComplete;

  const updatePending = (next: PendingFile[]) => {
    pendingRef.current = next;
    setPending(next);
  };

  const visibleItems = useMemo(() => items.filter((i) => i.status !== 'canceled'), [items]);

  /* ---------------- collection creation (standalone) ---------------- */

  const enqueue = useCallback(
    (id: string, files: File[]) => {
      if (files.length === 0) return;
      const created = uploadStore.enqueue(id, files, { resumable: resumableUploads });
      for (const c of created) batchRef.current.add(c.localId);
    },
    [resumableUploads],
  );

  const flushPending = useCallback(
    (id: string) => {
      const files = pendingRef.current.map((p) => p.file);
      updatePending([]);
      enqueue(id, files);
    },
    [enqueue],
  );

  const ensureCollection = useCallback((): Promise<string | null> => {
    if (collectionId) return Promise.resolve(collectionId);
    const existing = uploadStore.getSnapshot().draft;
    if (existing) return Promise.resolve(existing.collectionId);
    if (creatingRef.current) return creatingRef.current;

    const job = (async (): Promise<string | null> => {
      setCreateState({ status: 'creating' });
      const f = fieldsRef.current;
      const sent = {
        title: f.title.trim(),
        ownerName: f.ownerName.trim(),
        email: isPlausibleEmail(f.email) ? f.email.trim() : '',
      };
      const body = {
        title: sent.title || undefined,
        ownerName: sent.ownerName || undefined,
        email: sent.email || undefined,
        locale,
      };
      try {
        let res: CreateCollectionResponse;
        try {
          res = await api.createCollection(body);
        } catch (err) {
          // the address looked fine here but not to the server: create without it, the field shows the error later
          if (body.email && errorReason(err) === 'bad_email') {
            sent.email = '';
            res = await api.createCollection({ ...body, email: undefined });
          } else {
            throw err;
          }
        }
        rememberCollection({ id: res.id, token: res.ownerToken, title: sent.title || null });
        uploadStore.setDraft({
          collectionId: res.id,
          ownerToken: res.ownerToken,
          publicUrl: res.publicUrl,
          ownerUrl: res.ownerUrl,
          sent,
          createdAt: Date.now(),
        });
        onCreatedRef.current?.(res);
        setCreateState({ status: 'idle' });
        return res.id;
      } catch (err) {
        const message =
          err instanceof ApiClientError
            ? errorReason(err) === 'rate_limited'
              ? t('upload.create.rateLimited')
              : err.message || t('upload.create.failed')
            : t('upload.create.network');
        setCreateState({ status: 'error', message });
        return null;
      } finally {
        creatingRef.current = null;
      }
    })();
    creatingRef.current = job;
    return job;
  }, [collectionId, locale, t]);

  /* ---------------- adding files ---------------- */

  const addFiles = (files: File[]) => {
    setCtaError(null);
    const existingKeys = new Set([
      ...visibleItems.map((i) => fileKey({ name: i.name, size: i.size, lastModified: i.lastModified })),
      ...pendingRef.current.map((p) => fileKey(p.file)),
    ]);
    const used = standalone
      ? visibleItems.length + pendingRef.current.length
      : existingSourceCount + visibleItems.filter((i) => isActiveStatus(i.status) && !i.videoId).length;
    const { accepted, rejected } = validateFiles(files, {
      existingKeys,
      slotsLeft: maxFiles - used,
      maxBytes: maxUploadBytes(limits),
    });
    setRejections(rejected);
    if (accepted.length === 0) return;

    if (targetId) {
      enqueue(targetId, accepted);
      return;
    }
    updatePending([...pendingRef.current, ...accepted.map((file) => ({ key: `pending-${fileKey(file)}`, file }))]);
    void ensureCollection().then((id) => {
      if (id) flushPending(id);
    });
  };

  const retryCreate = () => {
    void ensureCollection().then((id) => {
      if (id) flushPending(id);
    });
  };

  /* ---------------- batch completion ---------------- */

  useEffect(() => {
    const batch = batchRef.current;
    if (batch.size === 0 || !targetId) return;
    const batchItems = items.filter((i) => batch.has(i.localId));
    if (batchItems.some((i) => isActiveStatus(i.status))) return;
    const anyDone = batchItems.some((i) => i.status === 'done');
    batch.clear();
    if (anyDone) onAllCompleteRef.current?.(targetId);
  }, [items, targetId]);

  /* ---------------- leaving the landing page ---------------- */

  useEffect(() => {
    if (!standalone) return;
    return () => {
      const state = uploadStore.getSnapshot();
      const d = state.draft;
      if (!d) return;
      if (submittedRef.current) {
        uploadStore.setDraft(null);
        return;
      }
      const hasSources = state.items.some((i) => i.collectionId === d.collectionId && i.status !== 'canceled');
      if (!hasSources && pendingRef.current.length === 0 && !creatingRef.current) {
        // an empty draft nobody will ever see: do not leave it behind
        uploadStore.setDraft(null);
        forgetCollection(d.collectionId);
        void api.deleteCollection(d.collectionId).catch(() => undefined);
      }
    };
  }, [standalone]);

  /* ---------------- start processing ---------------- */

  const totalCount = visibleItems.length + pending.length;
  const totalBytes = visibleItems.reduce((s, i) => s + i.size, 0) + pending.reduce((s, p) => s + p.file.size, 0);
  const usable = visibleItems.filter((i) => i.status !== 'error').length + pending.length;

  const validateEmail = (value: string): boolean => {
    const v = value.trim();
    if (v && !isPlausibleEmail(v)) {
      setEmailError(t('upload.field.email.invalid'));
      return false;
    }
    setEmailError(null);
    return true;
  };

  const start = async () => {
    setCtaError(null);
    if (totalCount === 0) {
      setCtaError(t('upload.cta.needFiles'));
      return;
    }
    if (!validateEmail(email)) {
      emailRef.current?.focus();
      return;
    }
    if (usable === 0) {
      setCtaError(t('upload.cta.allFailed'));
      return;
    }
    setSubmitting(true);
    try {
      const id = await ensureCollection();
      if (!id) return;
      if (pendingRef.current.length > 0) flushPending(id);

      const current = uploadStore.getSnapshot().draft;
      if (current && current.collectionId === id) {
        const next = { title: title.trim(), ownerName: ownerName.trim(), email: email.trim() };
        const patch: CollectionPatch = {};
        if (next.title !== current.sent.title) patch.title = next.title || null;
        if (next.ownerName !== current.sent.ownerName) patch.ownerName = next.ownerName || null;
        if (next.email !== current.sent.email) patch.email = next.email || null;
        if (Object.keys(patch).length > 0) {
          try {
            await api.updateCollection(id, patch);
            uploadStore.updateDraftSent(next);
            if (next.title) rememberCollection({ id, title: next.title });
          } catch (err) {
            if (errorReason(err) === 'bad_email') {
              setEmailError(t('upload.field.email.invalid'));
              emailRef.current?.focus();
              return;
            }
            toast({ title: t('upload.cta.detailsNotSaved'), description: t('upload.cta.detailsNotSavedHint'), tone: 'error' });
          }
        }
      }
      submittedRef.current = true;
      router.push(`/${id}`);
    } finally {
      setSubmitting(false);
    }
  };

  /* ---------------- render ---------------- */

  const slotsFull = !standalone && existingSourceCount >= maxFiles;
  const anyActive = visibleItems.some((i) => isActiveStatus(i.status)) || pending.length > 0;
  const formatsNote = t('upload.formats', { max: maxSize, files: maxFiles });

  const rejectionText = (r: Rejection): string => {
    switch (r.reason) {
      case 'type':
        return t('upload.reject.type', { name: r.name });
      case 'heic':
        return t('upload.reject.heic', { name: r.name });
      case 'size':
        return t('upload.reject.size', { name: r.name, size: formatBytes(r.size, locale), max: maxSize });
      case 'empty':
        return t('upload.reject.empty', { name: r.name });
      case 'duplicate':
        return t('upload.reject.duplicate', { name: r.name });
      case 'count':
        return t('upload.reject.count', { name: r.name, max: maxFiles });
    }
  };

  const zone = (
    <DropZone
      variant={variant}
      onFiles={addFiles}
      disabled={slotsFull || submitting}
      headingLevel={hero ? 'h2' : 'h3'}
      title={hero ? t('upload.hero.title') : t('upload.compact.title')}
      description={hero ? t('upload.hero.description') : t('upload.compact.description')}
      touchDescription={hero ? t('upload.hero.touchDescription') : undefined}
      footnote={formatsNote}
    />
  );

  const alerts = (
    <>
      {slotsFull ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-surface-2 px-3 py-2 text-sm text-muted">
          <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {t('upload.limitReached', { max: maxFiles })}
        </p>
      ) : null}
      {!online && anyActive ? (
        <p role="status" className="flex items-start gap-2 rounded-lg bg-accent-soft px-3 py-2 text-sm text-ink">
          <WifiOff aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
          {t('upload.offline')}
        </p>
      ) : null}
      {rejections.length > 0 ? (
        <div role="alert" className="relative rounded-lg border border-danger/25 bg-[color-mix(in_oklab,var(--danger)_7%,var(--surface))] py-2 pr-10 pl-3 text-sm">
          <p className="flex items-center gap-1.5 font-medium text-danger">
            <CircleAlert aria-hidden="true" className="size-4 shrink-0" />
            {tp('upload.reject.title', rejections.length)}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-ink">
            {rejections.slice(0, 6).map((r, i) => (
              <li key={`${r.name}-${i}`}>{rejectionText(r)}</li>
            ))}
            {rejections.length > 6 ? <li>{tp('upload.reject.more', rejections.length - 6)}</li> : null}
          </ul>
          <IconButton
            size="sm"
            className="absolute top-1.5 right-1.5"
            aria-label={t('upload.reject.dismiss')}
            icon={<X />}
            onClick={() => setRejections([])}
          />
        </div>
      ) : null}
      {createState.status === 'error' ? (
        <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-danger/25 bg-[color-mix(in_oklab,var(--danger)_7%,var(--surface))] px-3 py-2 text-sm">
          <CircleAlert aria-hidden="true" className="size-4 shrink-0 text-danger" />
          <span className="min-w-0 flex-1 text-ink">{createState.message}</span>
          <Button size="sm" onClick={retryCreate}>
            {t('common.action.retry')}
          </Button>
        </div>
      ) : null}
    </>
  );

  if (!hero) {
    return (
      <div className={cn('flex flex-col gap-3', className)}>
        {zone}
        {alerts}
        {showFileList ? <UploadFileList items={visibleItems} size="sm" limits={limits} /> : null}
      </div>
    );
  }

  const hasFilesListed = totalCount > 0;

  return (
    <Card variant="bookplate" className={cn('p-2.5 sm:p-3', className)}>
      {zone}
      <div className="flex flex-col gap-3 px-2 pt-3 sm:px-3">{alerts}</div>

      <AnimatePresence initial={false}>
        {hasFilesListed ? (
          <motion.div
            key="details"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="flex flex-col gap-5 px-2 pt-2 pb-3 sm:px-3">
              <section aria-labelledby="exl-upload-files-heading">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 id="exl-upload-files-heading" className="font-sans text-sm font-semibold text-ink">
                    {t('upload.list.title')}
                  </h3>
                  <span className="text-xs text-muted tabular-nums">
                    {tp('upload.list.summary', totalCount, { size: formatBytes(totalBytes, locale) })}
                  </span>
                </div>
                <UploadFileList
                  items={visibleItems}
                  pending={pending}
                  limits={limits}
                  onRemovePending={(key) => updatePending(pendingRef.current.filter((p) => p.key !== key))}
                  className="mt-1"
                />
              </section>

              <fieldset className="flex flex-col gap-4 border-t border-line/70 pt-4">
                <legend className="sr-only">{t('upload.fields.legend')}</legend>
                <div aria-hidden="true" className="-mt-1">
                  <p className="font-display text-lg leading-tight font-semibold text-ink">{t('upload.fields.legend')}</p>
                  <p className="mt-0.5 text-sm text-muted">{t('upload.fields.intro')}</p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label={t('upload.field.title.label')} optional>
                    <Input
                      value={title}
                      maxLength={200}
                      autoComplete="off"
                      enterKeyHint="next"
                      placeholder={t('upload.field.title.placeholder')}
                      onChange={(e) => setTitle(e.target.value)}
                    />
                  </Field>
                  <Field label={t('upload.field.ownerName.label')} hint={t('upload.field.ownerName.hint')} optional>
                    <Input
                      value={ownerName}
                      maxLength={120}
                      autoComplete="name"
                      enterKeyHint="next"
                      placeholder={t('upload.field.ownerName.placeholder')}
                      onChange={(e) => setOwnerName(e.target.value)}
                    />
                  </Field>
                </div>
                <Field label={t('upload.field.email.label')} hint={t('upload.field.email.hint')} error={emailError} optional>
                  <Input
                    ref={emailRef}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    enterKeyHint="go"
                    maxLength={254}
                    value={email}
                    placeholder={t('upload.field.email.placeholder')}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      if (emailError) setEmailError(null);
                    }}
                    onBlur={(e) => {
                      if (e.target.value.trim()) validateEmail(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        void start();
                      }
                    }}
                  />
                </Field>
              </fieldset>

              <div className="flex flex-col items-stretch gap-2 border-t border-line/70 pt-4 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted text-pretty sm:max-w-xs">{t('upload.cta.hint')}</p>
                <Button
                  variant="primary"
                  size="lg"
                  rightIcon={<ArrowRight />}
                  loading={submitting}
                  onClick={() => void start()}
                  className="w-full sm:w-auto"
                >
                  {t('upload.cta.start')}
                </Button>
              </div>
              {ctaError ? (
                <p role="alert" className="-mt-2 text-sm text-danger">
                  {ctaError}
                </p>
              ) : null}
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      {ctaError && !hasFilesListed ? (
        <p role="alert" className="px-3 pb-3 text-sm text-danger">
          {ctaError}
        </p>
      ) : null}
    </Card>
  );
}
