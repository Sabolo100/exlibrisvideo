/**
 * Parses what people type or paste into an "open by id" box (pure – unit tested):
 *   334345435 · 334 345 435 · 334-345-435
 *   https://www.exlibrisvideo.hu/334345435 · exlibrisvideo.hu/334345435?k=<owner token> · /334345435?r=<exp>.<sig>
 */
export const COLLECTION_ID_RE = /^[1-9]\d{8}$/;

export interface CollectionRef {
  id: string;
  /** owner token from a pasted owner link (?k=) */
  token?: string;
  /** signed recovery claim from a pasted recovery link (?r=) */
  recovery?: string;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{16,128}$/;
const RECOVERY_RE = /^\d{9,12}\.[A-Za-z0-9_-]{16,128}$/;

function fromUrl(raw: string): CollectionRef | null {
  let url: URL;
  try {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : raw.startsWith('/') ? `https://x.invalid${raw}` : `https://${raw}`;
    url = new URL(withScheme);
  } catch {
    return null;
  }
  const id = url.pathname.split('/').find((segment) => COLLECTION_ID_RE.test(segment));
  if (!id) return null;
  const ref: CollectionRef = { id };
  const k = url.searchParams.get('k');
  const r = url.searchParams.get('r');
  if (k && TOKEN_RE.test(k)) ref.token = k;
  else if (r && RECOVERY_RE.test(r)) ref.recovery = r;
  return ref;
}

export function parseCollectionRef(input: string): CollectionRef | null {
  const raw = input.trim();
  if (!raw) return null;

  // digits with optional separators
  if (/^[\d\s.\-–]+$/.test(raw)) {
    const digits = raw.replace(/\D/g, '');
    return COLLECTION_ID_RE.test(digits) ? { id: digits } : null;
  }

  if (/[/?#]/.test(raw) || /^[a-z0-9-]+(\.[a-z0-9-]+)+/i.test(raw)) {
    const ref = fromUrl(raw);
    if (ref) return ref;
  }

  // anything else: a lone 9-digit number somewhere in the text (e.g. "katalógus #334345435")
  const match = /(?:^|\D)([1-9]\d{8})(?!\d)/.exec(raw);
  return match ? { id: match[1] } : null;
}

/** The in-app path that opens the reference (owner / recovery claims keep their parameter). */
export function collectionRefHref(ref: CollectionRef): string {
  if (ref.token) return `/${ref.id}?k=${encodeURIComponent(ref.token)}`;
  if (ref.recovery) return `/${ref.id}?r=${encodeURIComponent(ref.recovery)}`;
  return `/${ref.id}`;
}
