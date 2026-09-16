'use client';

/**
 * Ex-libris styled title block of the catalogue: bookplate frame with gilt corners, title (inline
 * editable for the owner), owner line, description, counts, created date + sources, and the actions
 * (share, export, add, settings, print).
 */
import { Check, KeyRound, Lock, Pencil, Printer, Settings2, Share2, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { LogoMark } from '@/components/site/Logo';
import { Badge, Button, IconButton, Input, cn, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';
import { AddMenu } from './AddMenu';
import { useCollection } from './context';
import { apiErrorMessage } from './errors';
import { ExportMenu } from './ExportMenu';
import { collectionTitle, ownerLine, sourcesLabel } from './labels';
import { SettingsDialog } from './SettingsDialog';
import { SETTINGS_LIMITS } from './settings-form';
import { ShareDialog } from './ShareDialog';
import { useCollectionShell } from './shell-context';

/** Gilt corner flourish of the bookplate frame. */
function Corner({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 40 40" aria-hidden="true" className={cn('pointer-events-none absolute size-8 text-accent sm:size-10', className)} fill="none">
      <path d="M3 22V9a6 6 0 0 1 6-6h13" stroke="currentColor" strokeWidth="1.1" opacity="0.75" />
      <path d="M8 26V13a5 5 0 0 1 5-5h13" stroke="currentColor" strokeWidth="0.7" opacity="0.45" />
      <path d="M13 13c2.5-3.2 6.6-3.2 8.4-.6-2.6.4-4.6 1.8-5.6 4.4" stroke="currentColor" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" />
      <circle cx="9" cy="9" r="1.5" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

/** "312 könyv" with the number set in display type. */
function CountItem({ labelKey, count }: { labelKey: MessageKey; count: number }) {
  const { tp, n } = useI18n();
  const text = tp(labelKey, count);
  const num = n(count);
  const at = text.indexOf(num);
  if (at < 0) return <span>{text}</span>;
  return (
    <span className="whitespace-nowrap">
      {text.slice(0, at)}
      <span className="font-display text-lg font-semibold text-ink tabular-nums sm:text-xl">{num}</span>
      {text.slice(at + num.length)}
    </span>
  );
}

function EditableTitle() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection, isOwner } = useCollection();
  const { saveCollection } = useCollectionShell();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const cancelled = useRef(false);

  const display = collectionTitle(collection, t);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const start = () => {
    cancelled.current = false;
    setDraft(collection.title ?? '');
    setEditing(true);
  };

  const finish = (restoreFocus: boolean) => {
    setEditing(false);
    if (restoreFocus) requestAnimationFrame(() => editButtonRef.current?.focus());
  };

  const save = async () => {
    if (cancelled.current || saving) return;
    const next = draft.replace(/\s+/g, ' ').trim();
    const current = (collection.title ?? '').trim();
    if (next === current) {
      finish(true);
      return;
    }
    if (next.length > SETTINGS_LIMITS.title) {
      toast({ title: t('collection.title.tooLong', { max: SETTINGS_LIMITS.title }), tone: 'error' });
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    try {
      await saveCollection({ title: next || null });
      toast({ id: 'collection-title-saved', title: t('collection.title.saved'), tone: 'success' });
      finish(true);
    } catch (err) {
      toast({ title: t('collection.toast.collectionFailed'), description: apiErrorMessage(err, t), tone: 'error' });
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void save();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      cancelled.current = true;
      finish(true);
    }
  };

  if (isOwner && editing) {
    return (
      <div className="flex items-center gap-2">
        <Input
          ref={inputRef}
          value={draft}
          maxLength={SETTINGS_LIMITS.title}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={(e) => {
            // clicking the confirm / cancel buttons must not trigger a blur-save first
            if (e.relatedTarget instanceof HTMLElement && e.relatedTarget.dataset.titleAction) return;
            void save();
          }}
          placeholder={t('collection.title.placeholder')}
          aria-label={t('collection.title.editing')}
          disabled={saving}
          size="lg"
          className="font-display text-2xl font-semibold sm:text-3xl"
        />
        <IconButton data-title-action="save" aria-label={t('common.action.save')} icon={<Check />} variant="primary" loading={saving} onClick={() => void save()} />
        <IconButton
          data-title-action="cancel"
          aria-label={t('common.action.cancel')}
          icon={<X />}
          onClick={() => {
            cancelled.current = true;
            finish(true);
          }}
        />
      </div>
    );
  }

  return (
    <div className="group flex items-start gap-2">
      <h1 className="min-w-0 font-display text-[1.875rem] leading-[1.08] font-semibold text-balance break-words text-ink sm:text-[2.625rem]">
        {display}
      </h1>
      {isOwner ? (
        <IconButton
          ref={editButtonRef}
          aria-label={t('collection.title.edit')}
          tooltip
          icon={<Pencil />}
          size="sm"
          onClick={start}
          className="mt-1.5 opacity-70 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 sm:mt-3 print:hidden"
        />
      ) : null}
    </div>
  );
}

export function CollectionHeader() {
  const { t, tp, d } = useI18n();
  const { collection, isOwner } = useCollection();
  const { counts } = useCollectionShell();
  const [shareOpen, setShareOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const owner = ownerLine(collection, t);
  const sources = sourcesLabel(collection.videos, t, tp);
  const description = collection.description?.trim();

  return (
    <header className="relative">
      <div className="relative overflow-hidden rounded-card border border-line bg-surface px-5 pt-7 pb-6 shadow-soft sm:px-10 sm:pt-9 sm:pb-8 print:border-0 print:px-0 print:shadow-none">
        {/* inner gilt rule + corners */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-[7px] rounded-[calc(var(--radius-card)-6px)] border border-accent/35 print:hidden" />
        <Corner className="top-2 left-2 print:hidden" />
        <Corner className="top-2 right-2 -scale-x-100 print:hidden" />
        <Corner className="bottom-2 left-2 -scale-y-100 print:hidden" />
        <Corner className="right-2 bottom-2 -scale-100 print:hidden" />
        {/* soft paper glow */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -top-24 left-1/2 h-48 w-[36rem] -translate-x-1/2 rounded-full bg-accent-soft/60 blur-3xl print:hidden"
        />

        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <span className="inline-flex items-center gap-2 font-display text-sm tracking-[0.28em] text-accent uppercase italic">
                <LogoMark className="h-5 w-auto not-italic" />
                {t('collection.title.exLibris')}
              </span>
              {isOwner ? (
                <Badge tone="green" size="sm" icon={<KeyRound />} className="print:hidden">
                  {t('collection.header.ownerBadge')}
                </Badge>
              ) : null}
              {collection.visibility === 'pin' ? (
                <Badge tone="gold" size="sm" icon={<Lock />} className="print:hidden">
                  {t('collection.header.pinBadge')}
                </Badge>
              ) : null}
            </div>

            <EditableTitle />

            {owner ? <p className="mt-1.5 font-display text-lg text-muted italic sm:text-xl">{owner}</p> : null}
            {description ? (
              <p className="mt-3 line-clamp-3 max-w-2xl text-[0.9375rem] whitespace-pre-line text-muted print:line-clamp-none">{description}</p>
            ) : null}

            <p className="sr-only">{t('collection.header.stats')}</p>
            <ul className="mt-4 flex flex-wrap items-baseline gap-x-5 gap-y-1 text-sm text-muted">
              <li>
                <CountItem labelKey="collection.header.books" count={counts.books} />
              </li>
              {counts.authors > 0 ? (
                <li>
                  <CountItem labelKey="collection.header.authors" count={counts.authors} />
                </li>
              ) : null}
              {counts.topics > 0 ? (
                <li>
                  <CountItem labelKey="collection.header.topics" count={counts.topics} />
                </li>
              ) : null}
              {counts.pages > 0 ? (
                <li>
                  <CountItem
                    labelKey={counts.pagesEstimated ? 'collection.header.pages' : 'collection.header.pagesExact'}
                    count={counts.pages}
                  />
                </li>
              ) : null}
            </ul>

            <p className="mt-2 flex flex-wrap gap-x-2 text-[0.8125rem] text-muted">
              <span>{t('collection.header.created', { date: d(collection.createdAt, { dateStyle: 'long' }) })}</span>
              <span aria-hidden="true">·</span>
              <span>{sources ?? t('collection.header.manualOnly')}</span>
            </p>
          </div>

          <div role="group" aria-label={t('collection.header.actions')} className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
            <Button leftIcon={<Share2 className="size-4" />} onClick={() => setShareOpen(true)}>
              <span className="max-sm:sr-only">{t('collection.action.share')}</span>
            </Button>
            <ExportMenu />
            {isOwner ? <AddMenu /> : null}
            {isOwner ? (
              <IconButton
                variant="secondary"
                aria-label={t('collection.action.settings')}
                tooltip
                icon={<Settings2 />}
                onClick={() => setSettingsOpen(true)}
              />
            ) : null}
            <IconButton variant="secondary" aria-label={t('collection.action.print')} tooltip icon={<Printer />} onClick={() => window.print()} />
          </div>
        </div>
      </div>

      <ShareDialog open={shareOpen} onClose={() => setShareOpen(false)} />
      {isOwner ? <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} /> : null}
    </header>
  );
}
