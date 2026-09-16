import { ArrowRight, Eye, Server, ShieldCheck, Trash2, UserRound } from 'lucide-react';
import type { ReactNode } from 'react';
import { getServerT } from '@/i18n/server';
import { LogoMark } from '@/components/site/Logo';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** Privacy promise in a bookplate card: no account, video deleted, link-only access, EU hosting. */
export async function PrivacyPromise() {
  const { t } = await getServerT();
  const points: { icon: ReactNode; text: string }[] = [
    { icon: <UserRound />, text: t('landing.privacy.point1') },
    { icon: <Trash2 />, text: t('landing.privacy.point2') },
    { icon: <Eye />, text: t('landing.privacy.point3') },
    { icon: <Server />, text: t('landing.privacy.point4') },
  ];

  return (
    <section id="privacy" aria-labelledby="landing-privacy-title" className="scroll-mt-20">
      <div className="mx-auto max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
        <Card variant="bookplate" className="overflow-hidden p-6 sm:p-10">
          <div className="grid gap-8 md:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] md:items-center md:gap-10">
            <div className="flex flex-col items-start gap-3">
              <span className="flex items-center gap-3">
                <LogoMark className="h-12 w-auto" />
                <ShieldCheck aria-hidden="true" className="size-7 text-accent" />
              </span>
              <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">{t('landing.privacy.eyebrow')}</p>
              <h2 id="landing-privacy-title" className="font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-4xl">
                {t('landing.privacy.title')}
              </h2>
              <p className="text-base leading-relaxed text-muted text-pretty">{t('landing.privacy.lead')}</p>
              <Button href="/privacy" variant="ghost" rightIcon={<ArrowRight />} className="-ml-3">
                {t('landing.privacy.more')}
              </Button>
            </div>
            <ul className="flex flex-col gap-4">
              {points.map((p) => (
                <li key={p.text} className="flex items-start gap-3">
                  <span
                    aria-hidden="true"
                    className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent [&_svg]:size-[1.125rem]"
                  >
                    {p.icon}
                  </span>
                  <p className="text-[0.9375rem] leading-relaxed text-ink text-pretty">{p.text}</p>
                </li>
              ))}
            </ul>
          </div>
        </Card>
      </div>
    </section>
  );
}
