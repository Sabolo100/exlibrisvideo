'use client';

/**
 * Owner settings: title, description, owner name, e-mail + e-mail language, visibility (link / PIN)
 * and the danger zone (delete with typed-id confirmation).
 */
import { Eye, EyeOff, Globe, Lock, Settings2, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button, Dialog, Field, IconButton, Input, SegmentedControl, Textarea, cn, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import { forgetCollection } from '@/lib/client/my-collections';
import type { Locale, Visibility } from '@/lib/types';
import { useCollection } from './context';
import { apiErrorMessage, isApiError } from './errors';
import { ownerLibraryLabel } from './labels';
import { buildSettingsPatch, SETTINGS_LIMITS, sanitizePin, settingsFormFrom, type SettingsField, type SettingsForm } from './settings-form';
import { useCollectionShell } from './shell-context';

function SettingsSection({ title, children, tone }: { title: string; children: ReactNode; tone?: 'danger' }) {
  const id = useId();
  return (
    <section
      aria-labelledby={id}
      className={cn('flex flex-col gap-4 border-t pt-4 first:border-t-0 first:pt-0', tone === 'danger' ? 'border-danger/30' : 'border-line/70')}
    >
      <h3 id={id} className={cn('font-sans text-xs font-semibold tracking-[0.08em] uppercase', tone === 'danger' ? 'text-danger' : 'text-muted')}>
        {title}
      </h3>
      {children}
    </section>
  );
}

export function SettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useI18n();
  const { toast } = useToast();
  const { collection, books } = useCollection();
  const { saveCollection } = useCollectionShell();
  const formId = useId();
  const pinRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<SettingsForm>(() => settingsFormFrom(collection));
  const [errors, setErrors] = useState<Partial<Record<SettingsField, string>>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(settingsFormFrom(collection));
    setErrors({});
    setFormError(null);
    setShowPin(false);
    // reset only when the dialog opens – not on every background refresh while editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const update = <K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    const field = key as SettingsField;
    if (errors[field]) setErrors((prev) => ({ ...prev, [field]: undefined }));
    setFormError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const { patch, errors: invalid } = buildSettingsPatch(collection, form);
    const messages: Partial<Record<SettingsField, string>> = {};
    for (const [field, err] of Object.entries(invalid) as [SettingsField, { key: Parameters<typeof t>[0]; vars?: Record<string, string | number> }][]) {
      messages[field] = t(err.key, err.vars);
    }
    setErrors(messages);
    if (Object.keys(messages).length > 0) {
      const first = (['title', 'description', 'ownerName', 'email', 'pin'] as SettingsField[]).find((f) => messages[f]);
      document.getElementById(`${formId}-${first}`)?.focus();
      return;
    }
    if (Object.keys(patch).length === 0) {
      toast({ title: t('collection.settings.noChanges'), tone: 'info' });
      onClose();
      return;
    }

    setSaving(true);
    try {
      await saveCollection(patch);
      toast({ title: t('collection.settings.saved'), tone: 'success' });
      onClose();
    } catch (err) {
      if (isApiError(err, 'pin_format')) {
        setErrors({ pin: t('collection.settings.pinFormat') });
        pinRef.current?.focus();
      } else if (isApiError(err, 'bad_email')) {
        setErrors({ email: apiErrorMessage(err, t) });
        document.getElementById(`${formId}-email`)?.focus();
      } else {
        setFormError(apiErrorMessage(err, t));
      }
    } finally {
      setSaving(false);
    }
  };

  const hasPin = collection.visibility === 'pin';
  const example = ownerLibraryLabel(form.ownerName || t('collection.settings.field.ownerNameExample'), t);

  return (
    <>
      <Dialog
        open={open && !deleteOpen}
        onClose={onClose}
        size="lg"
        icon={<Settings2 />}
        title={t('collection.settings.title')}
        description={t('collection.settings.description')}
        footer={
          <>
            <Button onClick={onClose}>{t('common.action.cancel')}</Button>
            <Button type="submit" form={formId} variant="primary" loading={saving}>
              {t('common.action.save')}
            </Button>
          </>
        }
      >
        <form id={formId} onSubmit={(e) => void submit(e)} noValidate className="flex flex-col gap-5">
          <SettingsSection title={t('collection.settings.section.general')}>
            <Field label={t('collection.settings.field.title')} error={errors.title} id={`${formId}-title`} optional>
              <Input
                value={form.title}
                maxLength={SETTINGS_LIMITS.title}
                onChange={(e) => update('title', e.target.value)}
                placeholder={t('collection.settings.field.titlePlaceholder')}
                data-autofocus
              />
            </Field>
            <Field label={t('collection.settings.field.description')} error={errors.description} id={`${formId}-description`} optional>
              <Textarea
                autoResize
                minRows={2}
                maxRows={8}
                value={form.description}
                maxLength={SETTINGS_LIMITS.description}
                onChange={(e) => update('description', e.target.value)}
                placeholder={t('collection.settings.field.descriptionPlaceholder')}
              />
            </Field>
            <Field
              label={t('collection.settings.field.ownerName')}
              hint={example ? t('collection.settings.field.ownerNameHint', { example }) : undefined}
              error={errors.ownerName}
              id={`${formId}-ownerName`}
              optional
            >
              <Input
                value={form.ownerName}
                maxLength={SETTINGS_LIMITS.ownerName}
                autoComplete="name"
                onChange={(e) => update('ownerName', e.target.value)}
                placeholder={t('collection.settings.field.ownerNamePlaceholder')}
              />
            </Field>
          </SettingsSection>

          <SettingsSection title={t('collection.settings.section.email')}>
            <Field
              label={t('collection.settings.field.email')}
              hint={t('collection.settings.field.emailHint')}
              error={errors.email}
              id={`${formId}-email`}
              optional
            >
              <Input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                maxLength={SETTINGS_LIMITS.email}
                onChange={(e) => update('email', e.target.value)}
              />
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-ink" id={`${formId}-locale-label`}>
                {t('collection.settings.field.emailLocale')}
              </span>
              <SegmentedControl<Locale>
                aria-label={t('collection.settings.field.emailLocale')}
                value={form.locale}
                onChange={(v) => update('locale', v)}
                options={[
                  { value: 'hu', label: t('common.lang.hu'), lang: 'hu' },
                  { value: 'en', label: t('common.lang.en'), lang: 'en' },
                ]}
                className="self-start"
              />
            </div>
          </SettingsSection>

          <SettingsSection title={t('collection.settings.section.visibility')}>
            <div role="radiogroup" aria-label={t('collection.settings.visibility.label')} className="grid gap-2 sm:grid-cols-2">
              {(['link', 'pin'] as Visibility[]).map((option) => {
                const selected = form.visibility === option;
                const Icon = option === 'link' ? Globe : Lock;
                return (
                  <button
                    key={option}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    tabIndex={selected ? 0 : -1}
                    onClick={() => {
                      update('visibility', option);
                      if (option === 'pin' && !hasPin) requestAnimationFrame(() => pinRef.current?.focus());
                    }}
                    onKeyDown={(e) => {
                      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return;
                      e.preventDefault();
                      const next: Visibility = option === 'link' ? 'pin' : 'link';
                      update('visibility', next);
                      (e.currentTarget.parentElement?.querySelector(`[data-visibility="${next}"]`) as HTMLElement | null)?.focus();
                    }}
                    data-visibility={option}
                    className={cn(
                      'flex items-start gap-3 rounded-xl border p-3 text-left transition-[border-color,background-color,box-shadow] duration-150',
                      selected ? 'border-primary bg-primary/5 shadow-[inset_0_0_0_1px_var(--primary)]' : 'border-line hover:bg-surface-2/60',
                    )}
                  >
                    <span
                      className={cn(
                        'mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full [&_svg]:size-4',
                        selected ? 'bg-primary text-primary-ink' : 'bg-surface-2 text-muted',
                      )}
                    >
                      <Icon aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-ink">
                        {t(option === 'link' ? 'collection.settings.visibility.link' : 'collection.settings.visibility.pin')}
                      </span>
                      <span className="block text-[0.8125rem] text-muted">
                        {t(option === 'link' ? 'collection.settings.visibility.linkHint' : 'collection.settings.visibility.pinHint')}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>

            {form.visibility === 'pin' ? (
              <Field
                label={t('collection.settings.field.pin')}
                hint={hasPin ? t('collection.settings.field.pinKeep') : t('collection.settings.field.pinHint')}
                error={errors.pin}
                id={`${formId}-pin`}
                required={!hasPin}
              >
                <Input
                  ref={pinRef}
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="new-password"
                  maxLength={8}
                  value={form.pin}
                  onChange={(e) => update('pin', sanitizePin(e.target.value))}
                  placeholder={hasPin ? t('collection.settings.field.pinPlaceholderKeep') : undefined}
                  wrapperClassName="max-w-[14rem]"
                  className="font-mono tracking-[0.3em]"
                  rightElement={
                    <IconButton
                      size="xs"
                      aria-label={showPin ? t('collection.pin.hide') : t('collection.pin.show')}
                      aria-pressed={showPin}
                      icon={showPin ? <EyeOff /> : <Eye />}
                      onClick={() => setShowPin((v) => !v)}
                    />
                  }
                />
              </Field>
            ) : null}
          </SettingsSection>

          <SettingsSection title={t('collection.settings.section.danger')} tone="danger">
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-danger/30 p-3">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">{t('collection.settings.delete')}</p>
                <p className="text-[0.8125rem] text-muted">{t('collection.settings.deleteHint')}</p>
              </div>
              <Button variant="secondary" tone="danger" leftIcon={<Trash2 className="size-4" />} onClick={() => setDeleteOpen(true)}>
                {t('collection.settings.delete')}
              </Button>
            </div>
          </SettingsSection>

          {formError ? (
            <p role="alert" className="rounded-lg border border-danger/40 bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))] p-3 text-sm text-danger">
              {formError}
            </p>
          ) : null}
        </form>
      </Dialog>

      <DeleteCollectionDialog
        open={open && deleteOpen}
        bookCount={books.length}
        onClose={() => setDeleteOpen(false)}
        onDeleted={onClose}
      />
    </>
  );
}

export function DeleteCollectionDialog({
  open,
  bookCount,
  onClose,
  onDeleted,
}: {
  open: boolean;
  bookCount: number;
  onClose: () => void;
  onDeleted?: () => void;
}) {
  const { t, tp } = useI18n();
  const { toast } = useToast();
  const router = useRouter();
  const { collection } = useCollection();
  const inputRef = useRef<HTMLInputElement>(null);
  const [typed, setTyped] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open) {
      setTyped('');
      setError(null);
    }
  }, [open]);

  const matches = typed.replace(/\s+/g, '') === collection.id;

  const confirm = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!matches) {
      setError(t('collection.delete.mismatch'));
      inputRef.current?.focus();
      return;
    }
    setDeleting(true);
    try {
      await api.deleteCollection(collection.id);
      forgetCollection(collection.id);
      toast({ title: t('collection.delete.done'), tone: 'success' });
      onDeleted?.();
      router.push('/');
      router.refresh();
    } catch (err) {
      if (isApiError(err, 'not_found')) {
        forgetCollection(collection.id);
        router.push('/');
        return;
      }
      setError(apiErrorMessage(err, t));
      setDeleting(false);
    }
  };

  const formId = useId();

  return (
    <Dialog
      open={open}
      onClose={deleting ? () => undefined : onClose}
      tone="danger"
      icon={<Trash2 />}
      title={t('collection.delete.title')}
      description={bookCount > 0 ? tp('collection.delete.description', bookCount) : t('collection.delete.descriptionEmpty')}
      initialFocusRef={inputRef}
      closeOnOverlayClick={!deleting}
      footer={
        <>
          <Button onClick={onClose} disabled={deleting}>
            {t('common.action.cancel')}
          </Button>
          <Button type="submit" form={formId} variant="danger" loading={deleting} disabled={!matches} leftIcon={<Trash2 className="size-4" />}>
            {t('collection.delete.submit')}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={(e) => void confirm(e)} noValidate>
        <Field label={t('collection.delete.confirmLabel', { id: collection.id })} error={error}>
          <Input
            ref={inputRef}
            value={typed}
            inputMode="numeric"
            autoComplete="off"
            spellCheck={false}
            maxLength={16}
            onChange={(e) => {
              setTyped(e.target.value);
              setError(null);
            }}
            placeholder={collection.id}
            className="font-mono tracking-wider"
          />
        </Field>
      </form>
    </Dialog>
  );
}
