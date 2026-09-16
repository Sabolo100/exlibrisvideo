'use client';

/**
 * Owner-only notes under the header: the edit link (when this device knows the owner token), the
 * "Excel and PDF by e-mail" shortcut and a nudge towards the review queue. Dismissible per collection
 * (localStorage); rendered after hydration only, so a dismissed banner never flashes.
 */
import { AnimatePresence, motion } from 'motion/react';
import { ClipboardCheck, KeyRound, Mail, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button, CopyField, IconButton } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { useCollection } from './context';
import { EmailExportDialog } from './EmailExportDialog';
import { ownerLinkFor } from './ShareDialog';
import { useCollectionShell } from './shell-context';

const DISMISS_PREFIX = 'exl_owner_banner_dismissed_';

export function bannerDismissKey(id: string): string {
  return `${DISMISS_PREFIX}${id}`;
}

function readDismissed(id: string): boolean {
  try {
    return window.localStorage.getItem(bannerDismissKey(id)) === '1';
  } catch {
    return false;
  }
}

function writeDismissed(id: string) {
  try {
    window.localStorage.setItem(bannerDismissKey(id), '1');
  } catch {
    /* storage unavailable – the banner just comes back next time */
  }
}

export function OwnerBanner({ onReview }: { onReview?: () => void }) {
  const { t, tp } = useI18n();
  const { collection, isOwner, setView } = useCollection();
  const { ownerToken, pendingReview } = useCollectionShell();
  // null until mounted (localStorage is client-only)
  const [dismissed, setDismissed] = useState<boolean | null>(null);
  const [emailOpen, setEmailOpen] = useState(false);

  useEffect(() => {
    setDismissed(readDismissed(collection.id));
  }, [collection.id]);

  if (!isOwner) return null;

  const dismiss = () => {
    writeDismissed(collection.id);
    setDismissed(true);
  };

  const startReview = () => {
    setView('review');
    onReview?.();
  };

  return (
    <>
      <AnimatePresence initial={false}>
        {dismissed === false ? (
          // height animates from 0, so the toolbar glides down instead of jumping after hydration
          <motion.div
            key="owner-banner"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.26, ease: 'easeOut' }}
            className="overflow-hidden print:hidden"
          >
            <aside
              aria-label={t('collection.banner.label')}
              className="relative mt-4 overflow-hidden rounded-card border border-accent/40 bg-accent-soft/45 p-4 pr-12 sm:p-5 sm:pr-14"
            >
              <span aria-hidden="true" className="pointer-events-none absolute inset-[5px] rounded-[calc(var(--radius-card)-4px)] border border-accent/25" />
              <IconButton
                aria-label={t('collection.banner.dismiss')}
                tooltip
                size="sm"
                icon={<X />}
                onClick={dismiss}
                className="absolute top-2.5 right-2.5"
              />

              <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:gap-6">
                <div className="flex min-w-0 flex-1 gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-accent shadow-soft [&_svg]:size-[1.125rem]"
                  >
                    <KeyRound />
                  </span>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg leading-snug font-semibold text-ink">{t('collection.banner.title')}</h2>
                    <p className="mt-0.5 text-sm text-pretty text-muted">
                      {ownerToken ? t('collection.banner.text') : t('collection.banner.textNoToken')}
                    </p>
                    {ownerToken ? (
                      <CopyField
                        label={t('collection.banner.editLink')}
                        value={ownerLinkFor(collection.publicUrl, ownerToken)}
                        leftIcon={<KeyRound />}
                        size="sm"
                        className="mt-2.5 max-w-xl"
                      />
                    ) : null}
                  </div>
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2 pl-12 lg:pl-0">
                  {pendingReview > 0 ? (
                    <Button variant="gold" leftIcon={<ClipboardCheck className="size-4" />} onClick={startReview}>
                      <span className="sr-only">{tp('collection.banner.review', pendingReview)} – </span>
                      {t('collection.banner.reviewCta')}
                    </Button>
                  ) : null}
                  <Button leftIcon={<Mail className="size-4" />} onClick={() => setEmailOpen(true)}>
                    {t('collection.banner.emailCta')}
                  </Button>
                </div>
              </div>

              {pendingReview > 0 ? (
                <p aria-hidden="true" className="relative mt-3 border-t border-accent/25 pt-2.5 pl-12 text-[0.8125rem] font-medium text-ink/80">
                  {tp('collection.banner.review', pendingReview)}
                </p>
              ) : null}
            </aside>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <EmailExportDialog open={emailOpen} onClose={() => setEmailOpen(false)} />
    </>
  );
}
