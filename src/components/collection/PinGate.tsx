'use client';

/**
 * Lock screen of a PIN-protected collection (visibility "pin", no valid PIN cookie yet).
 * PIN → POST /unlock (sets the exl_pin_<id> cookie) → router.refresh() re-renders the page with access.
 * Owner links (?k= / ?r=) keep working here: claiming makes the viewer the owner, who always has access.
 */
import { Eye, EyeOff, KeyRound, LockKeyhole } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Ornament } from '@/components/site/SiteFooter';
import { Button, IconButton, Input, Spinner, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import { apiErrorMessage, isApiError, isNetworkError } from './errors';
import { collectionTitle } from './labels';
import { PIN_RE, sanitizePin } from './settings-form';
import { useClaimFromUrl } from './useClaim';
import './collection.css';

export interface PinGateProps {
  id: string;
  title: string | null;
}

type Status = { kind: 'idle' } | { kind: 'checking' } | { kind: 'unlocked' } | { kind: 'error'; message: string };

/** How long to wait for the refreshed page before assuming the cookie was not stored. */
const REFRESH_TIMEOUT_MS = 10_000;

export function PinGate({ id, title }: PinGateProps) {
  const { t } = useI18n();
  const router = useRouter();
  const { claiming } = useClaimFromUrl(id, { title, isOwner: false });
  const inputRef = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const hintId = useId();
  const [pin, setPin] = useState('');
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const [shake, setShake] = useState(0);

  const displayTitle = collectionTitle({ id, title, ownerName: null }, t);

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  // the page normally swaps this component out after the refresh; if it doesn't, the cookie was blocked
  useEffect(() => {
    if (status.kind !== 'unlocked') return;
    const timer = window.setTimeout(() => setStatus({ kind: 'error', message: t('collection.pin.stuck') }), REFRESH_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [status.kind, t]);

  const fail = (message: string, clear: boolean) => {
    setStatus({ kind: 'error', message });
    setShake((n) => n + 1);
    if (clear) setPin('');
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status.kind === 'checking' || status.kind === 'unlocked') return;
    const value = sanitizePin(pin);
    if (!PIN_RE.test(value)) {
      fail(t('collection.pin.format'), false);
      return;
    }
    setStatus({ kind: 'checking' });
    try {
      await api.unlock(id, value);
      setStatus({ kind: 'unlocked' });
      router.refresh();
    } catch (err) {
      if (isApiError(err, 'wrong_pin')) fail(t('collection.pin.wrong'), true);
      else if (isApiError(err, 'rate_limited')) fail(t('collection.pin.rateLimited'), false);
      else if (isApiError(err, 'invalid')) fail(t('collection.pin.format'), false);
      else if (isApiError(err, 'not_found')) {
        // deleted in the meantime: the refreshed page shows the 404
        setStatus({ kind: 'idle' });
        router.refresh();
      }
      else if (isNetworkError(err)) fail(t('collection.toast.network'), false);
      else fail(apiErrorMessage(err, t), false);
    }
  };

  const busy = status.kind === 'checking' || status.kind === 'unlocked' || claiming;
  const error = status.kind === 'error' ? status.message : null;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-14rem)] w-full max-w-6xl items-center justify-center px-4 py-10 sm:px-6 sm:py-16">
      <section
        aria-labelledby={`${hintId}-title`}
        className="relative w-full max-w-md overflow-hidden rounded-card border border-line bg-surface px-6 pt-10 pb-7 text-center shadow-lift sm:px-10"
      >
        {/* bookplate frame */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-[7px] rounded-[calc(var(--radius-card)-6px)] border border-accent/35" />
        <span aria-hidden="true" className="pointer-events-none absolute -top-20 left-1/2 h-40 w-80 -translate-x-1/2 rounded-full bg-accent-soft/70 blur-3xl" />

        <div className="relative">
          <div
            aria-hidden="true"
            className="mx-auto flex size-16 items-center justify-center rounded-full border border-accent/50 bg-accent-soft text-accent shadow-[inset_0_0_0_4px_var(--surface)]"
          >
            {status.kind === 'unlocked' || claiming ? <Spinner size="md" decorative /> : <LockKeyhole className="size-7" strokeWidth={1.6} />}
          </div>

          <p className="mt-5 font-display text-sm tracking-[0.24em] text-accent uppercase italic">{t('collection.pin.eyebrow')}</p>
          <h1 id={`${hintId}-title`} className="mt-1.5 font-display text-[1.75rem] leading-tight font-semibold text-balance break-words text-ink">
            {displayTitle}
          </h1>
          <Ornament className="mx-auto mt-3 w-44" />
          <p className="mx-auto mt-3 max-w-sm text-[0.9375rem] text-pretty text-muted">{t('collection.pin.description')}</p>

          <form onSubmit={(e) => void submit(e)} noValidate className="mt-6 flex flex-col items-stretch gap-3 text-left">
            <label htmlFor={`${hintId}-pin`} className="text-sm font-medium text-ink">
              {t('collection.pin.label')}
            </label>
            <div key={shake} className={cn(shake > 0 && 'motion-safe:animate-[exl-shake_320ms_ease-in-out]')}>
              <Input
                ref={inputRef}
                id={`${hintId}-pin`}
                name="pin"
                type={visible ? 'text' : 'password'}
                inputMode="numeric"
                pattern="[0-9]*"
                autoComplete="off"
                enterKeyHint="go"
                maxLength={8}
                size="lg"
                value={pin}
                disabled={status.kind === 'unlocked'}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setPin(sanitizePin(e.target.value));
                  if (status.kind === 'error') setStatus({ kind: 'idle' });
                }}
                placeholder="••••"
                className="text-center font-mono text-2xl tracking-[0.5em] placeholder:tracking-[0.5em]"
                leftIcon={<KeyRound className="size-5" />}
                rightElement={
                  <IconButton
                    size="sm"
                    aria-label={visible ? t('collection.pin.hide') : t('collection.pin.show')}
                    aria-pressed={visible}
                    icon={visible ? <EyeOff /> : <Eye />}
                    onClick={() => setVisible((v) => !v)}
                  />
                }
              />
            </div>
            <p id={errorId} role="alert" aria-live="assertive" className={cn('min-h-5 text-center text-[0.8125rem]', error ? 'text-danger' : 'text-success')}>
              {error ?? (status.kind === 'unlocked' ? t('collection.pin.success') : claiming ? t('collection.claim.working') : '')}
            </p>
            <Button type="submit" variant="primary" size="lg" fullWidth loading={busy}>
              {t('collection.pin.submit')}
            </Button>
          </form>

          <p className="mt-6 border-t border-line/70 pt-4 text-[0.8125rem] text-pretty text-muted">
            {t('collection.pin.ownerHint')}{' '}
            <Link href="/my" className="font-medium text-accent underline-offset-2 hover:underline">
              {t('collection.pin.myLink')}
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}
