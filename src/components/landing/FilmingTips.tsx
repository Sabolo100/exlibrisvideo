import type { ReactNode } from 'react';
import { getServerT } from '@/i18n/server';
import { SectionHeading } from './SectionHeading';
import { ClipsDiagram, DistanceDiagram, GlareDiagram, LightDiagram, PanDiagram, UprightDiagram } from './TipDiagrams';

/** Six filming tips, each with a small diagram. */
export async function FilmingTips() {
  const { t } = await getServerT();
  const tips: { key: string; diagram: ReactNode; title: string; text: string }[] = [
    { key: 'distance', diagram: <DistanceDiagram />, title: t('landing.tips.distance.title'), text: t('landing.tips.distance.text') },
    { key: 'pan', diagram: <PanDiagram />, title: t('landing.tips.pan.title'), text: t('landing.tips.pan.text') },
    { key: 'light', diagram: <LightDiagram />, title: t('landing.tips.light.title'), text: t('landing.tips.light.text') },
    { key: 'glare', diagram: <GlareDiagram />, title: t('landing.tips.glare.title'), text: t('landing.tips.glare.text') },
    { key: 'upright', diagram: <UprightDiagram />, title: t('landing.tips.upright.title'), text: t('landing.tips.upright.text') },
    { key: 'clips', diagram: <ClipsDiagram />, title: t('landing.tips.clips.title'), text: t('landing.tips.clips.text') },
  ];

  return (
    <section id="tips" aria-labelledby="landing-tips-title" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <SectionHeading id="landing-tips-title" eyebrow={t('landing.tips.eyebrow')} title={t('landing.tips.title')} lead={t('landing.tips.lead')} />
        <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-2 lg:grid-cols-3 lg:gap-5">
          {tips.map((tip) => (
            <li key={tip.key} className="flex flex-col overflow-hidden rounded-card border border-line bg-surface shadow-soft">
              <div className="border-b border-line/70 bg-[linear-gradient(180deg,var(--surface-2),var(--surface))] px-6 pt-4 pb-2">
                <div className="mx-auto max-w-[15rem]">{tip.diagram}</div>
              </div>
              <div className="flex flex-1 flex-col gap-1.5 p-5">
                <h3 className="font-display text-lg leading-snug font-semibold text-ink">{tip.title}</h3>
                <p className="text-[0.9375rem] leading-relaxed text-muted text-pretty">{tip.text}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
