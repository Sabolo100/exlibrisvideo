'use client';

import { ChevronDown } from 'lucide-react';
import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';
import { useFieldControlProps } from './Field';
import { CONTROL_BASE, CONTROL_SIZES, type ControlSize } from './Input';

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export type SelectProps = Omit<ComponentPropsWithRef<'select'>, 'size'> & {
  size?: ControlSize;
  /** options (or pass <option>/<optgroup> children) */
  options?: SelectOption[];
  /** disabled empty first option, e.g. "Válassz…" */
  placeholder?: string;
  leftIcon?: ReactNode;
  wrapperClassName?: string;
};

/** Native <select> styled like the other controls (best on mobile). */
export function Select(props: SelectProps) {
  const { size = 'md', options, placeholder, leftIcon, wrapperClassName, className, children, ...rest } =
    useFieldControlProps(props);
  return (
    <div className={cn('relative flex w-full items-center', wrapperClassName)}>
      {leftIcon ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 left-0 flex w-9 items-center justify-center text-muted [&_svg]:size-4"
        >
          {leftIcon}
        </span>
      ) : null}
      <select
        className={cn(
          CONTROL_BASE,
          CONTROL_SIZES[size],
          'cursor-pointer appearance-none pr-9',
          leftIcon && 'pl-9',
          className,
        )}
        {...rest}
      >
        {placeholder !== undefined ? (
          <option value="" disabled>
            {placeholder}
          </option>
        ) : null}
        {options?.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 size-4 text-muted"
      />
    </div>
  );
}
