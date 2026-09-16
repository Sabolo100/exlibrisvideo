'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useUiTranslator } from './hooks';
import { DropdownMenu } from './DropdownMenu';
import { IconButton } from './IconButton';
import { SegmentedControl } from './SegmentedControl';
import { useTheme, type ThemePreference } from './theme';

export interface ThemeToggleProps {
  /** "menu": icon button with a light/dark/system menu (header); "segmented": three labelled segments */
  variant?: 'menu' | 'segmented';
  size?: 'sm' | 'md';
  className?: string;
}

/** Light / dark / system theme switch (persists to localStorage "exl_theme"). */
export function ThemeToggle({ variant = 'menu', size = 'md', className }: ThemeToggleProps) {
  const { t } = useUiTranslator();
  const { preference, resolved, setPreference } = useTheme();

  const labels: Record<ThemePreference, string> = {
    light: t('common.theme.light'),
    dark: t('common.theme.dark'),
    system: t('common.theme.system'),
  };

  if (variant === 'segmented') {
    return (
      <SegmentedControl<ThemePreference>
        aria-label={t('common.theme.label')}
        value={preference}
        onChange={setPreference}
        size={size}
        className={className}
        options={[
          { value: 'light', label: labels.light, icon: <Sun aria-hidden="true" /> },
          { value: 'dark', label: labels.dark, icon: <Moon aria-hidden="true" /> },
          { value: 'system', label: labels.system, icon: <Monitor aria-hidden="true" /> },
        ]}
      />
    );
  }

  const Icon = preference === 'system' ? (resolved === 'dark' ? Moon : Sun) : preference === 'dark' ? Moon : Sun;

  return (
    <DropdownMenu
      aria-label={t('common.theme.label')}
      align="end"
      minWidth={176}
      trigger={
        <IconButton
          aria-label={t('common.theme.toggle', { theme: labels[preference] })}
          icon={<Icon />}
          size={size === 'sm' ? 'sm' : 'md'}
          className={className}
        />
      }
      items={[
        { type: 'label', label: t('common.theme.label') },
        {
          type: 'radio',
          label: labels.light,
          icon: <Sun />,
          checked: preference === 'light',
          onSelect: () => setPreference('light'),
        },
        { type: 'radio', label: labels.dark, icon: <Moon />, checked: preference === 'dark', onSelect: () => setPreference('dark') },
        {
          type: 'radio',
          label: labels.system,
          icon: <Monitor />,
          checked: preference === 'system',
          onSelect: () => setPreference('system'),
        },
      ]}
    />
  );
}
