'use client';

/**
 * /my – three ways to reach your catalogues, as three twin cards side by side (stacked on a phone):
 *   1 · on this device: the collections remembered in this browser (localStorage via my-collections.ts) – open,
 *       open as owner, copy link, forget (with undo);
 *   2 · by id or pasted link;
 *   3 · lost the link: owner links by e-mail (no-enumeration answer).
 * Above them the Google sign-in, the better way when it is configured.
 */
import {
  Copy,
  ExternalLink,
  Hash,
  KeyRound,
  Library,
  Lock,
  Mail,
  MailCheck,
  MonitorSmartphone,
  Plus,
  Send,
  Trash2,
} from 'lucide-react';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type ReactNode } from 'react';
import type { MessageKey } from '@/i18n';
import { useI18n } from '@/i18n/client';
import { OpenByIdForm } from '@/components/landing/OpenByIdForm';
import { SectionHeading } from '@/components/landing/SectionHeading';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { copyToClipboard } from '@/components/ui/CopyField';
import { EmptyState } from '@/components/ui/EmptyState';
import { Field } from '@/components/ui/Field';
import { IconButton } from '@/components/ui/IconButton';
import { Input } from '@/components/ui/Input';
import { Skeleton } from '@/components/ui/Skeleton';
import { useToast } from '@/components/ui/Toast';
import { useMounted } from '@/components/ui/hooks';
import { isPlausibleEmail } from '@/components/upload/validate';
import { api, ApiClientError } from '@/lib/client/api';
import { forgetCollection, listMyCollections, rememberCollection, type MyCollectionEntry } from '@/lib/client/my-collections';
import type { CollectionStatusDTO } from '@/lib/types';
import { AccountLibraryCard } from '@/components/site/SignInCard';

/** localStorage key documented in SPEC §2 (the raw string is the external-store snapshot). */
const STORAGE_KEY = 'exl_my_collections';
const STATUS_CONCURRENCY = 3;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('exl-my-collections', onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener('exl-my-collections', onChange);
    window.removeEventListener('storage', onChange);
  };
}

function readRaw(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function useMyCollections(): MyCollectionEntry[] {
  const raw = useSyncExternalStore(subscribe, readRaw, () => null);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (raw === null ? [] : listMyCollections()), [raw]);
}

export type RemoteState =
  | { state: 'loading' }
  | { state: 'ok'; status: CollectionStatusDTO }
  | { state: 'gone' }
  | { state: 'locked' }
  | { state: 'unknown' };

/** Fetches the status of every remembered collection (a few at a time). */
export function useRemoteStatuses(ids: string[]): Map<string, RemoteState> {
  const [map, setMap] = useState<Map<string, RemoteState>>(() => new Map());
  const requested = useRef(new Set<string>());
  const key = ids.join(',');

  useEffect(() => {
    // every id is asked once per page view; results stay valid when the list changes meanwhile
    const todo = ids.filter((id) => !requested.current.has(id));
    if (todo.length === 0) return;
    for (const id of todo) requested.current.add(id);
    setMap((prev) => {
      const next = new Map(prev);
      for (const id of todo) next.set(id, { state: 'loading' });
      return next;
    });
    const queue = [...todo];
    const worker = async () => {
      for (let id = queue.shift(); id !== undefined; id = queue.shift()) {
        let result: RemoteState;
        try {
          result = { state: 'ok', status: await api.getStatus(id) };
        } catch (err) {
          if (err instanceof ApiClientError && err.status === 404) result = { state: 'gone' };
          else if (err instanceof ApiClientError && err.status === 403) result = { state: 'locked' };
          else result = { state: 'unknown' };
        }
        const value = result;
        const current = id;
        setMap((prev) => new Map(prev).set(current, value));
      }
    };
    void Promise.all(Array.from({ length: Math.min(STATUS_CONCURRENCY, todo.length) }, worker));
    // `key` is the dependency that represents `ids`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return map;
}

export function statusBadge(remote: RemoteState | undefined): { tone: BadgeTone; key: MessageKey } {
  if (!remote || remote.state === 'loading') return { tone: 'neutral', key: 'my.status.checking' };
  switch (remote.state) {
    case 'gone':
      return { tone: 'red', key: 'my.status.gone' };
    case 'locked':
      return { tone: 'blue', key: 'my.status.locked' };
    case 'unknown':
      return { tone: 'neutral', key: 'my.status.unknown' };
    case 'ok':
      switch (remote.status.status) {
        case 'ready':
          return { tone: 'green', key: 'my.status.ready' };
        case 'processing':
          return { tone: 'gold', key: 'my.status.processing' };
        case 'error':
          return { tone: 'red', key: 'my.status.error' };
        default:
          return { tone: 'neutral', key: 'my.status.draft' };
      }
  }
}

function EntryCard({ entry, remote }: { entry: MyCollectionEntry; remote: RemoteState | undefined }) {
  const { t, tp, d } = useI18n();
  const { toast } = useToast();
  const title = entry.title?.trim() || t('my.entry.untitled');
  const badge = statusBadge(remote);
  const bookCount = remote?.state === 'ok' ? remote.status.bookCount : entry.bookCount;
  const gone = remote?.state === 'gone';
  const ownerHref = entry.token ? `/${entry.id}?k=${encodeURIComponent(entry.token)}` : null;

  const dateOf = (iso: string) => {
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? null : d(date, { dateStyle: 'medium' });
  };
  const created = dateOf(entry.createdAt);
  const opened = dateOf(entry.lastOpenedAt);

  const copy = async () => {
    const ok = await copyToClipboard(`${window.location.origin}/${entry.id}`);
    toast(ok ? { title: t('my.entry.copied'), tone: 'success' } : { title: t('my.entry.copyFailed'), tone: 'error' });
  };

  const forget = () => {
    const snapshot = { ...entry };
    forgetCollection(entry.id);
    toast({
      title: t('my.entry.forgotten'),
      description: snapshot.token ? t('my.entry.forgottenOwnerHint') : t('my.entry.forgottenHint'),
      tone: 'info',
      duration: 8000,
      action: {
        label: t('my.entry.undo'),
        onClick: () =>
          rememberCollection({
            id: snapshot.id,
            token: snapshot.token,
            title: snapshot.title,
            bookCount: snapshot.bookCount,
            createdAt: snapshot.createdAt,
          }),
      },
    });
  };

  return (
    <Card as="article" variant="inset" aria-labelledby={`my-entry-${entry.id}`} className="p-3.5">
      <div className="flex items-start gap-3">
        <span
          aria-hidden="true"
          className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] [&_svg]:size-[1.125rem]"
        >
          <Library />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 id={`my-entry-${entry.id}`} className="min-w-0 font-display text-base leading-tight font-semibold text-ink">
              {gone ? (
                <span className="text-muted line-through decoration-muted/60">{title}</span>
              ) : (
                <Link href={`/${entry.id}`} className="rounded-sm hover:text-primary hover:underline hover:decoration-accent/60 hover:underline-offset-4">
                  {title}
                </Link>
              )}
            </h3>
            {entry.token ? (
              <Badge tone="gold" size="sm" icon={<KeyRound />} title={t('my.entry.ownerHint')}>
                {t('my.entry.owner')}
              </Badge>
            ) : null}
            <Badge tone={badge.tone} size="sm" dot={remote?.state === 'ok'} icon={remote?.state === 'locked' ? <Lock /> : undefined}>
              {t(badge.key)}
            </Badge>
          </div>
          <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
            <span className="font-mono tracking-tight">{t('my.entry.id', { id: entry.id })}</span>
            {typeof bookCount === 'number' ? <span>{tp('my.entry.books', bookCount)}</span> : null}
            {created ? <span>{t('my.entry.created', { date: created })}</span> : null}
            {opened ? <span>{t('my.entry.lastOpened', { date: opened })}</span> : null}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        {!gone ? (
          <Button href={`/${entry.id}`} size="sm" variant={ownerHref ? 'secondary' : 'primary'} leftIcon={<ExternalLink />}>
            {t('my.entry.open')}
          </Button>
        ) : null}
        {ownerHref && !gone ? (
          <Button href={ownerHref} size="sm" variant="primary" leftIcon={<KeyRound />}>
            {t('my.entry.openOwner')}
          </Button>
        ) : null}
        <div className="ml-auto flex items-center gap-1">
          {!gone ? <IconButton size="sm" tooltip aria-label={t('my.entry.copy')} icon={<Copy />} onClick={() => void copy()} /> : null}
          <IconButton
            size="sm"
            variant="danger"
            tooltip={t('my.entry.forget')}
            aria-label={t('my.entry.forgetAria', { title })}
            icon={<Trash2 />}
            onClick={forget}
          />
        </div>
      </div>
    </Card>
  );
}

function reasonOf(err: unknown): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const d = err.details as { reason?: unknown } | undefined;
  return typeof d?.reason === 'string' ? d.reason : err.code;
}

export function RecoverForm() {
  const { t } = useI18n();
  const inputRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = email.trim();
    if (!address) {
      setError(t('my.recover.required'));
      inputRef.current?.focus();
      return;
    }
    if (!isPlausibleEmail(address)) {
      setError(t('my.recover.invalid'));
      inputRef.current?.focus();
      return;
    }
    setSending(true);
    setError(null);
    try {
      await api.recover(address);
      setSent(true);
    } catch (err) {
      const reason = reasonOf(err);
      if (reason === 'rate_limited') setError(t('my.recover.rateLimited'));
      else if (reason === 'bad_email' || reason === 'invalid') setError(t('my.recover.invalid'));
      else setError(t('my.recover.error'));
      inputRef.current?.focus();
    } finally {
      setSending(false);
    }
  };

  if (sent) {
    return (
      <div role="status" className="rounded-xl border border-success/30 bg-[color-mix(in_oklab,var(--success)_8%,var(--surface))] p-4">
        <p className="flex items-center gap-2 font-semibold text-ink">
          <MailCheck aria-hidden="true" className="size-5 text-success" />
          {t('my.recover.sent.title')}
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-ink text-pretty">{t('my.recover.sent.text')}</p>
        <Button
          size="sm"
          variant="ghost"
          className="mt-2 -ml-2"
          onClick={() => {
            setSent(false);
            setEmail('');
          }}
        >
          {t('my.recover.again')}
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-3">
      <Field label={t('my.recover.label')} error={error}>
        <Input
          ref={inputRef}
          type="email"
          inputMode="email"
          autoComplete="email"
          enterKeyHint="send"
          maxLength={254}
          value={email}
          placeholder={t('my.recover.placeholder')}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
        />
      </Field>
      <Button type="submit" variant="primary" leftIcon={<Send />} loading={sending} className="w-full sm:w-auto sm:self-start">
        {t('my.recover.submit')}
      </Button>
    </form>
  );
}

/** One of the three ways to your catalogues: a numbered bookplate card with an icon, what it is and a hint when to use it. */
function WayCard({
  n,
  id,
  icon,
  title,
  hint,
  aside,
  children,
}: {
  n: number;
  id: string;
  icon: ReactNode;
  title: string;
  hint: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  const { t } = useI18n();
  return (
    // side by side the cards share two rows (subgrid): the heads and the bodies line up whatever their length
    <Card
      as="section"
      variant="bookplate"
      id={id}
      aria-labelledby={`${id}-title`}
      className="flex scroll-mt-24 flex-col p-5 sm:p-6 lg:row-span-2 lg:grid lg:grid-rows-subgrid lg:gap-y-5"
    >
      <div>
        <p className="text-[0.6875rem] font-semibold tracking-[0.16em] text-accent uppercase">{t('my.ways.option', { n })}</p>
        <div className="mt-2.5 flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/25 [&_svg]:size-5"
          >
            {icon}
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <h3 id={`${id}-title`} className="font-display text-xl leading-tight font-semibold text-ink">
                {title}
              </h3>
              {aside}
            </div>
            <p className="mt-1 text-sm leading-relaxed text-muted text-pretty">{hint}</p>
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-col lg:mt-0">{children}</div>
    </Card>
  );
}

export function MyCollections() {
  const { t, tp } = useI18n();
  const mounted = useMounted();
  const entries = useMyCollections();
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const statuses = useRemoteStatuses(mounted ? ids : []);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-12">
      <header className="mx-auto max-w-2xl text-center">
        <h1 className="font-display text-3xl leading-tight font-semibold text-ink sm:text-4xl">{t('my.title')}</h1>
        <p className="mt-2 text-base leading-relaxed text-muted text-pretty">{t('my.intro')}</p>
        <AccountLibraryCard className="mx-auto mt-8 max-w-xl text-left" />
      </header>

      <section aria-labelledby="my-ways-title" className="mt-12 sm:mt-14">
        <SectionHeading id="my-ways-title" eyebrow={t('my.ways.eyebrow')} title={t('my.ways.title')} lead={t('my.ways.lead')} />

        <div className="mt-8 grid gap-5 sm:mt-10 lg:grid-cols-3 lg:grid-rows-[auto_1fr] lg:gap-x-6 lg:gap-y-0">
          {/* 1 · this device */}
          <WayCard
            n={1}
            id="my-list"
            icon={<MonitorSmartphone />}
            title={t('my.list.title')}
            hint={t('my.list.hint')}
            aside={mounted && entries.length > 0 ? <span className="shrink-0 text-xs text-muted">{tp('my.list.count', entries.length)}</span> : null}
          >
            <div aria-busy={!mounted} className="flex flex-1 flex-col">
              {!mounted ? (
                <div className="flex flex-col gap-3">
                  <span className="sr-only">{t('my.list.loading')}</span>
                  <Card variant="inset" className="p-3.5">
                    <div className="flex items-start gap-3">
                      <Skeleton className="size-9 rounded-lg" />
                      <div className="flex flex-1 flex-col gap-2">
                        <Skeleton className="h-5 w-2/3" />
                        <Skeleton className="h-3 w-1/2" />
                      </div>
                    </div>
                  </Card>
                </div>
              ) : entries.length === 0 ? (
                <EmptyState
                  size="sm"
                  className="flex-1 rounded-xl border border-dashed border-line bg-surface-2/40"
                  title={t('my.empty.title')}
                  description={t('my.empty.description')}
                  action={
                    <Button href="/#upload" variant="primary" size="sm" leftIcon={<Plus />}>
                      {t('my.empty.cta')}
                    </Button>
                  }
                />
              ) : (
                // side by side the three cards keep one height: a long list scrolls inside its card (focusable for the keyboard)
                <div
                  tabIndex={0}
                  role="group"
                  aria-label={t('my.list.title')}
                  className="-mx-1 px-1 py-1 [scrollbar-width:thin] lg:max-h-[27rem] lg:overflow-y-auto"
                >
                  <ul className="flex flex-col gap-3">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <EntryCard entry={entry} remote={statuses.get(entry.id)} />
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </WayCard>

          {/* 2 · by id or link */}
          <WayCard n={2} id="my-open" icon={<Hash />} title={t('my.open.title')} hint={t('my.open.description')}>
            <OpenByIdForm layout="stacked" hideLabel />
          </WayCard>

          {/* 3 · lost the link */}
          <WayCard n={3} id="recover" icon={<Mail />} title={t('my.recover.title')} hint={t('my.recover.description')}>
            <RecoverForm />
          </WayCard>
        </div>
      </section>
    </div>
  );
}
