'use client';

import { X } from 'lucide-react';
import type { ComponentPropsWithRef, CSSProperties, ReactNode } from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';

export type ChipSize = 'sm' | 'md';

export type ChipProps = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  children: ReactNode;
  icon?: ReactNode;
  /** small count after the label */
  count?: number;
  /** toggle state; renders aria-pressed when `onSelectedChange` or `onClick` is given */
  selected?: boolean;
  onSelectedChange?: (selected: boolean) => void;
  /** renders a separate remove (×) button */
  onRemove?: () => void;
  /** accessible label of the remove button; defaults to "<label> eltávolítása" */
  removeLabel?: string;
  /** 0–360: tints the chip with this hue (topics) */
  hue?: number;
  size?: ChipSize;
};

const SIZE: Record<ChipSize, { root: string; main: string; remove: string }> = {
  sm: { root: 'h-7 text-xs', main: 'gap-1 px-2.5 [&_svg]:size-3.5', remove: 'size-5 [&_svg]:size-3' },
  md: { root: 'h-8 text-[0.8125rem]', main: 'gap-1.5 px-3 [&_svg]:size-4', remove: 'size-6 [&_svg]:size-3.5' },
};

/**
 * Pill for filters and tags. Toggleable (`selected` + `onSelectedChange`), with optional icon,
 * count and a remove button. Without handlers it is a static label.
 */
export function Chip({
  children,
  icon,
  count,
  selected = false,
  onSelectedChange,
  onRemove,
  removeLabel,
  hue,
  size = 'md',
  className,
  style,
  onClick,
  disabled,
  type = 'button',
  ...rest
}: ChipProps) {
  const { t, n } = useUiTranslator();
  const interactive = Boolean(onSelectedChange || onClick);
  const hued = typeof hue === 'number';
  const s = SIZE[size];

  const rootStyle: CSSProperties | undefined = hued ? ({ ...style, '--chip-hue': String(hue) } as CSSProperties) : style;

  const tone = selected
    ? hued
      ? 'border-[hsl(var(--chip-hue)_42%_36%)] bg-[hsl(var(--chip-hue)_42%_34%)] text-white dark:border-[hsl(var(--chip-hue)_45%_70%)] dark:bg-[hsl(var(--chip-hue)_45%_72%)] dark:text-[#15110c]'
      : 'border-primary bg-primary text-primary-ink'
    : hued
      ? 'border-[hsl(var(--chip-hue)_35%_80%)] bg-[hsl(var(--chip-hue)_55%_95%)] text-[hsl(var(--chip-hue)_40%_26%)] dark:border-[hsl(var(--chip-hue)_22%_30%)] dark:bg-[hsl(var(--chip-hue)_22%_16%)] dark:text-[hsl(var(--chip-hue)_45%_84%)]'
      : 'border-line bg-surface text-ink';

  const label = (
    <>
      {icon ? <span className="inline-flex shrink-0 items-center leading-none" aria-hidden="true">{icon}</span> : null}
      <span className="truncate">{children}</span>
      {typeof count === 'number' ? (
        <span
          className={cn(
            'ml-0.5 rounded-full px-1.5 text-[0.6875rem] leading-4 font-semibold tabular-nums',
            selected ? 'bg-black/15 dark:bg-black/20' : 'bg-ink/[0.07]',
          )}
        >
          {n(count)}
        </span>
      ) : null}
    </>
  );

  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center rounded-full border font-medium whitespace-nowrap transition-[background-color,border-color,color,box-shadow] duration-150',
        s.root,
        tone,
        interactive && !selected && 'hover:border-[color-mix(in_oklab,currentColor_35%,transparent)] hover:shadow-[0_1px_2px_hsl(var(--shadow-color)/0.1)]',
        disabled && 'opacity-50',
        className,
      )}
      style={rootStyle}
    >
      {interactive ? (
        <button
          type={type}
          aria-pressed={onSelectedChange ? selected : undefined}
          disabled={disabled}
          onClick={(e) => {
            onClick?.(e);
            if (!e.defaultPrevented) onSelectedChange?.(!selected);
          }}
          className={cn(
            'inline-flex h-full min-w-0 items-center rounded-full outline-offset-1',
            s.main,
            onRemove && 'pr-1',
            disabled ? 'cursor-not-allowed' : 'cursor-pointer',
          )}
          {...rest}
        >
          {label}
        </button>
      ) : (
        <span className={cn('inline-flex h-full min-w-0 items-center', s.main, onRemove && 'pr-1')}>{label}</span>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          disabled={disabled}
          aria-label={removeLabel ?? t('common.aria.remove', { label: typeof children === 'string' ? children : '' })}
          className={cn(
            'mr-1 inline-flex shrink-0 items-center justify-center rounded-full opacity-70 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10',
            s.remove,
          )}
        >
          <X aria-hidden="true" />
        </button>
      ) : null}
    </span>
  );
}
