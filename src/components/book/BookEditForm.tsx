'use client';

import { CircleAlert } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState, type FormEvent } from 'react';
import { TopicChip } from '@/components/books';
import { useCollection } from '@/components/collection/context';
import { Button, Field, Input, Select, useToast, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import type { Translator } from '@/i18n';
import { collator, languageName } from '@/lib/book-utils';
import { TOPICS, TOPIC_GROUP_LABELS, type TopicDef } from '@/lib/taxonomy';
import type { BookDTO, Locale } from '@/lib/types';
import {
  BOOK_LIMITS,
  COMMON_LANGUAGE_CODES,
  bookToFormValues,
  diffBookPatch,
  isFormDirty,
  rebaseFormValues,
  validateBookForm,
  type BookFormError,
  type BookFormErrors,
  type BookFormField,
  type BookFormValues,
} from './book-form-utils';

export interface BookEditFormProps {
  book: BookDTO;
  onCancel: () => void;
  /** called with the saved book (or the unchanged book when nothing was modified) */
  onSaved?: (book: BookDTO) => void;
  /** reports unsaved edits (the drawer asks before discarding them) */
  onDirtyChange?: (dirty: boolean) => void;
  className?: string;
}

const OTHER_LANGUAGE = '__other';
const GROUPS: TopicDef['group'][] = ['fiction', 'nonfiction', 'arts', 'young', 'reference'];

/** Localised message for a form validation error (`n` formats counts – years stay unformatted). */
export function formErrorMessage(t: Translator['t'], error: BookFormError | undefined, n: Translator['n'] = String): string | undefined {
  if (!error) return undefined;
  switch (error.code) {
    case 'required':
      return t('book.form.error.required');
    case 'tooLong':
      return t('book.form.error.tooLong', { max: n(error.max) });
    case 'yearNumber':
      return t('book.form.error.yearNumber');
    case 'yearRange':
      return t('book.form.error.yearRange', { min: error.min, max: error.max });
    case 'pagesNumber':
      return t('book.form.error.pagesNumber');
    case 'pagesRange':
      return t('book.form.error.pagesRange', { min: n(error.min), max: n(error.max) });
    case 'isbnChars':
      return t('book.form.error.isbnChars');
    case 'isbnLength':
      return t('book.form.error.isbnLength');
    case 'isbnChecksum':
      return t('book.form.error.isbnChecksum');
    case 'languageCode':
      return t('book.form.error.languageCode');
    case 'tagsTooMany':
      return t('book.form.error.tagsTooMany', { max: error.max });
    case 'tagTooLong':
      return t('book.form.error.tagTooLong', { max: error.max });
    case 'topicsTooMany':
      return t('book.form.error.topicsTooMany', { max: error.max });
  }
}

/** Language select options: Hungarian and English first, then the rest by localised name. */
export function languageOptions(locale: Locale, t: Translator['t'], current?: string | null) {
  const c = collator(locale);
  const rest = COMMON_LANGUAGE_CODES.filter((code) => code !== 'hu' && code !== 'en').sort((a, b) =>
    c.compare(languageName(a, locale), languageName(b, locale)),
  );
  const codes: string[] = ['hu', 'en', ...rest];
  if (current && !codes.includes(current)) codes.push(current);
  return [
    { value: '', label: t('book.form.languageNone') },
    ...codes.map((code) => ({ value: code, label: languageName(code, locale) || code })),
  ];
}

/** Grouped taxonomy <optgroup>s for a category select. */
export function TopicOptionGroups({ locale }: { locale: Locale }) {
  return (
    <>
      {GROUPS.map((group) => (
        <optgroup key={group} label={TOPIC_GROUP_LABELS[group][locale]}>
          {TOPICS.filter((topic) => topic.group === group).map((topic) => (
            <option key={topic.key} value={topic.key}>
              {topic[locale]}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
}

/** Full bibliographic edit form (owner). Save → updateBook with only the changed fields. */
export function BookEditForm({ book, onCancel, onSaved, onDirtyChange, className }: BookEditFormProps) {
  const { t, n, locale } = useI18n();
  const errorText = (error: BookFormError | undefined) => formErrorMessage(t, error, n);
  const { updateBook } = useCollection();
  const { toast } = useToast();
  const formId = useId();
  const fieldId = (field: BookFormField) => `${formId}-${field}`;

  const [values, setValues] = useState<BookFormValues>(() => bookToFormValues(book));
  // server-side changes while editing: untouched fields follow them, the user's edits stay
  const [baseBook, setBaseBook] = useState(book);
  if (baseBook !== book) {
    setBaseBook(book);
    const rebased = rebaseFormValues(baseBook, book, values);
    if (rebased !== values) setValues(rebased);
  }
  const [languageMode, setLanguageMode] = useState<'list' | 'other'>(() =>
    book.language && !(COMMON_LANGUAGE_CODES as readonly string[]).includes(book.language) ? 'other' : 'list',
  );
  const [errors, setErrors] = useState<BookFormErrors>({});
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const summaryRef = useRef<HTMLParagraphElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  // opened by an explicit "Edit": start typing in the title (the button that had focus is gone)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active && active !== document.body && active.closest('form') === titleRef.current?.form) return;
      titleRef.current?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(id);
  }, []);

  const dirty = useMemo(() => isFormDirty(book, values), [book, values]);
  const onDirtyRef = useRef(onDirtyChange);
  onDirtyRef.current = onDirtyChange;
  useEffect(() => {
    onDirtyRef.current?.(dirty);
  }, [dirty]);
  useEffect(() => () => onDirtyRef.current?.(false), []);

  const languageSelectOptions = useMemo(() => languageOptions(locale, t), [locale, t]);

  const update = <K extends BookFormField>(field: K, value: BookFormValues[K]) => {
    const next = { ...values, [field]: value };
    setValues(next);
    // report right away (not only after the render): an Esc pressed a moment later must already ask
    onDirtyRef.current?.(isFormDirty(book, next));
    // after a failed submit, errors follow the input live
    if (submitted) setErrors(validateBookForm(next).errors);
  };

  const validateField = (field: BookFormField) => {
    const fieldError = validateBookForm(values).errors[field];
    setErrors((prev) => {
      if (prev[field] === fieldError) return prev;
      const next = { ...prev };
      if (fieldError) next[field] = fieldError;
      else delete next[field];
      return next;
    });
  };

  const onSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    setSubmitted(true);
    const { errors: found, parsed } = validateBookForm(values);
    setErrors(found);
    if (!parsed) {
      const order: BookFormField[] = [
        'title',
        'subtitle',
        'author',
        'originalTitle',
        'series',
        'publisher',
        'language',
        'firstPublishedYear',
        'editionYear',
        'isbn',
        'pageCount',
        'category',
        'topics',
        'tags',
      ];
      const first = order.find((f) => found[f]);
      requestAnimationFrame(() => {
        const el = first ? document.getElementById(fieldId(first)) : null;
        (el ?? summaryRef.current)?.focus();
      });
      return;
    }
    const patch = diffBookPatch(book, parsed);
    if (Object.keys(patch).length === 0) {
      onSaved?.(book);
      return;
    }
    setSaving(true);
    const saved = await updateBook(book.id, patch);
    setSaving(false);
    if (!saved) return; // the provider rolled back and showed the error
    onDirtyRef.current?.(false);
    toast({ title: t('book.toast.saved'), tone: 'success' });
    onSaved?.(saved);
  };

  const topicsAtMax = values.topics.length >= BOOK_LIMITS.topics;
  const toggleTopic = (key: string, on: boolean) => {
    update('topics', on ? [...values.topics.filter((k) => k !== key), key] : values.topics.filter((k) => k !== key));
  };

  const errorCount = Object.keys(errors).length;
  const sectionTitle = 'mb-3 font-sans text-xs font-semibold tracking-[0.08em] text-muted uppercase';

  return (
    <form
      noValidate
      aria-label={t('book.form.label')}
      onSubmit={(e) => void onSubmit(e)}
      className={cn('flex flex-col gap-6', className)}
    >
      {submitted && errorCount > 0 ? (
        <p
          ref={summaryRef}
          tabIndex={-1}
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-[color-mix(in_oklab,var(--danger)_30%,transparent)] bg-[color-mix(in_oklab,var(--danger)_8%,var(--surface))] px-3 py-2 text-sm text-danger outline-none"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t('book.form.errorSummary')}
        </p>
      ) : null}

      <section aria-labelledby={`${formId}-basics`}>
        <h3 id={`${formId}-basics`} className={sectionTitle}>
          {t('book.form.section.basics')}
        </h3>
        <div className="grid gap-4">
          <Field id={fieldId('title')} label={t('book.form.title')} required error={errorText(errors.title)}>
            <Input
              ref={titleRef}
              value={values.title}
              maxLength={BOOK_LIMITS.title + 50}
              autoComplete="off"
              data-autofocus
              onChange={(e) => update('title', e.target.value)}
              onBlur={() => validateField('title')}
            />
          </Field>
          <Field id={fieldId('subtitle')} label={t('book.form.subtitle')} error={errorText(errors.subtitle)}>
            <Input value={values.subtitle} autoComplete="off" onChange={(e) => update('subtitle', e.target.value)} onBlur={() => validateField('subtitle')} />
          </Field>
          <Field
            id={fieldId('author')}
            label={t('book.form.author')}
            hint={t('book.form.authorHint')}
            error={errorText(errors.author)}
          >
            <Input value={values.author} autoComplete="off" onChange={(e) => update('author', e.target.value)} onBlur={() => validateField('author')} />
          </Field>
          <Field id={fieldId('originalTitle')} label={t('book.form.originalTitle')} error={errorText(errors.originalTitle)}>
            <Input
              value={values.originalTitle}
              autoComplete="off"
              onChange={(e) => update('originalTitle', e.target.value)}
              onBlur={() => validateField('originalTitle')}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id={fieldId('series')} label={t('book.form.series')} error={errorText(errors.series)}>
              <Input value={values.series} autoComplete="off" onChange={(e) => update('series', e.target.value)} onBlur={() => validateField('series')} />
            </Field>
            <Field id={fieldId('publisher')} label={t('book.form.publisher')} error={errorText(errors.publisher)}>
              <Input
                value={values.publisher}
                autoComplete="off"
                onChange={(e) => update('publisher', e.target.value)}
                onBlur={() => validateField('publisher')}
              />
            </Field>
          </div>
        </div>
      </section>

      <section aria-labelledby={`${formId}-publication`}>
        <h3 id={`${formId}-publication`} className={sectionTitle}>
          {t('book.form.section.publication')}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            id={languageMode === 'other' ? `${fieldId('language')}-list` : fieldId('language')}
            label={t('book.form.language')}
            error={languageMode === 'list' ? errorText(errors.language) : undefined}
          >
            <Select
              value={languageMode === 'other' ? OTHER_LANGUAGE : values.language}
              onChange={(e) => {
                if (e.target.value === OTHER_LANGUAGE) {
                  setLanguageMode('other');
                  update('language', '');
                  requestAnimationFrame(() => document.getElementById(fieldId('language'))?.focus());
                } else {
                  setLanguageMode('list');
                  update('language', e.target.value);
                }
              }}
            >
              {languageSelectOptions.map((o) => (
                <option key={o.value || 'none'} value={o.value}>
                  {o.label}
                </option>
              ))}
              <option value={OTHER_LANGUAGE}>{t('book.form.languageOther')}</option>
            </Select>
          </Field>
          {languageMode === 'other' ? (
            <Field
              id={fieldId('language')}
              label={t('book.form.languageCode')}
              hint={t('book.form.languageCodeHint')}
              error={errorText(errors.language)}
            >
              <Input
                value={values.language}
                maxLength={3}
                autoCapitalize="none"
                autoComplete="off"
                spellCheck={false}
                onChange={(e) => update('language', e.target.value.toLowerCase().replace(/[^a-z]/g, ''))}
                onBlur={() => validateField('language')}
              />
            </Field>
          ) : (
            <Field id={fieldId('pageCount')} label={t('book.form.pageCount')} error={errorText(errors.pageCount)}>
              <Input
                value={values.pageCount}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => update('pageCount', e.target.value)}
                onBlur={() => validateField('pageCount')}
              />
            </Field>
          )}
          <Field id={fieldId('firstPublishedYear')} label={t('book.form.firstPublishedYear')} error={errorText(errors.firstPublishedYear)}>
            <Input
              value={values.firstPublishedYear}
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              placeholder="1968"
              onChange={(e) => update('firstPublishedYear', e.target.value)}
              onBlur={() => validateField('firstPublishedYear')}
            />
          </Field>
          <Field id={fieldId('editionYear')} label={t('book.form.editionYear')} error={errorText(errors.editionYear)}>
            <Input
              value={values.editionYear}
              inputMode="numeric"
              maxLength={6}
              autoComplete="off"
              onChange={(e) => update('editionYear', e.target.value)}
              onBlur={() => validateField('editionYear')}
            />
          </Field>
          <Field
            id={fieldId('isbn')}
            label={t('book.form.isbn')}
            hint={t('book.form.isbnHint')}
            error={errorText(errors.isbn)}
            className={languageMode === 'other' ? undefined : 'sm:col-span-2'}
          >
            <Input
              value={values.isbn}
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              maxLength={32}
              placeholder="978-963-…"
              onChange={(e) => update('isbn', e.target.value)}
              onBlur={() => validateField('isbn')}
            />
          </Field>
          {languageMode === 'other' ? (
            <Field id={fieldId('pageCount')} label={t('book.form.pageCount')} error={errorText(errors.pageCount)}>
              <Input
                value={values.pageCount}
                inputMode="numeric"
                autoComplete="off"
                onChange={(e) => update('pageCount', e.target.value)}
                onBlur={() => validateField('pageCount')}
              />
            </Field>
          ) : null}
        </div>
      </section>

      <section aria-labelledby={`${formId}-classification`}>
        <h3 id={`${formId}-classification`} className={sectionTitle}>
          {t('book.form.section.classification')}
        </h3>
        <div className="grid gap-4">
          <Field id={fieldId('category')} label={t('book.form.category')}>
            <Select value={values.category} onChange={(e) => update('category', e.target.value)}>
              <option value="">{t('book.form.categoryNone')}</option>
              <TopicOptionGroups locale={locale} />
            </Select>
          </Field>

          <div
            role="group"
            aria-labelledby={`${fieldId('topics')}-label`}
            aria-describedby={`${fieldId('topics')}-hint`}
            className="flex flex-col gap-1.5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span id={`${fieldId('topics')}-label`} className="text-sm font-medium text-ink">
                {t('book.form.topics')}
              </span>
              <span className="text-xs text-muted tabular-nums" aria-live="polite">
                {t('book.form.topicsSelected', { count: values.topics.length })}
              </span>
            </div>
            <div
              id={fieldId('topics')}
              tabIndex={-1}
              className="max-h-72 overflow-y-auto overscroll-contain rounded-[0.625rem] border border-line bg-surface-2/40 p-3 outline-none"
            >
              {GROUPS.map((group) => (
                <div key={group} className="mb-3 last:mb-0">
                  <p className="mb-1.5 text-[0.6875rem] font-semibold tracking-[0.06em] text-muted uppercase">{TOPIC_GROUP_LABELS[group][locale]}</p>
                  <div className="flex flex-wrap gap-1.5">
                    {TOPICS.filter((topic) => topic.group === group).map((topic) => {
                      const selected = values.topics.includes(topic.key);
                      return (
                        <TopicChip
                          key={topic.key}
                          topic={topic.key}
                          size="sm"
                          selected={selected}
                          disabled={!selected && topicsAtMax}
                          onSelectedChange={(on) => toggleTopic(topic.key, on)}
                        />
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
            {errors.topics ? (
              <p className="flex items-start gap-1.5 text-[0.8125rem] text-danger" role="alert">
                <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                {errorText(errors.topics)}
              </p>
            ) : null}
            <p id={`${fieldId('topics')}-hint`} className="text-[0.8125rem] leading-snug text-muted">
              {t('book.form.topicsHint', { max: BOOK_LIMITS.topics })}
            </p>
          </div>

          <Field id={fieldId('tags')} label={t('book.form.tags')} hint={t('book.form.tagsHint')} error={errorText(errors.tags)}>
            <Input value={values.tags} autoComplete="off" onChange={(e) => update('tags', e.target.value)} onBlur={() => validateField('tags')} />
          </Field>
        </div>
      </section>

      <div className="sticky -bottom-4 z-[1] -mx-5 -mb-4 flex flex-wrap items-center justify-end gap-2 border-t border-line/70 bg-surface/95 px-5 py-3 backdrop-blur-sm">
        <Button onClick={onCancel} disabled={saving}>
          {t('common.action.cancel')}
        </Button>
        <Button type="submit" variant="primary" loading={saving}>
          {t('common.action.save')}
        </Button>
      </div>
    </form>
  );
}
