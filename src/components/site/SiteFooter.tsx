'use client';

import { Mail } from 'lucide-react';
import Link from 'next/link';
import { useI18n } from '@/i18n/client';
import { cn } from '@/components/ui/cn';
import { LogoMark } from './Logo';

const CONTACT_EMAIL = 'hello@exlibrisvideo.hu';

/** Typographic fleuron rule used as a section ornament. */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 240 20" className={cn('h-5 w-60 max-w-full text-accent', className)} aria-hidden="true" fill="none">
      <path d="M0 10h92" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path d="M148 10h92" stroke="currentColor" strokeWidth="0.8" opacity="0.6" />
      <path
        d="M120 3.5l6.5 6.5-6.5 6.5-6.5-6.5z"
        fill="currentColor"
        opacity="0.9"
      />
      <path
        d="M112 10c-4-6-12-6-15-2 3 1 6 3 7 6M128 10c4-6 12-6 15-2-3 1-6 3-7 6"
        stroke="currentColor"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <circle cx="94" cy="10" r="1.4" fill="currentColor" />
      <circle cx="146" cy="10" r="1.4" fill="currentColor" />
    </svg>
  );
}

/** Site footer: ornament, tagline, legal links, contact, year. */
export function SiteFooter() {
  const { t } = useI18n();
  const year = new Date().getFullYear();
  const linkClass =
    'rounded-sm text-muted underline-offset-4 transition-colors hover:text-ink hover:underline decoration-accent/60';

  return (
    <footer className="mt-16 border-t border-line/70 bg-surface-2/40 print:hidden">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-6 px-4 pt-8 pb-10 text-center sm:px-6">
        <Ornament />
        <div className="flex flex-col items-center gap-3">
          <LogoMark className="h-10 w-auto" />
          <p className="max-w-md font-display text-lg leading-snug text-ink italic text-balance">{t('common.tagline')}</p>
        </div>
        <nav aria-label={t('common.aria.footerNav')}>
          <ul className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-sm">
            <li>
              <Link href="/privacy" className={linkClass}>
                {t('common.footer.privacy')}
              </Link>
            </li>
            <li>
              <Link href="/terms" className={linkClass}>
                {t('common.footer.terms')}
              </Link>
            </li>
            <li>
              <a href={`mailto:${CONTACT_EMAIL}`} className={cn(linkClass, 'inline-flex items-center gap-1.5')}>
                <Mail aria-hidden="true" className="size-3.5" />
                <span>
                  {t('common.footer.contact')}: <span className="font-medium">{CONTACT_EMAIL}</span>
                </span>
              </a>
            </li>
          </ul>
        </nav>
        <p className="text-xs tracking-wide text-muted">
          <span suppressHydrationWarning>{t('common.footer.rights', { year })}</span>
          <span aria-hidden="true" className="mx-2 text-accent">
            ·
          </span>
          {t('common.footer.madeWith')}
        </p>
      </div>
    </footer>
  );
}
