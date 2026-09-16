/**
 * Identifiers, secrets, signatures and PIN hashing (SPEC §2). Server-only (owner: api).
 *
 *  owner cookie   = b64url(HMAC-SHA256(APP_SECRET, "own:" + id + ":" + ownerTokenHash))
 *  PIN cookie     = b64url(HMAC-SHA256(APP_SECRET, "pin:" + id + ":" + pinHash))
 *  recovery value = "<expUnixSeconds>.<b64url(HMAC-SHA256(APP_SECRET, "rec:" + id + ":" + exp + ":" + ownerTokenHash))>"
 *  PIN hash       = "<saltHex>:<scryptHashHex>"
 */
import crypto from 'node:crypto';
import { env } from '@/lib/env';

export const COLLECTION_ID_RE = /^[1-9][0-9]{8}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isCollectionId(id: unknown): id is string {
  return typeof id === 'string' && COLLECTION_ID_RE.test(id);
}

export function isUuid(id: unknown): id is string {
  return typeof id === 'string' && UUID_RE.test(id);
}

/** Random 9-digit id, first digit 1-9 (100000000–999999999). Caller retries on unique violation. */
export function newCollectionId(): string {
  return String(crypto.randomInt(100_000_000, 1_000_000_000));
}

/** 32 random bytes, base64url (43 chars). Only its sha256 is stored. */
export function newOwnerToken(): string {
  return crypto.randomBytes(32).toString('base64url');
}

export function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

const DEFAULT_SECRET = 'dev-secret-change-me-please-0123456789';
let warnedAboutSecret = false;

function appSecret(): string {
  const e = env();
  if (!warnedAboutSecret && e.NODE_ENV === 'production' && (e.APP_SECRET === DEFAULT_SECRET || e.APP_SECRET.length < 16)) {
    warnedAboutSecret = true;
    console.error('[security] APP_SECRET is missing or too short in production – set a long random value');
  }
  return e.APP_SECRET;
}

/** base64url(HMAC-SHA256(APP_SECRET, message)) */
export function hmacB64url(message: string): string {
  return crypto.createHmac('sha256', appSecret()).update(message, 'utf8').digest('base64url');
}

/** Constant-time string comparison (length-independent: compares sha256 digests). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ha = crypto.createHash('sha256').update(a, 'utf8').digest();
  const hb = crypto.createHash('sha256').update(b, 'utf8').digest();
  return crypto.timingSafeEqual(ha, hb);
}

/* ------------------------------------------------------------------ */
/* PIN hashing (scrypt)                                                 */
/* ------------------------------------------------------------------ */

export const PIN_RE = /^[0-9]{4,8}$/;
const SCRYPT_KEYLEN = 32;
const SCRYPT_OPTIONS: crypto.ScryptOptions = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEYLEN, SCRYPT_OPTIONS, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === 'string' && PIN_RE.test(pin);
}

/** "saltHex:hashHex" with a random 16-byte salt. */
export async function hashPin(pin: string): Promise<string> {
  if (!isValidPin(pin)) throw new Error('PIN must be 4-8 digits');
  const salt = crypto.randomBytes(16);
  const hash = await scryptAsync(pin, salt);
  return `${salt.toString('hex')}:${hash.toString('hex')}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || typeof pin !== 'string' || pin.length > 64) return false;
  const m = /^([0-9a-f]{32}):([0-9a-f]{64})$/.exec(stored);
  if (!m) return false;
  const salt = Buffer.from(m[1], 'hex');
  const expected = Buffer.from(m[2], 'hex');
  const actual = await scryptAsync(pin, salt);
  // Always run the derivation (even for non-digit input) so timing does not reveal the format check.
  return crypto.timingSafeEqual(actual, expected) && PIN_RE.test(pin);
}

/* ------------------------------------------------------------------ */
/* Cookie values & recovery links                                       */
/* ------------------------------------------------------------------ */

export function ownerCookieValue(collectionId: string, ownerTokenHash: string): string {
  return hmacB64url(`own:${collectionId}:${ownerTokenHash}`);
}

export function pinCookieValue(collectionId: string, pinHash: string): string {
  return hmacB64url(`pin:${collectionId}:${pinHash}`);
}

/** True when `token` is the raw owner token of a collection whose stored hash is `ownerTokenHash`. */
export function verifyOwnerToken(token: string, ownerTokenHash: string): boolean {
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) return false;
  return timingSafeEqualStr(sha256Hex(token), ownerTokenHash);
}

/** "<exp>.<sig>" – exp in Unix seconds. */
export function signRecovery(collectionId: string, ownerTokenHash: string, exp: number): string {
  const e = Math.floor(exp);
  return `${e}.${hmacB64url(`rec:${collectionId}:${e}:${ownerTokenHash}`)}`;
}

export type RecoveryCheck = 'ok' | 'invalid' | 'expired';

export function verifyRecovery(
  collectionId: string,
  ownerTokenHash: string,
  value: string,
  nowSec: number = Math.floor(Date.now() / 1000),
): RecoveryCheck {
  if (typeof value !== 'string') return 'invalid';
  const m = /^([0-9]{1,12})\.([A-Za-z0-9_-]{43})$/.exec(value);
  if (!m) return 'invalid';
  const exp = Number(m[1]);
  const expected = hmacB64url(`rec:${collectionId}:${exp}:${ownerTokenHash}`);
  if (!timingSafeEqualStr(m[2], expected)) return 'invalid';
  return exp > nowSec ? 'ok' : 'expired';
}
