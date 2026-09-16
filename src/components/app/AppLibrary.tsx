'use client';

/**
 * "My catalogues" tab of the phone app: the catalogues remembered on this device as a native list
 * (status, book count, owner badge, remove), "lost your link?" in a sheet.
 */
import { BookMarked, ChevronRight, Hash, KeyRound, LifeBuoy, MoreHorizontal, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { RecoverForm, statusBadge, useMyCollections, useRemoteStatuses } from '@/app/my/MyCollections';
import { Badge, Drawer, EmptyShelfIllustration, useToast } from '@/components/ui';
import type { UploadLimits } from '@/components/upload/limits';
import { useI18n } from '@/i18n/client';
import { forgetCollection, type MyCollectionEntry } from '@/lib/client/my-collections';
import { AppMainTabBar } from './AppMainTabBar';
import { AppOpenSheet } from './AppOpenSheet';
import { AppRecordProvider, useAppRecord } from './AppRecordProvider';
import { AppScreen } from './AppScreen';
import { AppBarButton, AppTopBar } from './AppTopBar';

function LibraryContent() {
  const { t, tp, d } = useI18n();
  const { toast } = useToast();
  const { record } = useAppRecord();
  const entries = useMyCollections();
  const ids = useMemo(() => entries.map((e) => e.id), [entries]);
  const statuses = useRemoteStatuses(ids);
  const [menuFor, setMenuFor] = useState<MyCollectionEntry | null>(null);
  const [recoverOpen, setRecoverOpen] = useState(false);
  const [openSheet, setOpenSheet] = useState(false);

  return (
    <AppScreen
      top={
        <AppTopBar
          title={t('app.library.title')}
          subtitle={t('app.library.subtitle')}
          actions={<AppBarButton label={t('app.home.open.title')} icon={<Hash />} onClick={() => setOpenSheet(true)} />}
        />
      }
      bottom={<AppMainTabBar active="library" />}
      mainClassName="px-4 pt-3 pb-4"
    >
      {entries.length === 0 ? (
        <div className="app-screen-in flex h-full flex-col items-center justify-center px-6 text-center">
          <EmptyShelfIllustration className="w-44" />
          <h2 className="mt-4 font-display text-xl font-semibold text-ink">{t('app.library.empty.title')}</h2>
          <p className="mt-1 text-[0.9375rem] text-pretty text-muted">{t('app.library.empty.text')}</p>
          <button
            type="button"
            onClick={record}
            className="mt-5 h-12 rounded-full bg-primary px-6 text-[0.9375rem] font-semibold text-primary-ink active:scale-[0.98]"
          >
            {t('app.home.record.title')}
          </button>
        </div>
      ) : (
        <ul className="app-screen-in overflow-hidden rounded-2xl border border-line bg-surface">
          {entries.map((entry, i) => {
            const remote = statuses.get(entry.id);
            const badge = statusBadge(remote);
            const count = remote?.state === 'ok' ? remote.status.bookCount : entry.bookCount;
            return (
              <li key={entry.id} className={i > 0 ? 'border-t border-line/70' : undefined}>
                <div className="flex items-center">
                  <Link href={`/${entry.id}`} className="app-chrome flex min-w-0 flex-1 items-center gap-3 py-3 pl-3.5 active:bg-surface-2">
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
                      {entry.token ? <KeyRound className="size-5" /> : <BookMarked className="size-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[0.9375rem] font-semibold text-ink">
                        {entry.title || t('app.home.recent.untitled', { id: entry.id })}
                      </span>
                      <span className="mt-0.5 flex items-center gap-2 text-[0.8125rem] text-muted">
                        {typeof count === 'number' ? <span className="tabular-nums">{tp('app.home.recent.books', count)}</span> : null}
                        <span className="truncate">{d(entry.lastOpenedAt, { month: 'short', day: 'numeric' })}</span>
                      </span>
                    </span>
                    <Badge tone={badge.tone} className="shrink-0">
                      {t(badge.key)}
                    </Badge>
                    <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
                  </Link>
                  <AppBarButton label={t('app.library.forget')} icon={<MoreHorizontal />} onClick={() => setMenuFor(entry)} className="mr-1" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {entries.length > 0 ? (
        <button
          type="button"
          onClick={() => setRecoverOpen(true)}
          className="app-chrome mt-4 flex w-full items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left active:bg-surface-2"
        >
          <LifeBuoy aria-hidden="true" className="size-5 text-accent" />
          <span className="flex-1 text-[0.9375rem] font-medium text-ink">{t('app.library.lost')}</span>
          <ChevronRight aria-hidden="true" className="size-5 text-muted" />
        </button>
      ) : null}

      <Drawer open={menuFor !== null} onClose={() => setMenuFor(null)} title={menuFor?.title || t('app.home.recent.untitled', { id: menuFor?.id ?? '' })} size="sm">
        <button
          type="button"
          onClick={() => {
            if (!menuFor) return;
            forgetCollection(menuFor.id);
            setMenuFor(null);
            toast({ title: t('app.library.forgotten') });
          }}
          className="flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left text-[0.9375rem] font-medium text-danger active:bg-surface-2"
        >
          <Trash2 aria-hidden="true" className="size-5" />
          {t('app.library.forget')}
        </button>
      </Drawer>
      <Drawer open={recoverOpen} onClose={() => setRecoverOpen(false)} title={t('my.recover.title')} size="sm">
        <RecoverForm />
      </Drawer>
      <AppOpenSheet open={openSheet} onClose={() => setOpenSheet(false)} />
    </AppScreen>
  );
}

export function AppLibrary({ limits }: { limits?: UploadLimits }) {
  return (
    <AppRecordProvider limits={limits}>
      <LibraryContent />
    </AppRecordProvider>
  );
}
