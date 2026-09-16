import { ArrowUp, Mail, PencilLine } from 'lucide-react';
import Link from 'next/link';
import type { MessageKey, Vars } from '@/i18n';
import { getServerT } from '@/i18n/server';
import { Ornament } from '@/components/site/SiteFooter';

/** Public contact address (same as the site footer). */
export const CONTACT_EMAIL = 'hello@exlibrisvideo.hu';

export type LegalBlock =
  | { type: 'p'; text: MessageKey }
  | { type: 'ul'; items: MessageKey[] }
  /** operator details the site owner still has to fill in – rendered clearly marked */
  | { type: 'placeholder'; text: MessageKey }
  | { type: 'contact' };

export interface LegalSection {
  id: string;
  title: MessageKey;
  blocks: LegalBlock[];
}

export interface LegalDocumentProps {
  title: MessageKey;
  intro: MessageKey;
  updated: MessageKey;
  sections: LegalSection[];
  related: { href: string; label: MessageKey };
  /** placeholder values available to every text of the document (e.g. the upload limits) */
  vars?: Vars;
}

/** Plain-language legal page: title, intro, effective date, table of contents and numbered sections. */
export async function LegalDocument({ title, intro, updated, sections, related, vars }: LegalDocumentProps) {
  const tr = await getServerT();
  const t = (key: MessageKey) => tr.t(key, vars);

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-10 sm:px-6 sm:py-14" aria-labelledby="legal-title">
      <header id="top" className="scroll-mt-24">
        <h1 id="legal-title" className="font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-[2.6rem]">
          {t(title)}
        </h1>
        <p className="mt-2 text-sm font-medium text-accent">{t(updated)}</p>
        <p className="mt-5 text-lg leading-relaxed text-ink text-pretty">{t(intro)}</p>
      </header>

      <nav aria-labelledby="legal-toc" className="mt-8 rounded-card border border-line bg-surface-2/50 p-5">
        <h2 id="legal-toc" className="font-sans text-xs font-semibold tracking-[0.16em] text-muted uppercase">
          {t('legal.toc')}
        </h2>
        <ol className="mt-3 grid gap-x-6 gap-y-1.5 text-[0.9375rem] sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a href={`#${s.id}`} className="rounded-sm text-ink underline-offset-4 hover:text-primary hover:underline hover:decoration-accent/60">
                {t(s.title)}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="mt-10 flex flex-col gap-10">
        {sections.map((s) => (
          <section key={s.id} id={s.id} aria-labelledby={`${s.id}-title`} className="scroll-mt-24">
            <h2 id={`${s.id}-title`} className="font-display text-2xl leading-snug font-semibold text-ink text-balance">
              {t(s.title)}
            </h2>
            <div className="mt-3 flex flex-col gap-3 text-base leading-relaxed text-ink/90">
              {s.blocks.map((block, i) => {
                switch (block.type) {
                  case 'p':
                    return (
                      <p key={i} className="text-pretty">
                        {t(block.text)}
                      </p>
                    );
                  case 'ul':
                    return (
                      <ul key={i} className="flex list-disc flex-col gap-1.5 pl-6 marker:text-accent">
                        {block.items.map((item) => (
                          <li key={item} className="pl-1 text-pretty">
                            {t(item)}
                          </li>
                        ))}
                      </ul>
                    );
                  case 'placeholder':
                    return (
                      <p
                        key={i}
                        className="flex items-start gap-2.5 rounded-lg border-2 border-dashed border-accent/60 bg-accent-soft/60 px-4 py-3 font-medium text-ink"
                      >
                        <PencilLine aria-hidden="true" className="mt-1 size-4 shrink-0 text-accent" />
                        <span>
                          <span className="sr-only">{t('legal.placeholder')}: </span>
                          {t(block.text)}
                        </span>
                      </p>
                    );
                  case 'contact':
                    return (
                      <p key={i}>
                        <a
                          href={`mailto:${CONTACT_EMAIL}`}
                          className="inline-flex items-center gap-2 rounded-sm font-semibold text-primary underline decoration-accent/60 underline-offset-4 hover:decoration-accent"
                        >
                          <Mail aria-hidden="true" className="size-4" />
                          <span className="sr-only">{t('legal.contact.label')}: </span>
                          {CONTACT_EMAIL}
                        </a>
                      </p>
                    );
                }
              })}
            </div>
          </section>
        ))}
      </div>

      <footer className="mt-14 flex flex-col items-center gap-4 border-t border-line/70 pt-8 text-center">
        <Ornament />
        <p className="text-sm text-muted">
          {t('legal.related.title')}:{' '}
          <Link href={related.href} className="font-medium text-ink underline decoration-accent/60 underline-offset-4 hover:text-primary">
            {t(related.label)}
          </Link>
        </p>
        <a href="#top" className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted hover:text-ink">
          <ArrowUp aria-hidden="true" className="size-4" />
          {t('legal.backToTop')}
        </a>
      </footer>
    </article>
  );
}
