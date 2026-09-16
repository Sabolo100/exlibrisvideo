/**
 * Settings dialog form → CollectionPatch (only changed fields) + client-side validation.
 * Mirrors the API rules (src/lib/collections/service.ts): `visibility: 'link'` clears the PIN,
 * `visibility: 'pin'` needs a new 4–8 digit PIN unless one is already set. Pure – unit-tested.
 */
import type { MessageKey } from '@/i18n';
import type { CollectionDTO, CollectionPatch, Locale, Visibility } from '@/lib/types';

export const SETTINGS_LIMITS = { title: 200, description: 2000, ownerName: 120, email: 254 } as const;

export interface SettingsForm {
  title: string;
  description: string;
  ownerName: string;
  email: string;
  locale: Locale;
  visibility: Visibility;
  /** new PIN; empty = keep the current one */
  pin: string;
}

export type SettingsField = 'title' | 'description' | 'ownerName' | 'email' | 'pin';

export interface SettingsError {
  key: MessageKey;
  vars?: Record<string, string | number>;
}

export const PIN_RE = /^\d{4,8}$/;

/** Keeps digits only, max 8 (a pasted "12 34" or "1234-5678" still works). */
export function sanitizePin(value: string): string {
  return value.replace(/\D+/g, '').slice(0, 8);
}
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function settingsFormFrom(c: Pick<CollectionDTO, 'title' | 'description' | 'ownerName' | 'email' | 'locale' | 'visibility'>): SettingsForm {
  return {
    title: c.title ?? '',
    description: c.description ?? '',
    ownerName: c.ownerName ?? '',
    email: c.email ?? '',
    locale: c.locale,
    visibility: c.visibility,
    pin: '',
  };
}

function oneLine(s: string): string | null {
  const v = s.replace(/\s+/g, ' ').trim();
  return v ? v : null;
}

function multiLine(s: string): string | null {
  const v = s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  return v ? v : null;
}

export function buildSettingsPatch(
  original: Pick<CollectionDTO, 'title' | 'description' | 'ownerName' | 'email' | 'locale' | 'visibility'>,
  form: SettingsForm,
): { patch: CollectionPatch; errors: Partial<Record<SettingsField, SettingsError>> } {
  const patch: CollectionPatch = {};
  const errors: Partial<Record<SettingsField, SettingsError>> = {};

  const title = oneLine(form.title);
  if (title && title.length > SETTINGS_LIMITS.title) {
    errors.title = { key: 'collection.settings.titleTooLong', vars: { max: SETTINGS_LIMITS.title } };
  } else if (title !== (original.title ? oneLine(original.title) : null)) {
    patch.title = title;
  }

  const description = multiLine(form.description);
  if (description && description.length > SETTINGS_LIMITS.description) {
    errors.description = { key: 'collection.settings.descriptionTooLong', vars: { max: SETTINGS_LIMITS.description } };
  } else if (description !== (original.description ? multiLine(original.description) : null)) {
    patch.description = description;
  }

  const ownerName = oneLine(form.ownerName);
  if (ownerName && ownerName.length > SETTINGS_LIMITS.ownerName) {
    errors.ownerName = { key: 'collection.settings.ownerNameTooLong', vars: { max: SETTINGS_LIMITS.ownerName } };
  } else if (ownerName !== (original.ownerName ? oneLine(original.ownerName) : null)) {
    patch.ownerName = ownerName;
  }

  const email = form.email.trim() || null;
  if (email && (email.length > SETTINGS_LIMITS.email || !EMAIL_RE.test(email))) {
    errors.email = { key: 'collection.email.invalid' };
  } else if ((email ?? '').toLowerCase() !== (original.email ?? '').trim().toLowerCase()) {
    patch.email = email;
  }

  if (form.locale !== original.locale) patch.locale = form.locale;

  const pin = form.pin.trim();
  if (form.visibility === 'link') {
    if (original.visibility === 'pin') patch.visibility = 'link';
  } else if (pin) {
    if (!PIN_RE.test(pin)) errors.pin = { key: 'collection.settings.pinFormat' };
    else {
      patch.visibility = 'pin';
      patch.pin = pin;
    }
  } else if (original.visibility !== 'pin') {
    errors.pin = { key: 'collection.settings.pinRequired' };
  }

  return { patch, errors };
}
