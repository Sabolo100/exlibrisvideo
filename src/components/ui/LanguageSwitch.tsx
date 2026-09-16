'use client';

import { useEffect, useState, useTransition } from 'react';
import { useI18n } from '@/i18n/client';
import type { Locale } from '@/lib/types';
import { cn } from './cn';
import { SegmentedControl } from './SegmentedControl';

export interface LanguageSwitchProps {
  size?: 'sm' | 'md';
  /** "short": HU | EN, "long": Magyar | English */
  labels?: 'short' | 'long';
  fullWidth?: boolean;
  className?: string;
}

/** HU | EN switch – sets the exl_lang cookie via useI18n().setLocale and refreshes server components. */
export function LanguageSwitch({ size = 'sm', labels = 'short', fullWidth = false, className }: LanguageSwitchProps) {
  const { locale, setLocale, t } = useI18n();
  const [pending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<Locale>(locale);

  useEffect(() => {
    setOptimistic(locale);
  }, [locale]);

  const change = (next: Locale) => {
    if (next === locale) return;
    setOptimistic(next);
    startTransition(() => setLocale(next));
  };

  return (
    <SegmentedControl<Locale>
      aria-label={t('common.lang.switch')}
      value={optimistic}
      onChange={change}
      size={size}
      fullWidth={fullWidth}
      className={cn(pending && 'opacity-70', className)}
      options={[
        {
          value: 'hu',
          label: labels === 'short' ? 'HU' : t('common.lang.hu'),
          title: t('common.lang.hu'),
          ariaLabel: t('common.lang.hu'),
          lang: 'hu',
        },
        {
          value: 'en',
          label: labels === 'short' ? 'EN' : t('common.lang.en'),
          title: t('common.lang.en'),
          ariaLabel: t('common.lang.en'),
          lang: 'en',
        },
      ]}
    />
  );
}
