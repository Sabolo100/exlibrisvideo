'use client';

import { Check, Copy } from 'lucide-react';
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { buttonClasses } from './Button';
import { cn } from './cn';
import { useUiTranslator } from './hooks';
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from './Input';

/**
 * Copies text to the clipboard; falls back to a hidden textarea + execCommand for
 * insecure contexts (plain HTTP before SSL). Resolves false when both fail.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through to the legacy path */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

export interface CopyFieldProps {
  value: string;
  /** accessible name of the field (e.g. "Megosztható link") */
  label: string;
  /** visible label above the field */
  showLabel?: boolean;
  /** text shown in the field when it should differ from the copied value */
  displayValue?: string;
  size?: ControlSize;
  /** icon-only copy button */
  compact?: boolean;
  leftIcon?: ReactNode;
  onCopied?: () => void;
  className?: string;
}

/** Read-only field with a copy button ("Másolás" → "Másolva!"). Selects all on focus. */
export function CopyField({
  value,
  label,
  showLabel = false,
  displayValue,
  size = 'md',
  compact = false,
  leftIcon,
  onCopied,
  className,
}: CopyFieldProps) {
  const { t } = useUiTranslator();
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  useEffect(() => {
    if (state === 'idle') return;
    const timer = setTimeout(() => setState('idle'), state === 'copied' ? 2000 : 5000);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    const ok = await copyToClipboard(value);
    if (ok) {
      setState('copied');
      onCopied?.();
    } else {
      setState('failed');
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  const copied = state === 'copied';
  const buttonText = copied ? t('common.action.copied') : t('common.action.copy');

  return (
    <div className={cn('flex w-full flex-col gap-1.5', className)}>
      <label htmlFor={id} className={cn('text-sm font-medium text-ink', !showLabel && 'sr-only')}>
        {label}
      </label>
      <div className="flex w-full items-stretch gap-2">
        <div className="relative min-w-0 flex-1">
          {leftIcon ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-muted [&_svg]:size-4"
            >
              {leftIcon}
            </span>
          ) : null}
          <input
            ref={inputRef}
            id={id}
            readOnly
            value={displayValue ?? value}
            onFocus={(e) => e.currentTarget.select()}
            onClick={(e) => e.currentTarget.select()}
            className={cn(CONTROL_BASE, CONTROL_SIZES[size], 'font-mono text-[0.875em] tracking-tight', leftIcon && 'pl-9')}
          />
        </div>
        <button
          type="button"
          onClick={copy}
          aria-label={compact ? buttonText : undefined}
          className={cn(
            buttonClasses({ variant: copied ? 'primary' : 'secondary', size }),
            compact && (size === 'sm' ? 'w-8 px-0' : size === 'lg' ? 'w-12 px-0' : 'w-10 px-0'),
            'shrink-0',
          )}
        >
          {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
          {!compact ? <span>{buttonText}</span> : null}
        </button>
      </div>
      <span aria-live="polite" className={cn('text-[0.8125rem]', state === 'failed' ? 'text-danger' : 'sr-only')}>
        {state === 'copied' ? t('common.action.copied') : state === 'failed' ? t('common.copy.failed') : ''}
      </span>
    </div>
  );
}
