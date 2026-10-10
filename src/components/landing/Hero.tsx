import { ArrowRight, BookOpen, Gift, Smartphone, UserX } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { Button } from '@/components/ui/Button';
import { QrCode } from '@/components/ui/QrCode';
import { serverUploadLimits } from '@/components/upload/server-limits';
import { Uploader } from '@/components/upload/Uploader';
import { SignInCard } from '@/components/site/SignInCard';
import { env, googleAuthEnabled } from '@/lib/env';
import { HeroShelf } from './HeroShelf';

/**
 * Landing hero, one column from top to bottom: the headline, one long shelf being filmed, the Google
 * sign-in, then the recording – best on the phone (QR code), still possible from this computer.
 */
export async function Hero({ demoCollectionId }: { demoCollectionId?: string | null }) {
  const { t } = await getServerT();
  // the real limits in the first paint (the uploader would otherwise ask GET /api/config)
  const uploadLimits = serverUploadLimits();
  const siteUrl = env().APP_URL.replace(/\/$/, '');
  const siteHost = siteUrl.replace(/^https?:\/\//, '');
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
        className="pointer-events-none absolute inset-x-0 -top-40 h-[36rem] bg-[radial-gradient(60%_55%_at_50%_30%,color-mix(in_oklab,var(--accent)_16%,transparent),transparent_70%)]"
      />
      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 pt-6 pb-14 text-center sm:gap-10 sm:px-6 sm:pt-12 lg:pt-14 lg:pb-20">
        {/* 1 · the key message */}
        <div className="flex flex-col items-center gap-3.5 sm:gap-5">
          <p className="inline-flex w-fit items-center gap-2 rounded-full border border-accent/35 bg-accent-soft/70 px-3 py-1 text-xs font-semibold tracking-wide text-ink">
            <span aria-hidden="true" className="size-1.5 rounded-full bg-accent" />
            {t('landing.hero.eyebrow')}
          </p>
          <h1
            id="landing-hero-title"
            className="max-w-4xl font-display text-[1.875rem] leading-[1.1] font-semibold tracking-tight text-ink text-balance sm:text-5xl sm:leading-[1.08] lg:text-[3.6rem]"
          >
            {t('landing.hero.title')}
          </h1>
          <p className="max-w-2xl text-lg leading-relaxed text-muted text-pretty max-sm:hidden">{t('landing.hero.lead')}</p>
          <p className="max-w-md text-[0.9375rem] leading-relaxed text-muted text-pretty sm:hidden">{t('landing.hero.leadShort')}</p>
          <ul className="flex flex-wrap justify-center gap-x-5 gap-y-2 text-sm text-ink">
            {points.map((p) => (
              <li key={p.label} className={`inline-flex items-center gap-1.5 [&_svg]:size-4 [&_svg]:text-accent ${p.className}`}>
                {p.icon}
                {p.label}
              </li>
            ))}
          </ul>
        </div>

        {/* 2 · one long shelf being filmed */}
        <HeroShelf wide className="mt-2" />

        {/* 3 · sign in (recommended) */}
        {googleAuthEnabled() ? <SignInCard className="mt-4 w-full max-w-xl text-left" /> : null}

        {/* 4 · the recording: on the phone (QR) – or from this computer */}
        <div id="upload" className="w-full max-w-4xl scroll-mt-24 text-left">
          <div className="grid overflow-hidden rounded-card border border-line bg-surface shadow-soft md:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <div className="flex flex-col items-center gap-4 border-line/70 bg-surface-2/50 p-6 text-center max-md:hidden md:border-r">
              <span className="flex size-11 items-center justify-center rounded-full bg-accent-soft text-accent [&_svg]:size-5">
                <Smartphone aria-hidden="true" />
              </span>
              <div>
                <h2 className="font-display text-xl leading-snug font-semibold text-ink">{t('landing.phone.title')}</h2>
                <p className="mt-1.5 text-sm leading-relaxed text-muted text-pretty">{t('landing.phone.text')}</p>
              </div>
              <QrCode value={siteUrl} size={148} label={t('landing.phone.qr')} />
              <p className="font-mono text-sm text-ink">{siteHost}</p>
            </div>
            <div className="flex min-w-0 flex-col gap-3 p-4 sm:p-6">
              <p className="text-sm font-medium text-muted max-md:hidden">{t('landing.phone.orHere')}</p>
              <Uploader variant="hero" limits={uploadLimits} />
            </div>
          </div>
        </div>

        {demoCollectionId ? (
          <Button href={`/${demoCollectionId}`} variant="ghost" rightIcon={<ArrowRight />} className="w-fit">
            {t('landing.hero.demo')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
