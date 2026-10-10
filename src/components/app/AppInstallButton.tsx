'use client';

/**
 * Top-bar "install the app" button, shown until the app runs installed: opens the browser's install dialog
 * where there is one (Chrome / Android), otherwise the settings sheet with the iOS "Add to Home Screen" steps.
 */
import { Download } from 'lucide-react';
import { useI18n } from '@/i18n/client';
import { promptInstall, useInstallState } from '@/lib/client/install-prompt';
import { AppBarButton } from './AppTopBar';

export function AppInstallButton({ onNeedHelp }: { onNeedHelp: () => void }) {
  const { t } = useI18n();
  const { standalone, canPrompt, ios } = useInstallState();
  if (standalone || (!canPrompt && !ios)) return null;
  return (
    <AppBarButton
      label={t('app.settings.install.title')}
      icon={<Download />}
      onClick={() => {
        if (canPrompt) void promptInstall();
        else onNeedHelp();
      }}
    />
  );
}
