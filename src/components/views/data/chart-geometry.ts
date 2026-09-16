/**
 * Geometry for the hand-made SVG charts (owner: views-data). Pure, unit-tested.
 */

export interface RingSegment {
  /** index into the input values */
  index: number;
  /** dash length along the circumference (px), gap already removed */
  length: number;
  /** distance from the 12 o'clock start to the segment start (px) */
  offset: number;
  /** 0..1 of the whole */
  fraction: number;
}

/**
 * Segments of a ring drawn with `stroke-dasharray` on a circle (rotated so 0 is at 12 o'clock).
 * Each segment is shortened by `gap` px (half at each end) so neighbours are separated by the
 * surface; a single non-zero segment is drawn as a full ring without a gap. Zero values are skipped.
 */
export function ringSegments(values: readonly number[], circumference: number, gap = 2): RingSegment[] {
  const total = values.reduce((s, v) => s + (v > 0 ? v : 0), 0);
  if (total <= 0 || circumference <= 0) return [];
  const nonZero = values.filter((v) => v > 0).length;
  const segments: RingSegment[] = [];
  let acc = 0;
  values.forEach((v, index) => {
    if (v <= 0) return;
    const fraction = v / total;
    const span = fraction * circumference;
    if (nonZero === 1) {
      segments.push({ index, length: circumference, offset: 0, fraction });
    } else {
      // tiny slices keep a visible sliver instead of vanishing behind the gap
      const length = Math.max(Math.min(1.5, span), span - gap);
      segments.push({ index, length, offset: acc + (span - length) / 2, fraction });
    }
    acc += span;
  });
  return segments;
}

export function circumference(r: number): number {
  return 2 * Math.PI * r;
}

const NICE_STEPS = [1, 2, 5];

/**
 * Integer count axis: the smallest "nice" step (1, 2, 5, 10, 20, 50 …) that needs at most
 * `maxTicks` intervals to reach `max`; ticks run from 0 to `top` (inclusive).
 */
export function countAxis(max: number, maxTicks = 4): { top: number; step: number; ticks: number[] } {
  const m = Number.isFinite(max) && max > 0 ? Math.ceil(max) : 1;
  const intervals = Math.max(1, Math.floor(maxTicks));
  let step = 1;
  for (let exp = 0; ; exp++) {
    const found = NICE_STEPS.map((b) => b * 10 ** exp).find((s) => Math.ceil(m / s) <= intervals);
    if (found !== undefined) {
      step = found;
      break;
    }
  }
  const top = Math.ceil(m / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  return { top, step, ticks };
}

/**
 * Which x-axis labels to print so they do not collide: every `stride`-th label, always the last.
 * `labelWidth` is the estimated label width in px, `slot` the column pitch in px.
 */
export function labelStride(labelWidth: number, slot: number): number {
  if (slot <= 0) return 1;
  return Math.max(1, Math.ceil((labelWidth + 6) / slot));
}

/** true when label `index` of `count` is printed with the given stride (counted from the last label). */
export function showsLabel(index: number, count: number, stride: number): boolean {
  if (index < 0 || index >= count) return false;
  return (count - 1 - index) % Math.max(1, Math.floor(stride)) === 0;
}

export interface BarBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

function fmt(v: number): string {
  return String(Math.round(v * 100) / 100);
}

/**
 * SVG path of a bar with a rounded data end and a square baseline (the chart mark spec).
 * `up`: a column whose baseline is the bottom edge (rounded top corners).
 * `right`: a horizontal bar whose baseline is the left edge (rounded right corners).
 * The radius shrinks for small bars so the corners never overlap. Empty for empty boxes.
 */
export function barPath({ x, y, width, height }: BarBox, radius: number, orient: 'up' | 'right'): string {
  if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) return '';
  const r = Math.max(0, orient === 'up' ? Math.min(radius, width / 2, height) : Math.min(radius, height / 2, width));
  const x1 = x + width;
  const y1 = y + height;
  if (orient === 'up') {
    if (r === 0) return `M${fmt(x)},${fmt(y1)}V${fmt(y)}H${fmt(x1)}V${fmt(y1)}Z`;
    return (
      `M${fmt(x)},${fmt(y1)}V${fmt(y + r)}A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(x + r)},${fmt(y)}` +
      `H${fmt(x1 - r)}A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(x1)},${fmt(y + r)}V${fmt(y1)}Z`
    );
  }
  if (r === 0) return `M${fmt(x)},${fmt(y)}H${fmt(x1)}V${fmt(y1)}H${fmt(x)}Z`;
  return (
    `M${fmt(x)},${fmt(y)}H${fmt(x1 - r)}A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(x1)},${fmt(y + r)}` +
    `V${fmt(y1 - r)}A${fmt(r)},${fmt(r)} 0 0 1 ${fmt(x1 - r)},${fmt(y1)}H${fmt(x)}Z`
  );
}

/** Keeps a tooltip of `width` px inside [0, containerWidth] when centred on `x`. */
export function clampTooltipX(x: number, width: number, containerWidth: number): number {
  const half = width / 2;
  if (containerWidth <= width) return containerWidth / 2;
  return Math.min(containerWidth - half, Math.max(half, x));
}
