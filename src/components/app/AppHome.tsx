'use client';

/**
 * Home tab of the phone app: a compact hero with a little shelf, the big "record a shelf" action,
 * gallery / open-by-number tiles and the recent catalogues – all on one screen, no page scroll.
 */
import { Camera, ChevronRight, Hash, Images, Lightbulb, MoveHorizontal, Ruler, Settings2, SunMedium } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useState, type ReactNode } from 'react';
import { BookSpine, SAMPLE_BOOKS } from '@/components/books';
import { LogoMark } from '@/components/site/Logo';
import type { UploadLimits } from '@/components/upload/limits';
import { useI18n } from '@/i18n/client';
import { listMyCollections, type MyCollectionEntry } from '@/lib/client/my-collections';
import { AppMainTabBar } from './AppMainTabBar';
import { AppOpenSheet } from './AppOpenSheet';
import { AppRecordProvider, useAppRecord } from './AppRecordProvider';
import { AppScreen } from './AppScreen';
import { AppSettingsSheet } from './AppSettingsSheet';
import { AppBarButton, AppTopBar } from './AppTopBar';

const HERO_BOOKS = SAMPLE_BOOKS.slice(0, 11);

function HeroShelf() {
  return (
    <div aria-hidden="true" className="relative mx-auto flex h-[84px] w-full items-end justify-center gap-[3px] overflow-hidden px-3">
      {HERO_BOOKS.map((book, i) => (
        <BookSpine
          key={book.id}
          book={book}
          size="sm"
          decorative
          className="app-screen-in shrink-0 origin-bottom"
          style={{ animationDelay: `${i * 35}ms`, height: `${62 + ((i * 37) % 22)}px` }}
        />
      ))}
      <span className="absolute inset-x-2 bottom-0 h-2 rounded-sm bg-gradient-to-b from-wood-light to-wood-dark shadow-[0_2px_4px_-1px_hsl(var(--shadow-color)/0.5)]" />
    </div>
  );
}

function ActionTile({ icon, title, hint, onClick }: { icon: ReactNode; title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="app-chrome flex min-w-0 flex-1 items-center gap-3 rounded-2xl border border-line bg-surface px-3.5 py-3 text-left shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)] transition-transform active:scale-[0.98] active:bg-surface-2"
    >
      <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-5">{icon}</span>
      <span className="min-w-0">
        <span className="block truncate text-[0.9375rem] leading-tight font-semibold text-ink">{title}</span>
        <span className="block truncate text-[0.8125rem] leading-tight text-muted">{hint}</span>
      </span>
    </button>
  );
}

function RecentCards({ entries }: { entries: MyCollectionEntry[] }) {
  const { t, tp, d } = useI18n();
  return (
    <ul className="app-scroll -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1">
      {entries.map((entry) => (
        <li key={entry.id} className="w-[46%] max-w-[190px] shrink-0 snap-start">
          <Link
            href={`/${entry.id}`}
            className="app-chrome flex h-[112px] flex-col justify-between rounded-2xl border border-line bg-surface p-3 shadow-[0_1px_2px_hsl(var(--shadow-color)/0.08)] active:scale-[0.98]"
          >
            <span className="line-clamp-2 font-display text-[0.9375rem] leading-snug font-semibold text-ink">
              {entry.title || t('app.home.recent.untitled', { id: entry.id })}
            </span>
            <span className="flex items-end justify-between gap-2 text-[0.75rem] text-muted">
              <span className="tabular-nums">
                {typeof entry.bookCount === 'number' ? tp('app.home.recent.books', entry.bookCount) : d(entry.lastOpenedAt, { month: 'short', day: 'numeric' })}
              </span>
              {entry.token ? (
                <span className="rounded-full bg-accent-soft px-1.5 py-0.5 text-[0.625rem] font-semibold text-accent uppercase">
                  {t('app.home.recent.owner')}
                </span>
              ) : null}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Tips() {
  const { t } = useI18n();
  const tips = [
    { icon: <SunMedium />, text: t('app.home.tips.light') },
    { icon: <MoveHorizontal />, text: t('app.home.tips.slow') },
    { icon: <Ruler />, text: t('app.home.tips.distance') },
  ];
  return (
    <div className="rounded-2xl border border-line bg-surface p-3.5">
      <p className="flex items-center gap-1.5 text-[0.8125rem] font-semibold text-ink">
        <Lightbulb aria-hidden="true" className="size-4 text-accent" />
        {t('app.home.tips.title')}
      </p>
      <ul className="mt-2 grid gap-1.5">
        {tips.map((tip) => (
          <li key={tip.text} className="flex items-center gap-2 text-[0.875rem] text-muted [&_svg]:size-4 [&_svg]:text-primary">
            {tip.icon}
            {tip.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

function HomeContent() {
  const { t } = useI18n();
  const { record, pickFromGallery } = useAppRecord();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [openSheet, setOpenSheet] = useState(false);
  const [recent, setRecent] = useState<MyCollectionEntry[] | null>(null);

  useEffect(() => {
    setRecent(listMyCollections().slice(0, 8));
  }, []);

  return (
    <AppScreen
      top={
        <AppTopBar
          leading={<LogoMark className="ml-2 h-8 w-7" />}
          title={t('app.name')}
          actions={<AppBarButton label={t('app.settings.title')} icon={<Settings2 />} onClick={() => setSettingsOpen(true)} />}
        />
      }
      bottom={<AppMainTabBar active="home" />}
      mainClassName="flex flex-col gap-3 px-4 pt-3 pb-4"
    >
      <section className="app-screen-in flex min-h-[180px] flex-1 flex-col justify-center overflow-hidden rounded-[22px] border border-line bg-surface pt-3 pb-3.5 shadow-[0_6px_20px_-12px_hsl(var(--shadow-color)/0.45)]">
        <HeroShelf />
        <div className="px-4 pt-3 text-center">
          <h2 className="font-display text-[1.375rem] leading-tight font-semibold text-ink">{t('app.home.hero.title')}</h2>
          <p className="mt-1 text-[0.875rem] leading-snug text-muted">{t('app.home.hero.text')}</p>
        </div>
      </section>

      <button
        type="button"
        onClick={record}
        className="app-chrome flex shrink-0 items-center gap-3.5 rounded-2xl bg-primary px-4 py-3.5 text-left text-primary-ink shadow-[0_10px_24px_-12px_hsl(var(--shadow-color)/0.7)] transition-transform active:scale-[0.98]"
      >
        <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary-ink/15 [&_svg]:size-6">
          <Camera />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[1.0625rem] leading-tight font-semibold">{t('app.home.record.title')}</span>
          <span className="block text-[0.8125rem] leading-tight opacity-80">{t('app.home.record.hint')}</span>
        </span>
        <ChevronRight aria-hidden="true" className="size-5 opacity-70" />
      </button>

      <div className="flex shrink-0 gap-3">
        <ActionTile icon={<Images />} title={t('app.home.gallery.title')} hint={t('app.home.gallery.hint')} onClick={pickFromGallery} />
        <ActionTile icon={<Hash />} title={t('app.home.open.title')} hint={t('app.home.open.hint')} onClick={() => setOpenSheet(true)} />
      </div>

      <section className="flex shrink-0 flex-col">
        {recent && recent.length > 0 ? (
          <>
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-[0.9375rem] font-semibold text-ink">{t('app.home.recent.title')}</h2>
              <Link href="/my" className="text-[0.875rem] font-medium text-primary active:opacity-70">
                {t('app.home.recent.all')}
              </Link>
            </div>
            <RecentCards entries={recent} />
          </>
        ) : recent ? (
          <Tips />
        ) : null}
      </section>

      <AppSettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <AppOpenSheet open={openSheet} onClose={() => setOpenSheet(false)} />
    </AppScreen>
  );
}

export function AppHome({ limits }: { limits?: UploadLimits }) {
  return (
    <AppRecordProvider limits={limits}>
      <HomeContent />
    </AppRecordProvider>
  );
}
