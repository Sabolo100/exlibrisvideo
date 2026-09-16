/**
 * Joins class names, skipping everything that is not a non-empty string.
 *   cn('px-2', active && 'bg-primary', undefined) → "px-2 bg-primary"
 * There is no tailwind-merge in this project: pass layout classes (margin, width, flex) via
 * `className`, and use component props (variant, size, tone) for intrinsic looks.
 */
export type ClassValue = string | number | bigint | boolean | null | undefined;

export function cn(...values: ClassValue[]): string {
  let out = '';
  for (const v of values) {
    if (typeof v !== 'string' || !v) continue;
    out = out ? `${out} ${v}` : v;
  }
  return out;
}
