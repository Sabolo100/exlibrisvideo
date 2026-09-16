'use client';

import { useEffect, useRef, useState } from 'react';
import { Input } from '@/components/ui';
import { VisuallyHidden } from '@/components/ui';

export type EditFinish = 'keyboard' | 'blur';

export interface InlineTextEditorProps {
  initial: string;
  /** accessible name of the input */
  label: string;
  placeholder?: string;
  /** an empty value cannot be saved (Enter shows the error, blur reverts) */
  required?: boolean;
  requiredMessage?: string;
  maxLength?: number;
  onSubmit: (value: string, via: EditFinish) => void;
  onCancel: (via: EditFinish) => void;
}

/**
 * Single-line editor used inside table cells: focuses and selects on mount, Enter saves,
 * Esc cancels, leaving the field saves (or reverts an empty required value).
 */
export function InlineTextEditor({
  initial,
  label,
  placeholder,
  required = false,
  requiredMessage,
  maxLength = 500,
  onSubmit,
  onCancel,
}: InlineTextEditorProps) {
  const [value, setValue] = useState(initial);
  const [invalid, setInvalid] = useState(false);
  const finished = useRef(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.select();
  }, []);

  const submit = (via: EditFinish) => {
    if (finished.current) return;
    if (required && !value.trim()) {
      if (via === 'blur') {
        finished.current = true;
        onCancel(via);
        return;
      }
      setInvalid(true);
      inputRef.current?.focus();
      return;
    }
    finished.current = true;
    onSubmit(value, via);
  };

  const cancel = (via: EditFinish) => {
    if (finished.current) return;
    finished.current = true;
    onCancel(via);
  };

  return (
    <span className="relative block w-full" data-row-ignore="">
      <Input
        ref={inputRef}
        size="sm"
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        aria-label={label}
        aria-invalid={invalid || undefined}
        title={invalid ? requiredMessage : undefined}
        onChange={(e) => {
          setValue(e.target.value);
          if (invalid) setInvalid(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            e.stopPropagation();
            submit('keyboard');
          } else if (e.key === 'Escape') {
            e.preventDefault();
            e.stopPropagation();
            cancel('keyboard');
          }
        }}
        onBlur={() => submit('blur')}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
      />
      {invalid && requiredMessage ? (
        <VisuallyHidden role="alert">{requiredMessage}</VisuallyHidden>
      ) : null}
    </span>
  );
}
