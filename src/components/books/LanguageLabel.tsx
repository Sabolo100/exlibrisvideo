'use client';

import { Languages } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { cn } from '@/components/ui/cn';
import { useUiTranslator } from '@/components/ui/hooks';
import { languageName } from '@/lib/book-utils';

export interface LanguageLabelProps {
  /** ISO 639-1, e.g. "hu" */
  code: string | null | undefined;
  /** "text" (inline) or "badge" */
  variant?: 'text' | 'badge';
  /** show the language icon */
  icon?: boolean;
  /** append the code, e.g. "Magyar (hu)" */
  showCode?: boolean;
  className?: string;
}

/** Localized language name ("hu" → "Magyar" / "Hungarian"). Renders nothing for empty codes. */
export function LanguageLabel({ code, variant = 'text', icon = false, showCode = false, className }: LanguageLabelProps) {
  const { locale } = useUiTranslator();
  const trimmed = code?.trim();
  if (!trimmed) return null;
  const name = languageName(trimmed, locale);
  const text = showCode && name.toLowerCase() !== trimmed.toLowerCase() ? `${name} (${trimmed.toLowerCase()})` : name;
  if (variant === 'badge') {
    return (
      <Badge tone="neutral" className={className} icon={icon ? <Languages aria-hidden="true" /> : undefined}>
        {text}
      </Badge>
    );
  }
  return (
    <span className={cn('inline-flex items-center gap-1', className)}>
      {icon ? <Languages aria-hidden="true" className="size-[1em] text-muted" /> : null}
      <span>{text}</span>
    </span>
  );
}
