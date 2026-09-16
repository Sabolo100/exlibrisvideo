'use client';

/** PIN-protected catalogue as an app screen: the website's PIN gate inside the app chrome. */
import { PinGate } from '@/components/collection/PinGate';
import { useI18n } from '@/i18n/client';
import { AppScreen } from './AppScreen';
import { AppBackButton, AppTopBar } from './AppTopBar';

export function AppPinGate({ id, title }: { id: string; title: string | null }) {
  const { t } = useI18n();
  return (
    <AppScreen
      top={<AppTopBar leading={<AppBackButton fallbackHref="/my" />} title={title || t('app.home.recent.untitled', { id })} />}
      mainClassName="flex flex-col justify-center px-4 py-6"
    >
      <PinGate id={id} title={title} />
    </AppScreen>
  );
}
