'use client';

import { BookPlus, CopyCheck, ExternalLink } from 'lucide-react';
import { useDeferredValue, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { spineLabel, READING_STATUS_META } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { Button, Dialog, Field, Input, Select } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { isTopicKey } from '@/lib/taxonomy';
import { READING_STATUSES, type BookPatch, type ReadingStatus } from '@/lib/types';
import { formErrorMessage, TopicOptionGroups } from './BookEditForm';
import { BOOK_LIMITS, cleanText, findDuplicates, parseOptionalInt, type BookFormError } from './book-form-utils';

export interface AddBookDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface AddValues {
  author: string;
  title: string;
  year: string;
  topic: string;
  status: ReadingStatus;
}

const EMPTY: AddValues = { author: '', title: '', year: '', topic: '', status: 'unknown' };

/** Owner: add a book by hand (author, title, optional year / topic / reading status) with a live duplicate warning. */
export function AddBookDialog({ open, onOpenChange }: AddBookDialogProps) {
  const { t, n, locale } = useI18n();
  const errorText = (error: BookFormError | undefined) => formErrorMessage(t, error, n);
  const { books, addBook, openBook, isOwner } = useCollection();
  const formId = useId();
  const authorRef = useRef<HTMLInputElement>(null);

  const [values, setValues] = useState<AddValues>(EMPTY);
  const [errors, setErrors] = useState<{ title?: BookFormError; year?: BookFormError; author?: BookFormError }>({});
  const [submitting, setSubmitting] = useState<null | 'open' | 'another'>(null);
  const [lastAdded, setLastAdded] = useState<string | null>(null);

  const deferredTitle = useDeferredValue(values.title);
  const deferredAuthor = useDeferredValue(values.author);
  const duplicates = useMemo(
    () => findDuplicates(books, { title: deferredTitle, author: deferredAuthor }, { limit: 3 }),
    [books, deferredTitle, deferredAuthor],
  );

  const close = () => {
    if (submitting) return;
    onOpenChange(false);
    setValues(EMPTY);
    setErrors({});
    setLastAdded(null);
  };

  const validate = (v: AddValues) => {
    const next: typeof errors = {};
    const title = cleanText(v.title);
    if (!title) next.title = { code: 'required' };
    else if (title.length > BOOK_LIMITS.title) next.title = { code: 'tooLong', max: BOOK_LIMITS.title };
    const author = cleanText(v.author);
    if (author && author.length > BOOK_LIMITS.author) next.author = { code: 'tooLong', max: BOOK_LIMITS.author };
    const year = parseOptionalInt(v.year, BOOK_LIMITS.yearMin, BOOK_LIMITS.yearMax);
    if (year.error === 'number') next.year = { code: 'yearNumber' };
    if (year.error === 'range') next.year = { code: 'yearRange', min: BOOK_LIMITS.yearMin, max: BOOK_LIMITS.yearMax };
    return { errors: next, title, author, year: year.value };
  };

  const update = <K extends keyof AddValues>(key: K, value: AddValues[K]) => {
    const next = { ...values, [key]: value };
    setValues(next);
    if (Object.keys(errors).length > 0) setErrors(validate(next).errors);
    if (lastAdded) setLastAdded(null);
  };

  const submit = async (mode: 'open' | 'another', e?: FormEvent) => {
    e?.preventDefault();
    if (submitting) return;
    const result = validate(values);
    setErrors(result.errors);
    if (!result.title || Object.keys(result.errors).length > 0) {
      const firstInvalid = result.errors.author ? 'author' : result.errors.title ? 'title' : 'year';
      requestAnimationFrame(() => document.getElementById(`${formId}-${firstInvalid}`)?.focus());
      return;
    }
    const input: BookPatch & { title: string } = { title: result.title, author: result.author };
    if (result.year !== null) input.firstPublishedYear = result.year;
    if (values.topic && isTopicKey(values.topic)) input.category = values.topic;
    if (values.status !== 'unknown') input.readingStatus = values.status;

    setSubmitting(mode);
    const created = await addBook(input);
    setSubmitting(null);
    if (!created) return; // provider shows the error; keep the form filled
    const label = spineLabel(created);

    if (mode === 'another') {
      // keep topic and status for a run of similar books
      setValues({ ...EMPTY, topic: values.topic, status: values.status });
      setErrors({});
      setLastAdded(label);
      requestAnimationFrame(() => authorRef.current?.focus());
      return;
    }
    // the provider confirms with a toast; show the new entry
    onOpenChange(false);
    setValues(EMPTY);
    setErrors({});
    setLastAdded(null);
    openBook(created.id);
  };

  if (!isOwner) return null;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t('book.add.title')}
      description={t('book.add.description')}
      icon={<BookPlus />}
      size="md"
      closeOnOverlayClick={!submitting}
      initialFocusRef={authorRef}
      footer={
        <>
          <Button onClick={close} disabled={Boolean(submitting)} className="max-sm:hidden">
            {t('common.action.cancel')}
          </Button>
          <Button
            onClick={() => void submit('another')}
            loading={submitting === 'another'}
            disabled={submitting === 'open'}
          >
            {t('book.add.submitAnother')}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            leftIcon={<BookPlus />}
            loading={submitting === 'open'}
            disabled={submitting === 'another'}
          >
            {t('common.action.add')}
          </Button>
        </>
      }
    >
      <form id={formId} noValidate onSubmit={(e) => void submit('open', e)} className="flex flex-col gap-4 pt-1">
        {lastAdded ? (
          <p role="status" className="flex items-center gap-2 rounded-lg bg-[color-mix(in_oklab,var(--success)_10%,var(--surface))] px-3 py-2 text-sm text-success">
            <CopyCheck className="size-4 shrink-0" aria-hidden="true" />
            <span className="min-w-0 [overflow-wrap:anywhere]">{t('book.add.addedAnother', { title: lastAdded })}</span>
          </p>
        ) : null}

        <Field id={`${formId}-author`} label={t('book.form.author')} hint={t('book.form.authorHint')} error={errorText(errors.author)}>
          <Input ref={authorRef} value={values.author} autoComplete="off" onChange={(e) => update('author', e.target.value)} />
        </Field>
        <Field id={`${formId}-title`} label={t('book.form.title')} required error={errorText(errors.title)}>
          <Input value={values.title} autoComplete="off" onChange={(e) => update('title', e.target.value)} />
        </Field>

        {duplicates.length > 0 ? (
          <div
            role="status"
            aria-live="polite"
            className="rounded-lg border border-[color-mix(in_oklab,var(--warning)_40%,transparent)] bg-[color-mix(in_oklab,var(--warning)_10%,var(--surface))] px-3 py-2.5 text-sm"
          >
            <p className="font-medium text-ink">
              {duplicates[0].kind === 'exact' ? t('book.add.duplicate.exact') : t('book.add.duplicate.similar')}
            </p>
            <ul className="mt-1.5 flex flex-col gap-1">
              {duplicates.map((m) => (
                <li key={m.book.id} className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate text-ink" title={spineLabel(m.book)}>
                    {spineLabel(m.book)}
                    {m.book.firstPublishedYear ? <span className="text-muted"> ({m.book.firstPublishedYear})</span> : null}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    rightIcon={<ExternalLink />}
                    onClick={() => {
                      close();
                      openBook(m.book.id);
                    }}
                  >
                    {t('book.add.duplicate.open')}
                  </Button>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs text-muted">{t('book.add.duplicate.hint')}</p>
          </div>
        ) : null}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field id={`${formId}-year`} label={t('book.add.year')} error={errorText(errors.year)}>
            <Input value={values.year} inputMode="numeric" maxLength={6} autoComplete="off" onChange={(e) => update('year', e.target.value)} />
          </Field>
          <Field id={`${formId}-topic`} label={t('book.add.topic')} className="sm:col-span-2">
            <Select value={values.topic} onChange={(e) => update('topic', e.target.value)}>
              <option value="">{t('book.add.topicNone')}</option>
              <TopicOptionGroups locale={locale} />
            </Select>
          </Field>
        </div>
        <Field id={`${formId}-status`} label={t('common.status.label')}>
          <Select
            value={values.status}
            onChange={(e) => update('status', e.target.value as ReadingStatus)}
            options={READING_STATUSES.map((status) => ({ value: status, label: t(READING_STATUS_META[status].labelKey) }))}
          />
        </Field>
      </form>
    </Dialog>
  );
}
