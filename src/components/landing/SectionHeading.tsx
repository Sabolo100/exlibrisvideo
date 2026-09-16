import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

export interface SectionHeadingProps {
  id: string;
  eyebrow: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  align?: 'center' | 'start';
  className?: string;
}

/** Eyebrow + Fraunces title (+ lead) used by every landing section. Server-safe. */
export function SectionHeading({ id, eyebrow, title, lead, align = 'center', className }: SectionHeadingProps) {
  return (
    <div className={cn('flex flex-col gap-2', align === 'center' ? 'mx-auto max-w-2xl items-center text-center' : 'max-w-2xl', className)}>
      <p className="text-xs font-semibold tracking-[0.16em] text-accent uppercase">{eyebrow}</p>
      <h2 id={id} className="font-display text-3xl leading-tight font-semibold text-ink text-balance sm:text-4xl">
        {title}
      </h2>
      {lead ? <p className="text-base leading-relaxed text-muted text-pretty sm:text-lg">{lead}</p> : null}
    </div>
  );
}
