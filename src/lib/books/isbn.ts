/**
 * ISBN helpers: clean-up, checksums, ISBN-10 → ISBN-13. Pure (client and server).
 */

/** EAN-13 check digit of the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(first12[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(code: string): boolean {
  return /^\d{13}$/.test(code) && ean13CheckDigit(code.slice(0, 12)) === Number(code[12]);
}

function isValidIsbn10(code: string): boolean {
  if (!/^\d{9}[\dX]$/.test(code)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) sum += (code[i] === 'X' ? 10 : Number(code[i])) * (10 - i);
  return sum % 11 === 0;
}

/**
 * A valid ISBN-13 (978/979…) from anything that holds one: "978-963-07-1234-5", an ISBN-10, "ISBN 963…".
 * null when the digits do not form a valid ISBN.
 */
export function toIsbn13(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const code = raw.toUpperCase().replace(/^ISBN[-:\s]*/, '').replace(/[^0-9X]/g, '');
  if (code.length === 13) return /^97[89]/.test(code) && isValidEan13(code) ? code : null;
  if (code.length === 10 && isValidIsbn10(code)) {
    const first12 = `978${code.slice(0, 9)}`;
    return `${first12}${ean13CheckDigit(first12)}`;
  }
  return null;
}

/** "9789630712345" → "978-963-07-1234-5"-like grouping is publisher dependent; we show 978-… only. */
export function formatIsbn(isbn13: string): string {
  return /^\d{13}$/.test(isbn13) ? `${isbn13.slice(0, 3)}-${isbn13.slice(3)}` : isbn13;
}
