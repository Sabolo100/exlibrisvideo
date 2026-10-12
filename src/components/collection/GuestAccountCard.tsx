'use client';

/**
 * Shown to the owner of a link-only catalogue who is not signed in: signing in now turns this catalogue
 * (the books of the recording they just made) into their account's library. Under the header of the
 * catalogue and above the processing panel; renders nothing for a signed-in user or an account library.
 */
import { Library } from 'lucide-react';
import { useSession } from '@/components/site/SessionProvider';
import { SignInButton } from '@/components/site/SignInButton';
import { cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { useCollection } from './context';

export function GuestAccountCard({ className }: { className?: string }) {
  const { t } = useI18n();
  const { user, authEnabled } = useSession();
  const { collection, isOwner } = useCollection();
  if (!authEnabled || user || !isOwner || collection.isAccountLibrary) return null;

  return (
    <aside
      aria-label={t('account.keep.label')}
      className={cn(
        'relative flex flex-col gap-3 rounded-card border border-accent/45 bg-surface p-4 shadow-soft sm:flex-row sm:items-center sm:gap-5 sm:px-5 print:hidden',
        className,
      )}
    >
      <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-5">
        <Library />
      </span>
      <div className="min-w-0 flex-1">
        <h2 className="font-display text-[1.0625rem] leading-snug font-semibold text-ink">{t('account.keep.title')}</h2>
        <p className="mt-0.5 text-[0.8125rem] leading-snug text-pretty text-muted sm:text-sm">{t('account.keep.text')}</p>
      </div>
      <SignInButton claim={collection.id} size="lg" className="sm:shrink-0" />
    </aside>
  );
}
