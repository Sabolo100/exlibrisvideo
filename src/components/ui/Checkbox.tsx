'use client';

import { Check, Minus } from 'lucide-react';
import { useEffect, useId, useRef, type ComponentPropsWithRef, type ReactNode, type Ref } from 'react';
import { cn } from './cn';

export type CheckboxProps = Omit<ComponentPropsWithRef<'input'>, 'type' | 'size' | 'onChange'> & {
  label?: ReactNode;
  description?: ReactNode;
  /** "mixed" state (e.g. select-all with partial selection) */
  indeterminate?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  onChange?: ComponentPropsWithRef<'input'>['onChange'];
  size?: 'sm' | 'md';
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/** Native checkbox with a custom box; label and description are clickable. */
export function Checkbox({
  label,
  description,
  indeterminate = false,
  onCheckedChange,
  onChange,
  size = 'md',
  className,
  id: idProp,
  ref,
  disabled,
  ...rest
}: CheckboxProps) {
  const auto = useId();
  const id = idProp ?? `cb-${auto}`;
  const inner = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (inner.current) inner.current.indeterminate = indeterminate;
  }, [indeterminate]);
  const box = size === 'sm' ? 'size-4 rounded-[4px]' : 'size-[1.125rem] rounded-[5px]';

  return (
    <div className={cn('inline-flex items-start gap-2.5', disabled && 'opacity-60', className)}>
      <span className={cn('relative mt-[0.1875rem] inline-flex shrink-0', box)}>
        <input
          ref={(el) => {
            inner.current = el;
            // DOM-only property: also re-applied whenever the element is (re)attached
            if (el) el.indeterminate = indeterminate;
            assignRef(ref, el);
          }}
          id={id}
          type="checkbox"
          disabled={disabled}
          aria-checked={indeterminate ? 'mixed' : undefined}
          aria-describedby={description ? `${id}-desc` : undefined}
          onChange={(e) => {
            onChange?.(e);
            onCheckedChange?.(e.target.checked);
          }}
          className={cn(
            'peer absolute inset-0 m-0 cursor-pointer appearance-none border border-[color-mix(in_oklab,var(--line),var(--ink)_28%)] bg-surface',
            'transition-[background-color,border-color,box-shadow] duration-150 checked:border-primary checked:bg-primary',
            'indeterminate:border-primary indeterminate:bg-primary hover:border-primary disabled:cursor-not-allowed',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]',
            box,
          )}
          {...rest}
        />
        <Check
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-[75%] text-primary-ink opacity-0 transition-opacity peer-checked:opacity-100 peer-indeterminate:opacity-0"
        />
        <Minus
          aria-hidden="true"
          strokeWidth={3}
          className="pointer-events-none absolute inset-0 m-auto size-[75%] text-primary-ink opacity-0 transition-opacity peer-indeterminate:opacity-100"
        />
      </span>
      {label || description ? (
        <span className="flex min-w-0 flex-col">
          {label ? (
            <label htmlFor={id} className={cn('cursor-pointer text-ink select-none', size === 'sm' ? 'text-[0.8125rem]' : 'text-sm')}>
              {label}
            </label>
          ) : null}
          {description ? (
            <span id={`${id}-desc`} className="text-[0.8125rem] text-muted">
              {description}
            </span>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
