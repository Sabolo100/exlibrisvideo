'use client';

import { ArrowRight, Hash } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition, type FormEvent } from 'react';
import { useI18n } from '@/i18n/client';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Input } from '@/components/ui/Input';
import { cn } from '@/components/ui/cn';
import { collectionRefHref, parseCollectionRef } from './collection-ref';

export interface OpenByIdFormProps {
  className?: string;
  /** visually hide the field label (when a heading right above says the same) */
  hideLabel?: boolean;
  autoFocus?: boolean;
  /** inline: field and button side by side from `sm` up (wide containers); stacked: always one below the other */
  layout?: 'inline' | 'stacked';
}

/** "Open by id" box: a 9-digit id or a pasted catalogue / owner / recovery link → navigates there. */
export function OpenByIdForm({ className, hideLabel = false, autoFocus = false, layout = 'inline' }: OpenByIdFormProps) {
  const inline = layout === 'inline';
  const { t } = useI18n();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) {
      setError(t('my.open.required'));
      inputRef.current?.focus();
      return;
    }
    const ref = parseCollectionRef(value);
    if (!ref) {
      setError(t('my.open.invalid'));
      inputRef.current?.focus();
      return;
    }
    setError(null);
    startTransition(() => router.push(collectionRefHref(ref)));
  };

  return (
    <form onSubmit={submit} noValidate className={cn('flex flex-col gap-3', inline && 'sm:flex-row sm:items-start', className)}>
      <Field label={t('my.open.label')} hint={t('my.open.hint')} error={error} hideLabel={hideLabel} className="min-w-0 flex-1">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError(null);
          }}
          leftIcon={<Hash />}
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          enterKeyHint="go"
          maxLength={512}
          autoFocus={autoFocus}
          placeholder={t('my.open.placeholder')}
        />
      </Field>
      <Button
        type="submit"
        variant="primary"
        rightIcon={<ArrowRight />}
        loading={pending}
        className={cn('shrink-0', inline ? !hideLabel && 'sm:mt-7' : 'self-start')}
      >
        {t('my.open.submit')}
      </Button>
    </form>
  );
}
