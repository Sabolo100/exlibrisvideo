import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cn } from './cn';

export type BadgeTone = 'neutral' | 'green' | 'gold' | 'red' | 'blue';

/** Tone classes shared with Chip / status components (text + tinted background + hairline border). */
export const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-2 text-muted',
  green:
    'border-[color-mix(in_oklab,var(--success)_28%,transparent)] bg-[color-mix(in_oklab,var(--success)_12%,var(--surface))] text-[#23613d] dark:text-success',
  gold: 'border-[color-mix(in_oklab,var(--accent)_35%,transparent)] bg-accent-soft text-[#7a561b] dark:text-accent',
  red: 'border-[color-mix(in_oklab,var(--danger)_28%,transparent)] bg-[color-mix(in_oklab,var(--danger)_10%,var(--surface))] text-[#9a2019] dark:text-danger',
  blue: 'border-[#2f5f8a]/25 bg-[#2f5f8a]/10 text-[#244d73] dark:border-[#8fb4dc]/30 dark:bg-[#8fb4dc]/12 dark:text-[#a9c6e6]',
};

const DOT: Record<BadgeTone, string> = {
  neutral: 'bg-muted',
  green: 'bg-success',
  gold: 'bg-accent',
  red: 'bg-danger',
  blue: 'bg-[#2f6fa8] dark:bg-[#8fb4dc]',
};

export type BadgeProps = ComponentPropsWithRef<'span'> & {
  tone?: BadgeTone;
  size?: 'sm' | 'md';
  icon?: ReactNode;
  /** small coloured dot before the label */
  dot?: boolean;
};

/** Compact non-interactive label: status, counts, "new". */
export function Badge({ tone = 'neutral', size = 'md', icon, dot = false, className, children, ...rest }: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex max-w-full items-center gap-1 rounded-full border font-medium whitespace-nowrap [&_svg]:shrink-0',
        size === 'sm' ? 'h-5 px-1.5 text-[0.6875rem] [&_svg]:size-3' : 'h-6 px-2 text-xs [&_svg]:size-3.5',
        TONE_CLASSES[tone],
        className,
      )}
      {...rest}
    >
      {dot ? <span aria-hidden="true" className={cn('size-1.5 rounded-full', DOT[tone])} /> : null}
      {icon}
      {children !== undefined && children !== null ? <span className="truncate">{children}</span> : null}
    </span>
  );
}
