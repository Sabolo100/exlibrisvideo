import type { ReactNode } from 'react';
import { cn } from '@/components/ui/cn';

/**
 * The look of the big dashed "zone" inside a bookplate card on the landing page. The upload drop zone and the
 * phone / QR-code card next to it are two ways of doing the same thing, so they are built from the same pieces
 * and look like twins. Pure presentation (no hooks): server and client components both use it.
 * Everything responds to the width of the zone's `@container`, not to the viewport – the two cards are half
 * the page wide on a desktop and full width on a tablet.
 */

/** the dashed frame; the colours come from `heroZoneIdle` / the drag state of the drop zone */
export const heroZoneFrame =
  'relative flex flex-1 flex-col items-center justify-center rounded-[calc(var(--radius-card)-4px)] border-2 border-dashed text-center ' +
  'transition-[border-color,background-color,box-shadow] duration-200 gap-3.5 px-4 py-6 @sm:gap-4 @sm:px-8 @sm:py-9';
export const heroZoneIdle = 'border-[color-mix(in_oklab,var(--line),var(--accent)_35%)] bg-surface-2/40';

export const heroZoneTitle = 'font-display text-2xl font-semibold text-balance text-ink @md:text-[1.75rem]';
export const heroZoneText = 'max-w-md text-[0.9375rem] text-pretty text-muted';
export const heroZoneNote = 'max-w-md text-xs text-muted';

/** the round gold icon at the top of a zone */
export function HeroZoneIcon({ children, active = false, className }: { children: ReactNode; active?: boolean; className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'flex size-12 shrink-0 items-center justify-center rounded-full bg-accent-soft text-accent ring-1 ring-accent/25 [&_svg]:size-6 @sm:size-14 @sm:[&_svg]:size-7',
        active && 'scale-110 transition-transform',
        className,
      )}
    >
      {children}
    </span>
  );
}
