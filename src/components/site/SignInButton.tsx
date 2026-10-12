'use client';

import { useEffect, useState } from 'react';
import { buttonClasses, type ButtonSize } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useI18n } from '@/i18n/client';
import { latestOwnedGuestId } from '@/lib/client/my-collections';
import { GoogleIcon } from './GoogleIcon';
import { signInHref, useSession } from './SessionProvider';

/**
 * "Sign in with Google" – a plain link to /api/auth/google (a full navigation: Google's consent screen
 * follows). Renders nothing when the sign-in is not configured or the user is already signed in.
 * `claim`: the link-only catalogue to turn into the library; omitted → the one this device made most recently,
 * `null` → none.
 */
export function SignInButton({
  next,
  claim,
  size = 'md',
  short = false,
  fullWidth = false,
  className,
}: {
  next?: string | null;
  claim?: string | null;
  size?: ButtonSize;
  short?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { user, authEnabled } = useSession();
  // localStorage is client-only: the link gains the claim right after mount
  const [remembered, setRemembered] = useState<string | null>(null);
  useEffect(() => {
    if (claim === undefined) setRemembered(latestOwnedGuestId());
  }, [claim]);
  if (!authEnabled || user) return null;
  return (
    <a href={signInHref(next, claim === undefined ? remembered : claim)} className={cn(buttonClasses({ variant: 'secondary', size, fullWidth }), 'font-semibold', className)}>
      <GoogleIcon className="size-[1.125rem]" />
      {short ? t('account.signIn.short') : t('account.signIn.google')}
    </a>
  );
}
