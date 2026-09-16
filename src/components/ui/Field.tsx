'use client';

import { CircleAlert } from 'lucide-react';
import { createContext, useContext, useId, type ReactNode } from 'react';
import { cn } from './cn';
import { useUiTranslator } from './hooks';

export interface FieldContextValue {
  id: string;
  hintId?: string;
  errorId?: string;
  invalid: boolean;
  required: boolean;
  disabled: boolean;
}

const FieldContext = createContext<FieldContextValue | null>(null);

/** Inside <Field>: ids and state for the control (Input, Textarea, Select read it automatically). */
export function useField(): FieldContextValue | null {
  return useContext(FieldContext);
}

/** Merges Field context into a control's props (id, aria-describedby, aria-invalid, required). */
export function useFieldControlProps<P extends { id?: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean | 'true' | 'false' | 'grammar' | 'spelling'; required?: boolean; disabled?: boolean }>(
  props: P,
): P {
  const field = useField();
  if (!field) return props;
  const describedBy = [props['aria-describedby'], field.errorId, field.hintId].filter(Boolean).join(' ') || undefined;
  return {
    ...props,
    id: props.id ?? field.id,
    'aria-describedby': describedBy,
    'aria-invalid': props['aria-invalid'] ?? (field.invalid || undefined),
    required: props.required ?? (field.required || undefined),
    disabled: props.disabled ?? (field.disabled || undefined),
  };
}

export interface FieldProps {
  label: ReactNode;
  /** helper text under the control */
  hint?: ReactNode;
  /** error message – marks the control aria-invalid and replaces nothing (hint stays) */
  error?: ReactNode;
  required?: boolean;
  /** shows "(nem kötelező)" after the label */
  optional?: boolean;
  disabled?: boolean;
  /** visually hide the label (still announced) */
  hideLabel?: boolean;
  /** explicit control id (otherwise generated) */
  id?: string;
  /** right side of the label row, e.g. a character counter or a link */
  labelAside?: ReactNode;
  className?: string;
  children: ReactNode;
}

/**
 * Label + control + hint + error with correct wiring:
 *   <Field label="E-mail" hint="Ide küldjük az Excelt" error={err}><Input type="email" /></Field>
 */
export function Field({
  label,
  hint,
  error,
  required = false,
  optional = false,
  disabled = false,
  hideLabel = false,
  id: idProp,
  labelAside,
  className,
  children,
}: FieldProps) {
  const { t } = useUiTranslator();
  const auto = useId();
  const id = idProp ?? `field-${auto}`;
  const hintId = hint ? `${id}-hint` : undefined;
  const hasError = error !== undefined && error !== null && error !== false && error !== '';
  const errorId = hasError ? `${id}-error` : undefined;

  return (
    <FieldContext.Provider value={{ id, hintId, errorId, invalid: hasError, required, disabled }}>
      <div className={cn('flex flex-col gap-1.5', disabled && 'opacity-70', className)}>
        <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
          <label htmlFor={id} className="text-sm font-medium text-ink">
            {label}
            {required ? (
              <span className="ml-0.5 text-danger" aria-hidden="true">
                *
              </span>
            ) : null}
            {optional ? <span className="ml-1.5 text-xs font-normal text-muted">({t('common.field.optional')})</span> : null}
          </label>
          {labelAside ? <div className="text-xs text-muted">{labelAside}</div> : null}
        </div>
        {children}
        {hasError ? (
          <p id={errorId} className="flex items-start gap-1.5 text-[0.8125rem] text-danger" role="alert">
            <CircleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </p>
        ) : null}
        {hint ? (
          <p id={hintId} className="text-[0.8125rem] leading-snug text-muted">
            {hint}
          </p>
        ) : null}
      </div>
    </FieldContext.Provider>
  );
}
