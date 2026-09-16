'use client';

import { BellRing, MailCheck } from 'lucide-react';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { cn } from '@/components/ui/cn';
import { isPlausibleEmail } from '@/components/upload/validate';
import { api, ApiClientError } from '@/lib/client/api';

export interface EmailWhenReadyProps {
  collectionId: string;
  /** the address already stored for the collection (owner only) */
  email: string | null;
  emailSentAt: string | null;
  onSaved: (email: string) => void;
  className?: string;
}

function reasonOf(err: unknown): string | null {
  if (!(err instanceof ApiClientError)) return null;
  const d = err.details as { reason?: unknown } | undefined;
  return typeof d?.reason === 'string' ? d.reason : err.code;
}

/** Owner-only "e-mail me when it's ready" capture (PATCH { email }); a confirmation line once an address is known. */
export function EmailWhenReady({ collectionId, email, emailSentAt, onSaved, className }: EmailWhenReadyProps) {
  const { t } = useI18n();
  const headingId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);

  if (email) {
    return (
      <Card variant="inset" as="section" aria-labelledby={headingId} className={cn('p-4', className)}>
        <div className="flex items-start gap-3" role={justSaved ? 'status' : undefined}>
          <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-surface text-success [&_svg]:size-5">
            <MailCheck />
          </span>
          <div className="min-w-0">
            <h2 id={headingId} className="font-display text-base leading-tight font-semibold text-ink">
              {t('processing.email.title')}
            </h2>
            <p className="mt-1 text-sm break-words text-muted">
              {justSaved
                ? t('processing.email.saved', { email })
                : emailSentAt
                  ? t('processing.email.alreadySent', { email })
                  : t('processing.email.already', { email })}
            </p>
          </div>
        </div>
      </Card>
    );
  }

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const address = value.trim();
    if (!address) {
      setError(t('processing.email.required'));
      inputRef.current?.focus();
      return;
    }
    if (!isPlausibleEmail(address)) {
      setError(t('processing.email.invalid'));
      inputRef.current?.focus();
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const updated = await api.updateCollection(collectionId, { email: address });
      setJustSaved(true);
      onSaved(updated.email ?? address);
    } catch (err) {
      setError(reasonOf(err) === 'bad_email' ? t('processing.email.invalid') : t('processing.email.error'));
      inputRef.current?.focus();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card as="section" aria-labelledby={headingId} className={cn('p-5', className)}>
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-5">
          <BellRing />
        </span>
        <div className="min-w-0">
          <h2 id={headingId} className="font-display text-lg leading-tight font-semibold text-ink">
            {t('processing.email.title')}
          </h2>
          <p className="mt-1 text-sm text-muted text-pretty">{t('processing.email.description')}</p>
        </div>
      </div>
      <form className="mt-4 flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate>
        <Field label={t('processing.email.label')} hint={t('processing.email.privacy')} error={error}>
          <Input
            ref={inputRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            enterKeyHint="send"
            maxLength={254}
            value={value}
            placeholder={t('processing.email.placeholder')}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto sm:self-start">
          {t('processing.email.submit')}
        </Button>
      </form>
    </Card>
  );
}
