'use client';

/**
 * Owner: add one new book from a photo – of its ISBN barcode, its spine or its front cover. The photo is
 * recognised on the server (barcode → book databases, spine / cover → AI reading), the owner checks the
 * fields, tags it, and adds it – or, when the library already has it, counts one more copy.
 */
import { BookImage, BookOpenText, Camera, Check, CopyPlus, Plus, RotateCcw, ScanBarcode, TriangleAlert } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useCollection } from '@/components/collection/context';
import { TagPicker } from '@/components/tags/TagPicker';
import { addTag, tagSuggestions } from '@/components/tags/tag-utils';
import { Button, Dialog, Field, Input, Spinner, cn, useToast } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { api } from '@/lib/client/api';
import { preparePhoto } from '@/lib/client/book-photo';
import type { BookDTO, BookPhotoKind, IdentifyBookResponse } from '@/lib/types';
import { cleanText, findDuplicates, parseOptionalInt } from './book-form-utils';

type Step =
  | { kind: 'choose' }
  | { kind: 'working'; mode: BookPhotoKind; preview: string }
  | { kind: 'confirm'; mode: BookPhotoKind; preview: string | null; result: IdentifyBookResponse | null };

interface Values {
  title: string;
  author: string;
  publisher: string;
  year: string;
}

const MODES: { mode: BookPhotoKind; icon: ReactNode; title: 'book.photo.mode.isbn' | 'book.photo.mode.spine' | 'book.photo.mode.cover'; hint: 'book.photo.mode.isbnHint' | 'book.photo.mode.spineHint' | 'book.photo.mode.coverHint' }[] = [
  { mode: 'isbn', icon: <ScanBarcode />, title: 'book.photo.mode.isbn', hint: 'book.photo.mode.isbnHint' },
  { mode: 'cover', icon: <BookImage />, title: 'book.photo.mode.cover', hint: 'book.photo.mode.coverHint' },
  { mode: 'spine', icon: <BookOpenText />, title: 'book.photo.mode.spine', hint: 'book.photo.mode.spineHint' },
];

export function AddBookPhotoDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t, tp } = useI18n();
  const { toast } = useToast();
  const { collection, books, addBook, updateBook, openBook, refresh } = useCollection();
  const inputRef = useRef<HTMLInputElement>(null);
  const pendingMode = useRef<BookPhotoKind>('isbn');
  const [step, setStep] = useState<Step>({ kind: 'choose' });
  const [values, setValues] = useState<Values>({ title: '', author: '', publisher: '', year: '' });
  const [tags, setTags] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | 'add' | 'copy'>(null);
  const [titleError, setTitleError] = useState(false);
  const [added, setAdded] = useState<string | null>(null);
  const urls = useRef<string[]>([]);

  const suggestions = useMemo(() => tagSuggestions(books, collection.videos), [books, collection.videos]);

  // object URLs of the previews live until the dialog closes
  useEffect(() => {
    if (open) return;
    for (const u of urls.current) URL.revokeObjectURL(u);
    urls.current = [];
  }, [open]);

  const reset = () => {
    setStep({ kind: 'choose' });
    setValues({ title: '', author: '', publisher: '', year: '' });
    setTitleError(false);
    setBusy(null);
  };
  const close = () => {
    if (busy) return;
    onOpenChange(false);
    reset();
    setAdded(null);
    setTags([]);
  };

  const pick = (mode: BookPhotoKind) => {
    pendingMode.current = mode;
    inputRef.current?.click();
  };

  const onFile = async (file: File) => {
    const mode = pendingMode.current;
    setAdded(null);
    const prepared = await preparePhoto(file, { barcode: mode === 'isbn' });
    urls.current.push(prepared.url);
    setStep({ kind: 'working', mode, preview: prepared.url });
    let result: IdentifyBookResponse | null = null;
    try {
      result = await api.identifyPhoto(collection.id, {
        kind: mode,
        // a barcode read on the phone needs no upload
        photo: mode === 'isbn' && prepared.barcode ? null : prepared.jpeg,
        isbn: prepared.barcode,
      });
    } catch {
      toast({ title: t('book.photo.failed'), tone: 'error' });
    }
    const c = result?.candidate;
    setValues({
      title: c?.title ?? '',
      author: c?.author ?? '',
      publisher: c?.publisher ?? '',
      year: c?.editionYear ? String(c.editionYear) : '',
    });
    setStep({ kind: 'confirm', mode, preview: mode === 'isbn' ? (c?.coverUrl ?? prepared.url) : prepared.url, result });
  };

  const confirm = step.kind === 'confirm' ? step : null;
  const isbn = confirm?.result?.candidate.isbn ?? null;
  const duplicates = useMemo(() => {
    if (!confirm) return [];
    const byIsbn = isbn ? books.filter((b) => b.isbn && b.isbn.replace(/[^0-9X]/gi, '') === isbn) : [];
    const byTitle = findDuplicates(books, { title: values.title, author: values.author }, { limit: 3 }).map((m) => m.book);
    const seen = new Set<string>();
    return [...byIsbn, ...byTitle].filter((b) => !seen.has(b.id) && seen.add(b.id)).slice(0, 3);
  }, [confirm, isbn, books, values.title, values.author]);

  const finish = (book: BookDTO, message?: string) => {
    setAdded(message ?? t('book.photo.addedNext', { title: book.title }));
    reset();
    // an empty library turns into a catalogue: load it
    if (collection.status === 'draft') void refresh();
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!confirm || busy) return;
    const title = cleanText(values.title);
    if (!title) {
      setTitleError(true);
      return;
    }
    setBusy('add');
    const c = confirm.result?.candidate;
    const year = parseOptionalInt(values.year, 1000, 2100).value;
    const created = await addBook({
      title,
      author: cleanText(values.author),
      publisher: cleanText(values.publisher),
      subtitle: c?.subtitle ?? null,
      isbn: c?.isbn ?? null,
      pageCount: c?.pageCount ?? null,
      language: c?.language ?? null,
      editionYear: year,
      tags,
      // the photo (spine / cover) goes to the book; any photo book is enriched like the recognised ones
      photo: { token: confirm.result?.photoToken ?? '', kind: confirm.mode },
    });
    setBusy(null);
    if (created) finish(created);
  };

  const addCopy = async (book: BookDTO) => {
    if (busy) return;
    setBusy('copy');
    let merged = book.tags;
    for (const tag of tags) merged = addTag(merged, tag);
    const updated = await updateBook(book.id, { copies: Math.min(99, book.copies + 1), ...(merged !== book.tags ? { tags: merged } : {}) });
    setBusy(null);
    if (updated) finish(updated, t('book.photo.copyAdded', { title: updated.title, count: updated.copies }));
  };

  const title =
    step.kind === 'choose' ? t('book.photo.title') : step.kind === 'working' ? t('book.photo.working') : t('book.photo.confirmTitle');

  return (
    <Dialog
      open={open}
      onClose={close}
      size="md"
      icon={<Camera />}
      title={title}
      description={step.kind === 'choose' ? t('book.photo.description') : undefined}
      footer={
        confirm ? (
          <>
            <Button variant="ghost" leftIcon={<RotateCcw />} onClick={reset} disabled={!!busy}>
              {t('book.photo.again')}
            </Button>
            <Button variant="primary" leftIcon={<Plus />} loading={busy === 'add'} disabled={!!busy} onClick={() => void submit()}>
              {duplicates.length ? t('book.photo.addSeparately') : t('book.photo.add')}
            </Button>
          </>
        ) : (
          <Button variant="ghost" onClick={close}>
            {added ? t('book.photo.done') : t('common.action.cancel')}
          </Button>
        )
      }
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          e.currentTarget.value = '';
          if (file) void onFile(file);
        }}
      />

      {step.kind === 'choose' ? (
        <div className="flex flex-col gap-3">
          {added ? (
            <p role="status" className="flex items-center gap-2 rounded-lg bg-success/10 px-3 py-2 text-sm font-medium text-ink">
              <Check aria-hidden="true" className="size-4 text-success" />
              {added}
            </p>
          ) : null}
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <button
                key={m.mode}
                type="button"
                onClick={() => pick(m.mode)}
                className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-colors hover:border-accent/60 hover:bg-surface-2 active:scale-[0.99] sm:flex-col sm:items-start"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-accent-soft text-accent [&_svg]:size-6">{m.icon}</span>
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{t(m.title)}</span>
                  <span className="block text-xs leading-snug text-muted">{t(m.hint)}</span>
                </span>
              </button>
            ))}
          </div>
          <p className="text-xs text-muted text-pretty">{t('book.photo.tip')}</p>
        </div>
      ) : null}

      {step.kind === 'working' ? (
        <div className="flex flex-col items-center gap-4 py-4" role="status">
          {/* eslint-disable-next-line @next/next/no-img-element -- local preview of the picked photo */}
          <img src={step.preview} alt="" className="max-h-56 rounded-xl object-contain shadow-soft" />
          <p className="flex items-center gap-2 text-sm text-muted">
            <Spinner size="sm" decorative />
            {step.mode === 'isbn' ? t('book.photo.readingBarcode') : t('book.photo.reading')}
          </p>
        </div>
      ) : null}

      {confirm ? (
        <form onSubmit={submit} className="flex flex-col gap-4">
          <div className="flex gap-4">
            {confirm.preview ? (
              // eslint-disable-next-line @next/next/no-img-element -- local photo / cover of the ISBN's edition
              <img src={confirm.preview} alt="" className="h-36 w-24 shrink-0 rounded-lg border border-line object-cover" />
            ) : null}
            <div className="min-w-0 flex-1 text-sm">
              <StatusLine result={confirm.result} mode={confirm.mode} />
              {isbn ? <p className="mt-1 font-mono text-xs text-muted">ISBN {isbn}</p> : null}
            </div>
          </div>

          {duplicates.length ? (
            <div className="rounded-xl border border-accent/45 bg-accent-soft/40 p-3">
              <p className="flex items-start gap-2 text-sm font-medium text-ink">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-accent" />
                {t('book.photo.duplicate')}
              </p>
              <ul className="mt-2 flex flex-col gap-2">
                {duplicates.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-2">
                    <button type="button" onClick={() => openBook(b.id)} className="min-w-0 flex-1 truncate text-left text-sm text-ink hover:underline">
                      <span className="font-semibold">{b.title}</span>
                      {b.author ? <span className="text-muted"> · {b.author}</span> : null}
                      <span className="text-muted"> · {tp('book.copies.count', b.copies)}</span>
                    </button>
                    <Button size="sm" variant="primary" leftIcon={<CopyPlus />} loading={busy === 'copy'} disabled={!!busy} onClick={() => void addCopy(b)}>
                      {t('book.photo.addCopy')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('book.form.title')} error={titleError ? t('book.photo.titleRequired') : undefined} className="sm:col-span-2">
              <Input
                value={values.title}
                onChange={(e) => {
                  setValues((v) => ({ ...v, title: e.target.value }));
                  setTitleError(false);
                }}
                autoComplete="off"
              />
            </Field>
            <Field label={t('book.form.author')} className="sm:col-span-2">
              <Input value={values.author} onChange={(e) => setValues((v) => ({ ...v, author: e.target.value }))} autoComplete="off" />
            </Field>
            <Field label={t('book.form.publisher')}>
              <Input value={values.publisher} onChange={(e) => setValues((v) => ({ ...v, publisher: e.target.value }))} autoComplete="off" />
            </Field>
            <Field label={t('book.form.editionYear')}>
              <Input value={values.year} inputMode="numeric" onChange={(e) => setValues((v) => ({ ...v, year: e.target.value }))} autoComplete="off" />
            </Field>
          </div>

          <TagPicker value={tags} onChange={setTags} suggestions={suggestions} hint={t('collection.tags.hintBook')} />
          {/* Enter in a field adds the book */}
          <button type="submit" className="sr-only" tabIndex={-1}>
            {t('book.photo.add')}
          </button>
        </form>
      ) : null}
    </Dialog>
  );
}

function StatusLine({ result, mode }: { result: IdentifyBookResponse | null; mode: BookPhotoKind }) {
  const { t } = useI18n();
  const tone = (ok: boolean) => cn('font-medium', ok ? 'text-ink' : 'text-danger');
  if (!result) return <p className={tone(false)}>{t('book.photo.failed')}</p>;
  if (result.notBook) return <p className={tone(false)}>{t('book.photo.notBook')}</p>;
  if (!result.found) {
    if (result.isbnUnknown) return <p className={tone(false)}>{t('book.photo.isbnUnknown')}</p>;
    return <p className={tone(false)}>{mode === 'isbn' ? t('book.photo.noBarcode') : t('book.photo.unreadable')}</p>;
  }
  return (
    <p className={tone(true)}>
      {result.via === 'barcode' || (result.via === 'lookup' && mode === 'isbn')
        ? t('book.photo.foundByIsbn')
        : result.candidate.confidence < 0.6
          ? t('book.photo.foundUnsure')
          : t('book.photo.found')}
    </p>
  );
}
