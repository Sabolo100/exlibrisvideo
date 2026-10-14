import type { CSSProperties } from 'react';
import { LogoMark } from '@/components/site/Logo';

/** "Ex Libris" letter by letter; `i` is the stagger step (spaces are left out) */
const GLYPHS = (() => {
  let step = 0;
  return Array.from('Ex Libris').map((ch) => ({ ch, i: ch === ' ' ? -1 : step++ }));
})();

/**
 * The brand name written out once more, large and centred at the very top of the landing page: the bookplate
 * mark, "Ex Libris" in ink, "Video" in gilt italics, "by DarwinAI" between two gold rules. The reveal
 * (stamp, letters rising out of a blur, a gold glint) is pure CSS – see the `.wm-*` rules in globals.css – so it
 * runs on first paint and costs no JavaScript. The product name is repeated in the header and the h1 is the
 * headline, so this block is a title card: the letters are hidden from assistive tech and read once as a whole.
 */
export function HeroWordmark() {
  return (
    <div className="relative isolate flex w-full flex-col items-center">
      {/* lamp light behind the title */}
      <div
        aria-hidden="true"
        className="wm-halo pointer-events-none absolute top-[46%] left-1/2 -z-10 h-56 w-[min(94vw,62rem)] -translate-x-1/2 -translate-y-1/2 bg-[radial-gradient(closest-side,color-mix(in_oklab,var(--accent)_24%,transparent),transparent)] sm:h-72"
      />
      <LogoMark className="wm-stamp h-12 w-auto drop-shadow-[0_6px_14px_hsl(var(--shadow-color)/0.28)] sm:h-[4.25rem]" />
      <p className="mt-3 font-display text-[clamp(2.25rem,10vw,7.25rem)] leading-[0.98] tracking-[-0.02em] whitespace-nowrap text-ink sm:mt-4">
        <span className="sr-only">Ex Libris Video</span>
        <span aria-hidden="true" className="font-semibold">
          {GLYPHS.map(({ ch, i }, key) =>
            i < 0 ? (
              ' '
            ) : (
              <span key={key} className="wm-letter" style={{ '--i': i } as CSSProperties}>
                {ch}
              </span>
            ),
          )}
        </span>{' '}
        <span aria-hidden="true" className="wm-gilt font-normal italic">
          Video
        </span>
      </p>
      <p className="mt-3 flex items-center gap-3 text-base text-muted sm:mt-4 sm:gap-4">
        <span aria-hidden="true" className="wm-rule h-px w-10 bg-gradient-to-r from-transparent to-accent/80 sm:w-24" />
        <span className="wm-by font-display italic tracking-wide">
          by{' '}
          <a
            href="https://www.darwinai.hu"
            target="_blank"
            rel="noopener"
            className="rounded-sm font-medium text-ink not-italic decoration-accent/60 underline-offset-4 hover:underline"
          >
            DarwinAI
          </a>
        </span>
        <span aria-hidden="true" className="wm-rule wm-rule-r h-px w-10 bg-gradient-to-l from-transparent to-accent/80 sm:w-24" />
      </p>
    </div>
  );
}
