'use client';

import { Library, LogOut } from 'lucide-react';
import { DropdownMenu } from '@/components/ui/DropdownMenu';
import { cn } from '@/components/ui/cn';
import { useI18n } from '@/i18n/client';
import type { SessionUserDTO } from '@/lib/types';
import { useSession } from './SessionProvider';

/** Round profile photo (Google) or the first letter of the name. */
export function UserAvatar({ user, className }: { user: SessionUserDTO; className?: string }) {
  const letter = (user.name ?? user.email).trim().charAt(0).toUpperCase() || '?';
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent-soft text-sm font-semibold text-accent ring-1 ring-line',
        className,
      )}
    >
      {user.picture ? (
        // eslint-disable-next-line @next/next/no-img-element -- external Google photo, no optimisation needed
        <img src={user.picture} alt="" referrerPolicy="no-referrer" className="size-full object-cover" />
      ) : (
        letter
      )}
    </span>
  );
}

/** Header account button: the user's photo; menu with the library and sign-out. */
export function AccountMenu() {
  const { t } = useI18n();
  const { user, signOut } = useSession();
  if (!user) return null;
  return (
    <DropdownMenu
      aria-label={t('account.menu.label')}
      align="end"
      minWidth={240}
      trigger={
        <button
          type="button"
          aria-label={t('account.menu.label')}
          className="inline-flex rounded-full outline-offset-2 transition-transform active:scale-95"
        >
          <UserAvatar user={user} />
        </button>
      }
      items={[
        { type: 'label', key: 'who', label: <span className="block max-w-[15rem] truncate">{t('account.menu.signedInAs', { email: user.email })}</span> },
        ...(user.libraryId
          ? [{ key: 'library', label: t('account.menu.library'), icon: <Library />, href: `/${user.libraryId}` }]
          : []),
        { type: 'separator', key: 'sep' },
        { key: 'out', label: t('account.menu.signOut'), icon: <LogOut />, onSelect: () => void signOut() },
      ]}
    />
  );
}
