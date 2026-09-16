'use client';

/** Tab bar of the top-level screens: Home · (record) · My catalogues. */
import { Camera, House, LibraryBig } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { useAppRecord } from './AppRecordProvider';
import { AppFab, AppTabBar } from './AppTabBar';

export function AppMainTabBar({ active }: { active: 'home' | 'library' }) {
  const { t } = useI18n();
  const { record } = useAppRecord();
  return (
    <AppTabBar
      label={t('app.tabs.label')}
      tabs={[
        { key: 'home', label: t('app.tabs.home'), icon: <House />, href: '/', active: active === 'home' },
        { key: 'library', label: t('app.tabs.library'), icon: <LibraryBig />, href: '/my', active: active === 'library' },
      ]}
      center={<AppFab label={t('app.tabs.record')} icon={<Camera />} onClick={record} />}
    />
  );
}
