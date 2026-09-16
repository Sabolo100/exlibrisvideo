'use client';

import { X } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';
import { useFieldControlProps } from './Field';
import { useUiTranslator } from './hooks';

export type ControlSize = 'sm' | 'md' | 'lg';

/** Shared look of text-like controls (Input, Textarea, Select, CopyField). */
export const CONTROL_BASE =
  'w-full min-w-0 rounded-[0.625rem] border border-line bg-surface text-ink placeholder:text-muted/80 ' +
  'shadow-[inset_0_1px_2px_hsl(var(--shadow-color)/0.06)] transition-[border-color,box-shadow] duration-150 ' +
  'hover:border-[color-mix(in_oklab,var(--line),var(--ink)_20%)] ' +
  'focus-visible:border-accent focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--focus)_30%,transparent)] focus-visible:outline-none ' +
  'aria-[invalid=true]:border-danger aria-[invalid=true]:focus-visible:shadow-[0_0_0_3px_color-mix(in_oklab,var(--danger)_25%,transparent)] ' +
  'disabled:cursor-not-allowed disabled:bg-surface-2 disabled:opacity-70 read-only:bg-surface-2/60';

export const CONTROL_SIZES: Record<ControlSize, string> = {
  sm: 'h-8 px-2.5 text-[0.8125rem]',
  md: 'h-10 px-3 text-[0.9375rem]',
  lg: 'h-12 px-4 text-base',
};

const ICON_PAD: Record<ControlSize, { left: string; right: string; icon: string }> = {
  sm: { left: 'pl-8', right: 'pr-8', icon: '[&_svg]:size-4 w-8' },
  md: { left: 'pl-9', right: 'pr-9', icon: '[&_svg]:size-[1.125rem] w-9' },
  lg: { left: 'pl-11', right: 'pr-11', icon: '[&_svg]:size-5 w-11' },
};

export type InputProps = Omit<ComponentPropsWithRef<'input'>, 'size'> & {
  size?: ControlSize;
  /** decorative icon inside the left edge */
  leftIcon?: ReactNode;
  /** element inside the right edge (unit, button …) */
  rightElement?: ReactNode;
  /** shows a clear (×) button while the value is non-empty */
  onClear?: () => void;
  /** class for the wrapper when icons/elements are used */
  wrapperClassName?: string;
};

/** Text input. Inside <Field> it picks up id / aria wiring automatically. `ref` is a normal prop. */
export function Input(props: InputProps) {
  const { t } = useUiTranslator();
  const { size = 'md', leftIcon, rightElement, onClear, wrapperClassName, className, ...rest } = useFieldControlProps(props);
  const pad = ICON_PAD[size];
  const hasValue = rest.value !== undefined ? String(rest.value).length > 0 : true;
  const showClear = Boolean(onClear) && hasValue && !rest.disabled && !rest.readOnly;
  const right = showClear ? (
    <button
      type="button"
      onClick={onClear}
      aria-label={t('common.aria.clearInput')}
      className="inline-flex size-6 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-ink [&_svg]:size-3.5"
    >
      <X aria-hidden="true" />
    </button>
  ) : (
    rightElement
  );

  const input = (
    <input
      className={cn(CONTROL_BASE, CONTROL_SIZES[size], leftIcon ? pad.left : null, right ? pad.right : null, className)}
      {...rest}
    />
  );
  if (!leftIcon && !right) return input;
  return (
    <div className={cn('relative flex w-full items-center', wrapperClassName)}>
      {leftIcon ? (
        <span
          className={cn('pointer-events-none absolute inset-y-0 left-0 flex items-center justify-center text-muted', pad.icon)}
          aria-hidden="true"
        >
          {leftIcon}
        </span>
      ) : null}
      {input}
      {right ? (
        <span className={cn('absolute inset-y-0 right-0 flex min-w-8 items-center justify-center pr-1.5 text-muted', pad.icon, 'w-auto')}>
          {right}
        </span>
      ) : null}
    </div>
  );
}
