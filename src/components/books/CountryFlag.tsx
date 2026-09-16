'use client';

import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import { countryFlagEmoji, countryName } from '@/lib/book-utils';
import { useFlagEmojiSupport } from './flag-support';

export interface CountryFlagProps {
  /** ISO 3166-1 alpha-2, e.g. "HU" */
  code: string | null | undefined;
  /** show the localized country name after the flag */
  showName?: boolean;
  className?: string;
}

/**
 * Flag emoji with the localized country name as title / accessible name. Where the platform has
 * no flag glyphs (Windows) it shows a small ISO-code plate instead. Renders nothing for invalid codes.
 */
export function CountryFlag({ code, showName = false, className }: CountryFlagProps) {
  const { locale } = useUiTranslator();
  const supported = useFlagEmojiSupport();
  const flag = countryFlagEmoji(code);
  if (!flag || !code) return null;
  const name = countryName(code, locale);
  const iso = code.trim().toUpperCase() === 'UK' ? 'GB' : code.trim().toUpperCase();

  return (
    <span className={cn('inline-flex items-center gap-1.5', className)} title={name}>
      {supported ? (
        <span role="img" aria-label={name} className="font-[system-ui] leading-none">
          {flag}
        </span>
      ) : (
        <span
          role="img"
          aria-label={name}
          className="inline-flex h-[1.35em] min-w-[1.9em] items-center justify-center rounded-[3px] border border-line bg-surface-2 px-[0.3em] font-sans text-[0.7em] leading-none font-semibold tracking-[0.06em] text-muted"
        >
          {iso}
        </span>
      )}
      {showName ? <span className="truncate">{name}</span> : null}
    </span>
  );
}
