import { Home, Library } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { OpenByIdForm } from '@/components/landing/OpenByIdForm';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';

/** Three spines reading 4 · 0 · 4 on a walnut plank, with a book fallen over next to the gap. */
function MissingBookIllustration({ label }: { label: string }) {
  const spines = [
    { x: 58, h: 118, w: 38, fill: 'fill-primary', digit: '4' },
    { x: 100, h: 132, w: 44, fill: 'fill-burgundy', digit: '0' },
    { x: 148, h: 112, w: 38, fill: 'fill-wood', digit: '4' },
  ];
  const floor = 150;
  return (
    <svg viewBox="0 0 300 176" role="img" aria-label={label} className="mx-auto h-auto w-full max-w-sm">
      {/* back panel */}
      <rect x={24} y={8} width={252} height={148} rx={6} className="fill-wood-dark" opacity={0.18} />
      {spines.map((s) => (
        <g key={s.x}>
          <rect x={s.x} y={floor - s.h} width={s.w} height={s.h} rx={3} className={s.fill} />
          <rect x={s.x} y={floor - s.h + 10} width={s.w} height={3} className="fill-accent" opacity={0.85} />
          <rect x={s.x} y={floor - 16} width={s.w} height={3} className="fill-accent" opacity={0.85} />
          <text
            x={s.x + s.w / 2}
            y={floor - s.h / 2 + 12}
            textAnchor="middle"
            className="fill-primary-ink"
            fontSize={34}
            fontWeight={700}
            fontFamily="Fraunces Variable, Georgia, serif"
            style={{ fontVariantNumeric: 'lining-nums' }}
          >
            {s.digit}
          </text>
        </g>
      ))}
      {/* the gap where the book should be, with a dashed outline */}
      <rect x={192} y={floor - 108} width={30} height={106} rx={3} className="stroke-accent" strokeWidth={2} strokeDasharray="6 5" fill="none" />
      {/* two books lying flat at the end of the shelf */}
      <rect x={232} y={floor - 13} width={46} height={13} rx={2} className="fill-muted" opacity={0.8} />
      <rect x={236} y={floor - 24} width={38} height={11} rx={2} className="fill-accent" opacity={0.85} />
      {/* plank */}
      <rect x={16} y={floor} width={268} height={12} rx={2} className="fill-wood" />
      <rect x={16} y={floor} width={268} height={3} rx={1.5} className="fill-wood-light" />
      <rect x={20} y={floor + 12} width={260} height={5} rx={2} className="fill-wood-dark" opacity={0.55} />
    </svg>
  );
}

export default async function NotFound() {
  const { t } = await getServerT();
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-12 text-center sm:px-6 sm:py-16">
      <MissingBookIllustration label={t('landing.notFound.illustration')} />
      <p className="mt-8 text-xs font-semibold tracking-[0.16em] text-accent uppercase">{t('landing.notFound.eyebrow')}</p>
      <h1 className="mt-2 font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-4xl">{t('landing.notFound.title')}</h1>
      <p className="mt-3 max-w-lg text-base leading-relaxed text-muted text-pretty">{t('landing.notFound.text')}</p>

      <div className="mt-6 flex flex-wrap justify-center gap-3">
        <Button href="/" variant="primary" leftIcon={<Home />}>
          {t('landing.notFound.home')}
        </Button>
        <Button href="/my" leftIcon={<Library />}>
          {t('landing.notFound.my')}
        </Button>
      </div>

      <Card as="section" aria-labelledby="not-found-find" className="mt-10 w-full p-5 text-left sm:p-6">
        <h2 id="not-found-find" className="font-display text-lg leading-tight font-semibold text-ink">
          {t('landing.notFound.findTitle')}
        </h2>
        <p className="mt-1 text-sm text-muted">{t('my.open.description')}</p>
        <OpenByIdForm className="mt-4" hideLabel />
      </Card>
    </div>
  );
}
