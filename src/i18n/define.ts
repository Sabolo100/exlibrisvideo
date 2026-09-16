/**
 * Helper that forces the English dictionary to have exactly the same keys as the
 * Hungarian one (Hungarian is the source language).
 *
 * Keys are flat strings (dots allowed, e.g. "cta.upload"). Placeholders: {name}.
 * Plurals: add "<key>_one" next to "<key>" – tp() picks "_one" when count === 1.
 */
export function defineMessages<const H extends Record<string, string>>(m: {
  hu: H;
  en: { [K in keyof H]: string };
}) {
  return m;
}
