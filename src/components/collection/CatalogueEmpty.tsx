'use client';

/**
 * Shown instead of the toolbar and views when processing finished without any book (or every source
 * failed): what went wrong, filming tips, and – for the owner – "upload a new video" / "add by hand".
 */
import { BookPlus, Hand, MoveHorizontal, Rows3, Ruler, Sun, TriangleAlert, Video } from 'lucide-react';
import { useState } from 'react';
import { AddBookDialog } from '@/components/book/AddBookDialog';
import { Button, EmptyShelfIllustration } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { MessageKey } from '@/i18n';
import { AddVideoDialog } from './AddMenu';
import { useCollection } from './context';

const TIPS: { key: MessageKey; icon: typeof Sun }[] = [
  { key: 'collection.empty.tip.light', icon: Sun },
  { key: 'collection.empty.tip.distance', icon: Ruler },
  { key: 'collection.empty.tip.pace', icon: MoveHorizontal },
  { key: 'collection.empty.tip.upright', icon: Hand },
  { key: 'collection.empty.tip.rows', icon: Rows3 },
];

export function CatalogueEmpty() {
  const { t } = useI18n();
  const { collection, isOwner } = useCollection();
  const [videoOpen, setVideoOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const failed = collection.status === 'error';

  return (
    <section
      aria-labelledby="collection-empty-title"
      className="mt-6 overflow-hidden rounded-card border border-line bg-surface shadow-soft print:border-0 print:shadow-none"
    >
      <div className="grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.1fr_1fr] lg:items-center">
        <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
          {failed ? (
            <span aria-hidden="true" className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-danger [&_svg]:size-7">
              <TriangleAlert />
            </span>
          ) : (
            <EmptyShelfIllustration className="h-20 w-auto" />
          )}
          <h2 id="collection-empty-title" className="mt-4 font-display text-2xl leading-tight font-semibold text-balance text-ink sm:text-[1.75rem]">
            {failed ? t('collection.empty.errorTitle') : t('collection.empty.title')}
          </h2>
          <p className="mt-2 max-w-lg text-[0.9375rem] text-pretty text-muted">
            {!isOwner ? t('collection.empty.descriptionViewer') : failed ? t('collection.banner.error') : t('collection.empty.description')}
          </p>
          {isOwner ? (
            <div className="mt-6 flex flex-wrap justify-center gap-2 lg:justify-start print:hidden">
              <Button variant="primary" leftIcon={<Video className="size-4" />} onClick={() => setVideoOpen(true)}>
                {t('collection.empty.addVideo')}
              </Button>
              <Button leftIcon={<BookPlus className="size-4" />} onClick={() => setBookOpen(true)}>
                {t('collection.empty.addManual')}
              </Button>
            </div>
          ) : null}
        </div>

        {isOwner ? (
          <div className="rounded-xl border border-accent/30 bg-accent-soft/35 p-5 print:hidden">
            <h3 className="font-display text-lg font-semibold text-ink">{t('collection.empty.tipsTitle')}</h3>
            <ul className="mt-3 flex flex-col gap-2.5">
              {TIPS.map(({ key, icon: Icon }) => (
                <li key={key} className="flex items-start gap-3 text-sm text-ink/90">
                  <span aria-hidden="true" className="mt-px flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-soft [&_svg]:size-3.5">
                    <Icon />
                  </span>
                  <span className="pt-1">{t(key)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>

      {isOwner ? (
        <>
          <AddVideoDialog open={videoOpen} onClose={() => setVideoOpen(false)} />
          <AddBookDialog open={bookOpen} onOpenChange={setBookOpen} />
        </>
      ) : null}
    </section>
  );
}
