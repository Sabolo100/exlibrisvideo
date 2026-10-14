import { ArrowRight, BookOpen, Gift, Smartphone, UserX } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { cn } from '@/components/ui/cn';
import { QrCode } from '@/components/ui/QrCode';
import { serverUploadLimits } from '@/components/upload/server-limits';
import { Uploader } from '@/components/upload/Uploader';
import { heroZoneFrame, heroZoneIdle, heroZoneNote, heroZoneText, heroZoneTitle, HeroZoneIcon } from '@/components/upload/zone-chrome';
import { SignInCard } from '@/components/site/SignInCard';
import { env, googleAuthEnabled } from '@/lib/env';
import { HeroShelf } from './HeroShelf';
import { HeroWordmark } from './HeroWordmark';
import { PromoVideo } from './PromoVideo';
import { SectionHeading } from './SectionHeading';

/**
 * "…or": on a touch screen below `lg` the phone card has no point (the visitor already holds a phone or tablet
 * with a camera), so it and the divider are hidden there – the upload card offers "record" and "pick" itself.
 */
const PHONE_OPTION_HIDDEN = 'max-lg:any-pointer-coarse:hidden';

/** The "or" between the two ways to give us the shelf: a vertical rule on wide screens, a horizontal one when stacked. */
function OrDivider({ label }: { label: string }) {
  return (
    <div className={cn('flex items-center justify-center gap-3 lg:flex-col lg:self-stretch', PHONE_OPTION_HIDDEN)}>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-r from-transparent to-line lg:h-auto lg:w-px lg:bg-gradient-to-b" />
      <span className="grid size-12 shrink-0 place-items-center rounded-full border border-accent/45 bg-surface font-display text-lg text-accent italic shadow-soft ring-4 ring-bg">
        {label}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-gradient-to-l from-transparent to-line lg:h-auto lg:w-px lg:bg-gradient-to-t" />
    </div>
  );
}

/** Option one: film it on the phone. Built from the same pieces as the upload card, so the two look like twins. */
function PhoneCard({ qrLabel, title, text, siteUrl, siteHost }: { qrLabel: string; title: string; text: string; siteUrl: string; siteHost: string }) {
  return (
    <Card as="section" variant="bookplate" aria-labelledby="landing-phone-title" className={cn('flex flex-col p-2.5 sm:p-3', PHONE_OPTION_HIDDEN)}>
      <div className="@container flex flex-1 flex-col">
        <div className={cn(heroZoneFrame, heroZoneIdle)}>
          <HeroZoneIcon>
            <Smartphone />
          </HeroZoneIcon>
          <div className="flex min-w-0 flex-col items-center gap-1.5">
            <h2 id="landing-phone-title" className={heroZoneTitle}>
              {title}
            </h2>
            <p className={heroZoneText}>{text}</p>
          </div>
          <QrCode value={siteUrl} size={136} label={qrLabel} />
          <p className={cn(heroZoneNote, 'font-mono text-sm text-ink')}>{siteHost}</p>
        </div>
      </div>
    </Card>
  );
}

/**
 * Landing hero, one column from top to bottom: the brand name, the headline, one long shelf being filmed, the
 * Google sign-in, the recording – on the phone (QR code) *or* from this computer, side by side – and the promo video.
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
      <div className="relative mx-auto flex max-w-5xl flex-col items-center gap-8 px-4 pt-8 pb-14 text-center sm:gap-10 sm:px-6 sm:pt-12 lg:pt-14 lg:pb-20">
        {/* 0 · the brand, written out large */}
        <HeroWordmark />

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
        {googleAuthEnabled() ? <SignInCard className="mt-4 w-full max-w-xl" /> : null}

        {/* 4 · the recording: on the phone (QR) – or from this computer. Two options, one look. */}
        <div id="upload" className="w-full scroll-mt-24 text-left">
          <div className="mx-auto grid w-full max-w-2xl gap-4 lg:max-w-none lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-5 lg:has-[[data-uploader-open]]:items-start">
            <PhoneCard
              qrLabel={t('landing.phone.qr')}
              title={t('landing.phone.title')}
              text={t('landing.phone.text')}
              siteUrl={siteUrl}
              siteHost={siteHost}
            />
            <OrDivider label={t('landing.hero.or')} />
            <Uploader variant="hero" limits={uploadLimits} />
          </div>
        </div>

        {/* 5 · the promo video: starts by itself when it comes into view, costs the page nothing before that */}
        <section aria-labelledby="landing-video-title" className="mt-4 w-full max-w-4xl sm:mt-6">
          <SectionHeading
            id="landing-video-title"
            eyebrow={t('landing.video.eyebrow')}
            title={t('landing.video.title')}
            lead={t('landing.video.lead')}
          />
          <div className="mt-6 sm:mt-8">
            <Card variant="bookplate" className="p-2.5 shadow-lift sm:p-3">
              <PromoVideo />
            </Card>
          </div>
        </section>

        {demoCollectionId ? (
          <Button href={`/${demoCollectionId}`} variant="ghost" rightIcon={<ArrowRight />} className="w-fit">
            {t('landing.hero.demo')}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
