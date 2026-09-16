import { ArrowRight, BookOpen, Gift, UserX } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { Button } from '@/components/ui/Button';
import { serverUploadLimits } from '@/components/upload/server-limits';
import { Uploader } from '@/components/upload/Uploader';
import { HeroShelf } from './HeroShelf';

/** Landing hero: Fraunces headline, one-sentence promise, the uploader itself (#upload) and the animated bookshelf. */
export async function Hero({ demoCollectionId }: { demoCollectionId?: string | null }) {
  const { t } = await getServerT();
  // the real limits in the first paint (the uploader would otherwise ask GET /api/config)
  const uploadLimits = serverUploadLimits();
  // phones first: the record button should be visible without scrolling, so the copy is shorter there
  const points = [
    { icon: <Gift aria-hidden="true" />, label: t('landing.hero.point.free'), className: '' },
    { icon: <UserX aria-hidden="true" />, label: t('landing.hero.point.noSignup'), className: '' },
    { icon: <BookOpen aria-hidden="true" />, label: t('landing.hero.point.languages'), className: 'max-sm:hidden' },
  ];

  return (
    <section aria-labelledby="landing-hero-title" className="relative overflow-hidden">
      {/* soft lamp light behind the hero */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(60%_55%_at_70%_30%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_70%)]"
      />
      <div className="relative mx-auto grid max-w-6xl gap-10 px-4 pt-5 pb-14 sm:px-6 sm:pt-12 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start lg:gap-12 lg:pt-16 lg:pb-20">
        <div className="flex min-w-0 flex-col gap-3.5 sm:gap-5">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/35 bg-accent-soft/70 px-3 py-1 text-xs font-semibold tracking-wide text-ink">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            {t('landing.hero.eyebrow')}
          </p>
          <h1
            id="landing-hero-title"
            className="font-display text-[1.875rem] leading-[1.1] font-semibold tracking-tight text-ink text-balance sm:text-5xl sm:leading-[1.08] lg:text-[3.4rem]"
          >
            {t('landing.hero.title')}
          </h1>
          <p className="max-w-xl text-lg leading-relaxed text-muted text-pretty max-sm:hidden">{t('landing.hero.lead')}</p>
          <p className="text-[0.9375rem] leading-relaxed text-muted text-pretty sm:hidden">{t('landing.hero.leadShort')}</p>
          <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-ink">
            {points.map((p) => (
              <li key={p.label} className={`inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:text-accent ${p.className}`}>
                {p.icon}
                {p.label}
              </li>
            ))}
          </ul>

          <div id="upload" className="mt-1 scroll-mt-24">
            <Uploader variant="hero" limits={uploadLimits} />
          </div>

          {demoCollectionId ? (
            <Button href={`/${demoCollectionId}`} variant="ghost" rightIcon={<ArrowRight />} className="w-fit">
              {t('landing.hero.demo')}
            </Button>
          ) : null}
        </div>

        <div className="min-w-0 lg:sticky lg:top-24 lg:pt-6">
          <HeroShelf />
        </div>
      </div>
    </section>
  );
}
