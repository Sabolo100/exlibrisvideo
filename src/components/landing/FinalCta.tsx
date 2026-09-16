import { BookOpen, Library, UploadCloud } from 'lucide-react';
import { getServerT } from '@/i18n/server';
import { Ornament } from '@/components/site/SiteFooter';
import { Button } from '@/components/ui/Button';

/** Closing call to action: back to the uploader, sample library (when configured), my collections. */
export async function FinalCta({ demoCollectionId }: { demoCollectionId?: string | null }) {
  const { t } = await getServerT();
  return (
    <section aria-labelledby="landing-cta-title">
      <div className="mx-auto max-w-4xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <Ornament className="mx-auto" />
        <h2 id="landing-cta-title" className="mt-5 font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-[2.6rem]">
          {t('landing.cta.title')}
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-muted text-pretty sm:text-lg">{t('landing.cta.text')}</p>
        <div className="mt-8 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center">
          <Button href="/#upload" variant="primary" size="lg" leftIcon={<UploadCloud />}>
            {t('landing.cta.upload')}
          </Button>
          {demoCollectionId ? (
            <Button href={`/${demoCollectionId}`} size="lg" leftIcon={<BookOpen />}>
              {t('landing.cta.demo')}
            </Button>
          ) : (
            <Button href="/my" size="lg" variant="ghost" leftIcon={<Library />}>
              {t('landing.cta.my')}
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}
