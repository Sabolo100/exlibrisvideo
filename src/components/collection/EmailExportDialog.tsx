'use client';

/** Owner dialog: e-mail the catalogue as attachments (POST /api/collections/:id/email). */
import { Lock, Mail } from 'lucide-react';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button, Checkbox, Dialog, Field, Input, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import type { ExportFormat } from '@/lib/types';
import { useCollection } from './context';
import { apiErrorMessage, isApiError } from './errors';
import { useCollectionShell } from './shell-context';
import { EXPORT_META, EXPORT_ORDER } from './view-meta';

const DEFAULT_FORMATS: ExportFormat[] = ['xlsx', 'pdf'];
/** Same shape the API accepts (zod e-mail); a light client check, the server has the final word. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

export function EmailExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection } = useCollection();
  const { setCollectionEmail } = useCollectionShell();
  const formId = useId();
  const emailRef = useRef<HTMLInputElement>(null);

  const [email, setEmail] = useState(collection.email ?? '');
  const [formats, setFormats] = useState<ExportFormat[]>(DEFAULT_FORMATS);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  // fresh form every time it opens
  useEffect(() => {
    if (!open) return;
    setEmail(collection.email ?? '');
    setFormats(DEFAULT_FORMATS);
    setEmailError(null);
    setFormatError(null);
    setFormError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const toggleFormat = (format: ExportFormat, on: boolean) => {
    setFormatError(null);
    setFormats((prev) => (on ? EXPORT_ORDER.filter((f) => f === format || prev.includes(f)) : prev.filter((f) => f !== format)));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const address = email.trim();
    let invalid = false;
    if (!address) {
      setEmailError(t('collection.email.required'));
      invalid = true;
    } else if (!isValidEmail(address)) {
      setEmailError(t('collection.email.invalid'));
      invalid = true;
    }
    if (formats.length === 0) {
      setFormatError(t('collection.email.formatsError'));
      invalid = true;
    }
    if (invalid) {
      if (!address || !isValidEmail(address)) emailRef.current?.focus();
      return;
    }

    setSending(true);
    setFormError(null);
    try {
      await api.emailExport(collection.id, { email: address, formats });
      setCollectionEmail(address);
      toast({ title: t('collection.email.sent'), description: t('collection.email.sentDescription', { email: address }), tone: 'success' });
      onClose();
    } catch (err) {
      if (isApiError(err, 'bad_email')) {
        setEmailError(apiErrorMessage(err, t));
        emailRef.current?.focus();
      } else if (isApiError(err, 'rate_limited')) {
        setFormError(t('collection.email.rateLimited'));
      } else {
        setFormError(apiErrorMessage(err, t));
      }
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      icon={<Mail />}
      title={t('collection.email.title')}
      description={t('collection.email.description')}
      initialFocusRef={emailRef}
      footer={
        <>
          <Button onClick={onClose}>{t('common.action.cancel')}</Button>
          <Button type="submit" form={formId} variant="primary" leftIcon={<Mail className="size-4" />} loading={sending}>
            {t('collection.email.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-4">
        <Field label={t('collection.email.address')} hint={t('collection.email.addressHint')} error={emailError} required>
          <Input
            ref={emailRef}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            maxLength={254}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailError(null);
            }}
          />
        </Field>

        <fieldset aria-describedby={formatError ? `${formId}-formats-error` : undefined}>
          <legend className="mb-2 text-sm font-medium text-ink">{t('collection.email.formats')}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXPORT_ORDER.map((format) => (
              <Checkbox
                key={format}
                checked={formats.includes(format)}
                onCheckedChange={(on) => toggleFormat(format, on)}
                label={t(EXPORT_META[format].labelKey)}
                description={t(EXPORT_META[format].hintKey)}
                className="rounded-lg border border-line/70 p-2.5"
              />
            ))}
          </div>
          {formatError ? (
            <p id={`${formId}-formats-error`} role="alert" className="mt-1.5 text-[0.8125rem] text-danger">
              {formatError}
            </p>
          ) : null}
        </fieldset>

        {collection.visibility === 'pin' ? (
          <p className="flex gap-2 rounded-lg bg-surface-2/70 p-3 text-[0.8125rem] text-muted">
            <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
            {t('collection.email.pinNote')}
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="rounded-lg border border-danger/40 bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))] p-3 text-sm text-danger">
            {formError}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
