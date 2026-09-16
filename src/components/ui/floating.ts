/**
 * Pure positioning maths for floating layers (Tooltip, Popover, DropdownMenu).
 * Places a floating box next to an anchor rect, flips to the opposite side when there is
 * not enough room, and shifts along the cross axis to stay inside the viewport.
 */
export type Side = 'top' | 'right' | 'bottom' | 'left';
export type Align = 'start' | 'center' | 'end';

export interface RectLike {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface FloatingOptions {
  side: Side;
  align: Align;
  /** gap between anchor and floating box (px) */
  offset: number;
  /** minimum distance to the viewport edge (px) */
  padding: number;
  viewport: { width: number; height: number };
}

export interface FloatingPosition {
  x: number;
  y: number;
  side: Side;
  /** available space on the main axis for the chosen side (use as max-height / max-width) */
  available: number;
}

const OPPOSITE: Record<Side, Side> = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' };

function spaceOn(side: Side, a: RectLike, o: FloatingOptions): number {
  switch (side) {
    case 'top':
      return a.top - o.offset - o.padding;
    case 'bottom':
      return o.viewport.height - (a.top + a.height) - o.offset - o.padding;
    case 'left':
      return a.left - o.offset - o.padding;
    case 'right':
      return o.viewport.width - (a.left + a.width) - o.offset - o.padding;
  }
}

function clamp(v: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(max, Math.max(min, v));
}

export function computeFloatingPosition(
  anchor: RectLike,
  floating: { width: number; height: number },
  opts: FloatingOptions,
): FloatingPosition {
  const vertical = opts.side === 'top' || opts.side === 'bottom';
  const need = vertical ? floating.height : floating.width;
  let side = opts.side;
  if (spaceOn(side, anchor, opts) < need) {
    const opposite = OPPOSITE[side];
    const here = spaceOn(side, anchor, opts);
    const there = spaceOn(opposite, anchor, opts);
    if (there >= need || there > here) side = opposite;
  }

  let x: number;
  let y: number;
  if (side === 'top' || side === 'bottom') {
    y = side === 'top' ? anchor.top - opts.offset - floating.height : anchor.top + anchor.height + opts.offset;
    if (opts.align === 'start') x = anchor.left;
    else if (opts.align === 'end') x = anchor.left + anchor.width - floating.width;
    else x = anchor.left + anchor.width / 2 - floating.width / 2;
    x = clamp(x, opts.padding, opts.viewport.width - floating.width - opts.padding);
    y = clamp(y, opts.padding, Math.max(opts.padding, opts.viewport.height - floating.height - opts.padding));
  } else {
    x = side === 'left' ? anchor.left - opts.offset - floating.width : anchor.left + anchor.width + opts.offset;
    if (opts.align === 'start') y = anchor.top;
    else if (opts.align === 'end') y = anchor.top + anchor.height - floating.height;
    else y = anchor.top + anchor.height / 2 - floating.height / 2;
    y = clamp(y, opts.padding, opts.viewport.height - floating.height - opts.padding);
    x = clamp(x, opts.padding, Math.max(opts.padding, opts.viewport.width - floating.width - opts.padding));
  }
  return { x: Math.round(x), y: Math.round(y), side, available: Math.max(0, Math.floor(spaceOn(side, anchor, opts))) };
}
