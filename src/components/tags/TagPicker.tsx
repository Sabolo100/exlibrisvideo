'use client';

/**
 * Owner's tags (of a recording or a book): the chosen ones, the earlier tags of the library offered as
 * one-tap chips, a field for a new tag – and a short hint about what tags are good for.
 */
import { Lightbulb, Plus, Tag } from 'lucide-react';
import { useId, useState, type KeyboardEvent } from 'react';
import { Button, Chip, cn } from '@/components/ui';
import { useI18n } from '@/i18n/client';
import { MAX_TAG_LENGTH, MAX_TAGS, addTag, removeTag, sameTag } from './tag-utils';

export interface TagPickerProps {
  value: readonly string[];
  onChange: (tags: string[]) => void;
  /** earlier tags of the library, most used first */
  suggestions?: readonly string[];
  label?: string;
  /** hide the "what are tags for" hint (e.g. when it is shown nearby already) */
  hideHint?: boolean;
  /** the hint text (default: tags of a recording) */
  hint?: string;
  disabled?: boolean;
  className?: string;
}

export function TagPicker({ value, onChange, suggestions = [], label, hideHint = false, hint, disabled = false, className }: TagPickerProps) {
  const { t } = useI18n();
  const inputId = useId();
  const hintId = useId();
  const [draft, setDraft] = useState('');
  const offered = suggestions.filter((s) => !value.some((v) => sameTag(v, s))).slice(0, 12);
  const full = value.length >= MAX_TAGS;

  const commit = () => {
    const next = addTag(value, draft);
    if (next !== value) onChange(next);
    setDraft('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      <label htmlFor={inputId} className="flex items-center gap-1.5 text-sm font-medium text-ink">
        <Tag aria-hidden="true" className="size-4 text-accent" />
        {label ?? t('collection.tags.label')}
        <span className="font-normal text-muted">{t('collection.tags.optional')}</span>
      </label>
      {!hideHint ? (
        <p id={hintId} className="flex gap-1.5 text-xs leading-relaxed text-muted text-pretty">
          <Lightbulb aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-accent" />
          {hint ?? t('collection.tags.hint')}
        </p>
      ) : null}

      {value.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label={t('collection.tags.selected')}>
          {value.map((tag) => (
            <li key={tag}>
              <Chip
                size="sm"
                selected
                disabled={disabled}
                onRemove={disabled ? undefined : () => onChange(removeTag(value, tag))}
                removeLabel={t('collection.tags.remove', { tag })}
              >
                {tag}
              </Chip>
            </li>
          ))}
        </ul>
      ) : null}

      {offered.length > 0 && !full ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted">{t('collection.tags.earlier')}</span>
          {offered.map((tag) => (
            <Chip key={tag} size="sm" icon={<Plus />} disabled={disabled} onClick={() => onChange(addTag(value, tag))}>
              {tag}
            </Chip>
          ))}
        </div>
      ) : null}

      {!full ? (
        <div className="flex gap-2">
          <input
            id={inputId}
            value={draft}
            maxLength={MAX_TAG_LENGTH}
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            onBlur={() => draft.trim() && commit()}
            placeholder={t('collection.tags.placeholder')}
            aria-describedby={hideHint ? undefined : hintId}
            enterKeyHint="done"
            autoComplete="off"
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-muted/80 focus:border-primary focus:outline-none"
          />
          <Button size="sm" variant="secondary" leftIcon={<Plus />} disabled={disabled || !draft.trim()} onClick={commit} className="h-9">
            {t('collection.tags.add')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
