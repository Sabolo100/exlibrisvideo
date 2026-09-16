'use client';

import { motion } from 'motion/react';
import { useId, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from './cn';

export type SwitchProps = Omit<ComponentPropsWithRef<'button'>, 'onChange' | 'children'> & {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  size?: 'sm' | 'md';
  /** label on the left, switch on the right (settings rows) */
  labelPosition?: 'left' | 'right';
};

/** On/off toggle (role="switch"). Clicking the label toggles too. */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  size = 'md',
  labelPosition = 'right',
  className,
  disabled,
  id: idProp,
  ...rest
}: SwitchProps) {
  const auto = useId();
  const id = idProp ?? `sw-${auto}`;
  const track = size === 'sm' ? 'h-5 w-9' : 'h-6 w-11';
  const thumb = size === 'sm' ? 'size-4' : 'size-5';
  const travel = size === 'sm' ? 16 : 20;

  const control = (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={description ? `${id}-desc` : undefined}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex shrink-0 cursor-pointer items-center rounded-full border p-[1px] transition-colors duration-200',
        'disabled:cursor-not-allowed disabled:opacity-50',
        checked ? 'border-primary bg-primary' : 'border-[color-mix(in_oklab,var(--line),var(--ink)_18%)] bg-surface-2',
        track,
      )}
      {...rest}
    >
      <motion.span
        aria-hidden="true"
        initial={false}
        animate={{ x: checked ? travel : 0 }}
        transition={{ type: 'spring', stiffness: 600, damping: 36 }}
        className={cn('block rounded-full shadow-[0_1px_2px_rgb(0_0_0/0.3)]', checked ? 'bg-primary-ink' : 'bg-surface dark:bg-muted', thumb)}
      />
    </button>
  );

  if (!label && !description) return <span className={cn('inline-flex', className)}>{control}</span>;

  return (
    <div
      className={cn(
        'flex items-start gap-3',
        labelPosition === 'left' && 'flex-row-reverse justify-between',
        disabled && 'opacity-60',
        className,
      )}
    >
      <span className="mt-0.5 inline-flex">{control}</span>
      <span className="flex min-w-0 flex-col">
        {label ? (
          <label htmlFor={id} className="cursor-pointer text-sm text-ink select-none">
            {label}
          </label>
        ) : null}
        {description ? (
          <span id={`${id}-desc`} className="text-[0.8125rem] text-muted">
            {description}
          </span>
        ) : null}
      </span>
    </div>
  );
}
