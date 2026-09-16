'use client';

import { useCallback, useRef, type ComponentPropsWithRef, type Ref } from 'react';
import { cn } from './cn';
import { useFieldControlProps } from './Field';
import { useIsoLayoutEffect } from './hooks';
import { CONTROL_BASE } from './Input';

export type TextareaProps = ComponentPropsWithRef<'textarea'> & {
  /** grow with the content between `minRows` and `maxRows` */
  autoResize?: boolean;
  minRows?: number;
  maxRows?: number;
};

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (!ref) return;
  if (typeof ref === 'function') ref(value);
  else (ref as { current: T | null }).current = value;
}

/** Multi-line text input; inside <Field> it is wired automatically. */
export function Textarea(props: TextareaProps) {
  const { autoResize = false, minRows = 3, maxRows = 12, className, ref, rows, onInput, ...rest } = useFieldControlProps(props);
  const inner = useRef<HTMLTextAreaElement | null>(null);

  const resize = useCallback(() => {
    const el = inner.current;
    if (!el || !autoResize) return;
    const style = getComputedStyle(el);
    const line = Number.parseFloat(style.lineHeight) || 24;
    const padding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
    const border = Number.parseFloat(style.borderTopWidth) + Number.parseFloat(style.borderBottomWidth);
    const min = line * minRows + padding + border;
    const max = line * maxRows + padding + border;
    el.style.height = 'auto';
    // scrollHeight includes padding but not borders
    const content = el.scrollHeight + border;
    el.style.height = `${Math.min(Math.max(content, min), max)}px`;
    el.style.overflowY = content > max ? 'auto' : 'hidden';
  }, [autoResize, minRows, maxRows]);

  useIsoLayoutEffect(() => {
    resize();
  }, [resize, rest.value]);

  return (
    <textarea
      ref={(el) => {
        inner.current = el;
        assignRef(ref, el);
      }}
      rows={rows ?? minRows}
      onInput={(e) => {
        onInput?.(e);
        resize();
      }}
      className={cn(CONTROL_BASE, 'min-h-[4.5rem] px-3 py-2 text-[0.9375rem] leading-relaxed', autoResize ? 'resize-none' : 'resize-y', className)}
      {...rest}
    />
  );
}
