'use client';

/**
 * The "sign in first?" pop-up of the add actions. A visitor who is not signed in and starts one of them
 * (film a shelf, upload, a book from a photo, a book by hand) is told once per browser tab what an account
 * gives – and that signing in after the recording works too – and may carry on without. Nothing is shown
 * when the sign-in is not configured or the visitor is signed in.
 *
 *   const { guard, nudge } = useSignInNudge(collection.id);
 *   <button onClick={() => guard(() => setVideoOpen(true))}>…</button>
 *   {nudge}
 */
import { Library } from 'lucide-react';
import { useCallback, useState, type ReactNode } from 'react';
import { Button, Dialog } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { useSession } from './SessionProvider';
import { SignInButton } from './SignInButton';

const SEEN_KEY = 'exl_signin_nudge_seen';

function nudgeSeen(): boolean {
  try {
    return window.sessionStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markNudgeSeen() {
  try {
    window.sessionStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable – the pop-up simply comes again */
  }
}

export function SignInNudgeDialog({
  open,
  claim,
  onClose,
  onContinue,
}: {
  open: boolean;
  /** the link-only catalogue to turn into the library (omitted: the one this device made most recently) */
  claim?: string | null;
  onClose: () => void;
  onContinue: () => void;
}) {
  const { t } = useI18n();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      icon={<Library />}
      title={t('account.nudge.title')}
      description={t('account.nudge.text')}
      footer={
        <Button variant="ghost" onClick={onContinue}>
          {t('account.nudge.continue')}
        </Button>
      }
    >
      <SignInButton claim={claim} size="lg" fullWidth />
      <p className="mt-3 text-sm text-pretty text-muted">{t('account.nudge.later')}</p>
    </Dialog>
  );
}

export function useSignInNudge(claim?: string | null): { guard: (action: () => void) => void; nudge: ReactNode } {
  const { user, authEnabled } = useSession();
  const [pending, setPending] = useState<(() => void) | null>(null);

  /** runs the action – after the pop-up when the visitor is a guest who has not been told yet */
  const guard = useCallback(
    (action: () => void) => {
      if (user || !authEnabled || nudgeSeen()) {
        action();
        return;
      }
      setPending(() => action);
    },
    [user, authEnabled],
  );

  const nudge = (
    <SignInNudgeDialog
      open={pending !== null}
      claim={claim}
      onClose={() => setPending(null)}
      onContinue={() => {
        markNudgeSeen();
        const run = pending;
        setPending(null);
        run?.();
      }}
    />
  );
  return { guard, nudge };
}
