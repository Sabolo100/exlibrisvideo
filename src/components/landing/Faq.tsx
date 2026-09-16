import { ChevronDown } from 'lucide-react';
import type { MessageKey } from '@/i18n';
import { getServerT } from '@/i18n/server';
import { uploadLimitVars } from '@/components/upload/limits';
import { serverUploadLimits } from '@/components/upload/server-limits';
import { faqJsonLd, FAQ_ITEMS } from './faq-items';
import { SectionHeading } from './SectionHeading';

/** FAQ accordion built on native <details> (keyboard and screen-reader friendly, works without JS) + FAQPage JSON-LD. */
export async function Faq() {
  const tr = await getServerT();
  // answers may quote the upload limits ({maxFiles} …)
  const vars = uploadLimitVars(serverUploadLimits(), tr);
  const t = (key: MessageKey) => tr.t(key, vars);

  return (
    <section id="faq" aria-labelledby="landing-faq-title" className="scroll-mt-20 border-y border-line/70 bg-surface-2/40">
      <div className="mx-auto max-w-3xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="landing-faq-title" eyebrow={t('landing.faq.eyebrow')} title={t('landing.faq.title')} />
        <div className="mt-10 flex flex-col gap-3">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.id}
              id={`faq-${item.id}`}
              className="group scroll-mt-24 rounded-card border border-line bg-surface shadow-soft open:shadow-lift"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded-card px-5 py-4 text-left font-display text-lg leading-snug font-semibold text-ink select-none hover:text-primary [&::-webkit-details-marker]:hidden">
                <span>{t(item.q)}</span>
                <ChevronDown
                  aria-hidden="true"
                  className="size-5 shrink-0 text-accent transition-transform duration-200 group-open:rotate-180"
                />
              </summary>
              <div className="px-5 pb-5 text-[0.9375rem] leading-relaxed text-muted text-pretty">
                <p>{t(item.a)}</p>
              </div>
            </details>
          ))}
        </div>
      </div>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: faqJsonLd(t) }} />
    </section>
  );
}
