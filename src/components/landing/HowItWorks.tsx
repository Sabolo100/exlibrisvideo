import { LibraryBig, Smartphone, UploadCloud } from 'lucide-react';
import type { ReactNode } from 'react';
import { getServerT } from '@/i18n/server';
import { SectionHeading } from './SectionHeading';

/** Three steps: film → upload → browse. */
export async function HowItWorks() {
  const { t, n } = await getServerT();
  const steps: { icon: ReactNode; title: string; text: string }[] = [
    { icon: <Smartphone />, title: t('landing.how.step1.title'), text: t('landing.how.step1.text') },
    { icon: <UploadCloud />, title: t('landing.how.step2.title'), text: t('landing.how.step2.text') },
    { icon: <LibraryBig />, title: t('landing.how.step3.title'), text: t('landing.how.step3.text') },
  ];

  return (
    <section id="how-it-works" aria-labelledby="landing-how-title" className="scroll-mt-20 border-y border-line/70 bg-surface-2/40">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="landing-how-title" eyebrow={t('landing.how.eyebrow')} title={t('landing.how.title')} />
        <ol className="mt-10 grid gap-5 sm:mt-12 md:grid-cols-3 md:gap-6">
          {steps.map((step, i) => (
            <li key={step.title} className="relative flex flex-col gap-3 rounded-card border border-line bg-surface p-5 shadow-soft sm:p-6">
              <div className="flex items-center justify-between gap-3">
                <span
                  aria-hidden="true"
                  className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-ink shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] [&_svg]:size-6"
                >
                  {step.icon}
                </span>
                <span aria-hidden="true" className="font-display text-5xl leading-none font-semibold text-accent/35 tabular-nums">
                  {n(i + 1)}
                </span>
              </div>
              <h3 className="font-display text-xl leading-snug font-semibold text-ink">
                <span className="sr-only">{t('landing.how.step', { n: i + 1 })}: </span>
                {step.title}
              </h3>
              <p className="text-[0.9375rem] leading-relaxed text-muted text-pretty">{step.text}</p>
              {i < steps.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="absolute top-1/2 -right-4 hidden h-px w-6 bg-[linear-gradient(90deg,var(--accent),transparent)] md:block"
                />
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
