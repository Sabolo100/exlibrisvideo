'use client';

import { ChevronRight, Library } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useRef } from 'react';
import { cn } from '@/components/ui/cn';
import { useToast } from '@/components/ui/Toast';
import { useI18n } from '@/i18n/client';
import { UserAvatar } from './AccountMenu';
import { useSession } from './SessionProvider';
import { SignInButton } from './SignInButton';

/**
 * The recommended start: sign in with Google, the library stays with the account. The link-only uploader
 * below it is plan B. Renders nothing when the sign-in is not configured or the user is signed in.
 */
export function SignInCard({ variant = 'hero', className }: { variant?: 'hero' | 'app'; className?: string }) {
  const { t } = useI18n();
  const { user, authEnabled } = useSession();
  if (!authEnabled || user) return null;
  const app = variant === 'app';
  return (
    <section
      aria-labelledby="signin-card-title"
      className={cn(
        'relative rounded-2xl border border-accent/40 bg-surface p-4 shadow-[0_6px_20px_-14px_hsl(var(--shadow-color)/0.55)]',
        app ? 'app-chrome' : 'sm:p-5',
        className,
      )}
    >
      <span className="absolute -top-2.5 left-4 rounded-full bg-accent px-2 py-0.5 text-[0.6875rem] font-semibold tracking-wide text-[#2a1c08] uppercase">
        {t('account.signIn.recommended')}
      </span>
      <h2 id="signin-card-title" className={cn('font-display font-semibold text-ink', app ? 'text-[1.0625rem]' : 'text-lg')}>
        {t('account.signIn.title')}
      </h2>
      <p className={cn('mt-1 text-muted text-pretty', app ? 'text-[0.8125rem] leading-snug' : 'text-sm leading-relaxed')}>
        {t('account.signIn.text')}
      </p>
      <SignInButton fullWidth size={app ? 'md' : 'lg'} className="mt-3" />
      {!app ? <p className="mt-3 text-xs text-muted">{t('account.signIn.withoutAccount')}</p> : null}
    </section>
  );
}

/** Shows a toast after a failed / unavailable sign-in (`/?auth=failed|unavailable`) and drops the param. */
export function AuthNotice() {
  const { t } = useI18n();
  const toast = useToast();
  const params = useSearchParams();
  const shown = useRef(false);
  const auth = params.get('auth');
  useEffect(() => {
    if (!auth || shown.current) return;
    shown.current = true;
    toast.error(auth === 'unavailable' ? t('account.signIn.unavailable') : t('account.signIn.failed'));
    const url = new URL(window.location.href);
    url.searchParams.delete('auth');
    window.history.replaceState(null, '', url.pathname + url.search + url.hash);
  }, [auth, t, toast]);
  return null;
}

/** Signed in: a big link to the user's library. Signed out: the sign-in card (when configured). */
export function AccountLibraryCard({ variant = 'hero', className }: { variant?: 'hero' | 'app'; className?: string }) {
  const { t } = useI18n();
  const { user } = useSession();
  if (!user) return <SignInCard variant={variant} className={className} />;
  if (!user.libraryId) return null;
  return (
    <Link
      href={`/${user.libraryId}`}
      className={cn(
        'flex items-center gap-3 rounded-2xl border border-accent/40 bg-surface p-3.5 shadow-[0_6px_20px_-14px_hsl(var(--shadow-color)/0.55)] transition-colors hover:bg-surface-2 active:scale-[0.99]',
        variant === 'app' && 'app-chrome',
        className,
      )}
    >
      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent">
        <Library aria-hidden="true" className="size-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-base font-semibold text-ink">{t('account.menu.library')}</span>
        <span className="block truncate text-sm text-muted">{user.email}</span>
      </span>
      <UserAvatar user={user} />
      <ChevronRight aria-hidden="true" className="size-5 shrink-0 text-muted" />
    </Link>
  );
}
