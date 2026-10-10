'use client';

import { buttonClasses, type ButtonSize } from '@/components/ui/Button';
import { cn } from '@/components/ui/cn';
import { useI18n } from '@/i18n/client';
import { GoogleIcon } from './GoogleIcon';
import { signInHref, useSession } from './SessionProvider';

/**
 * "Sign in with Google" – a plain link to /api/auth/google (a full navigation: Google's consent screen
 * follows). Renders nothing when the sign-in is not configured or the user is already signed in.
 */
export function SignInButton({
  next,
  size = 'md',
  short = false,
  fullWidth = false,
  className,
}: {
  next?: string | null;
  size?: ButtonSize;
  short?: boolean;
  fullWidth?: boolean;
  className?: string;
}) {
  const { t } = useI18n();
  const { user, authEnabled } = useSession();
  if (!authEnabled || user) return null;
  return (
    <a href={signInHref(next)} className={cn(buttonClasses({ variant: 'secondary', size, fullWidth }), 'font-semibold', className)}>
      <GoogleIcon className="size-[1.125rem]" />
      {short ? t('account.signIn.short') : t('account.signIn.google')}
    </a>
  );
}
