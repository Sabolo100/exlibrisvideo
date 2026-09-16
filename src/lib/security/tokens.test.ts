import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  hashPin,
  hmacB64url,
  isCollectionId,
  isUuid,
  newCollectionId,
  newOwnerToken,
  ownerCookieValue,
  pinCookieValue,
  sha256Hex,
  signRecovery,
  timingSafeEqualStr,
  verifyOwnerToken,
  verifyPin,
  verifyRecovery,
} from './tokens';

describe('ids and tokens', () => {
  it('newCollectionId returns 9 digits with a non-zero first digit', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 2000; i++) {
      const id = newCollectionId();
      expect(id).toMatch(/^[1-9][0-9]{8}$/);
      expect(isCollectionId(id)).toBe(true);
      const n = Number(id);
      expect(n).toBeGreaterThanOrEqual(100_000_000);
      expect(n).toBeLessThanOrEqual(999_999_999);
      seen.add(id);
    }
    expect(seen.size).toBeGreaterThan(1990);
  });

  it('isCollectionId rejects malformed ids', () => {
    for (const bad of ['012345678', '12345678', '1234567890', '12345678a', ' 123456789', '../123456', '']) {
      expect(isCollectionId(bad)).toBe(false);
    }
    expect(isCollectionId(123456789)).toBe(false);
  });

  it('isUuid', () => {
    expect(isUuid(crypto.randomUUID())).toBe(true);
    expect(isUuid('not-a-uuid')).toBe(false);
    expect(isUuid("00000000-0000-0000-0000-000000000000' OR 1=1")).toBe(false);
  });

  it('newOwnerToken is 32 random bytes as base64url', () => {
    const t = newOwnerToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(t, 'base64url')).toHaveLength(32);
    expect(newOwnerToken()).not.toBe(t);
  });

  it('sha256Hex / hmacB64url are deterministic', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(hmacB64url('x')).toBe(hmacB64url('x'));
    expect(hmacB64url('x')).not.toBe(hmacB64url('y'));
    expect(hmacB64url('x')).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('timingSafeEqualStr handles different lengths', () => {
    expect(timingSafeEqualStr('abc', 'abc')).toBe(true);
    expect(timingSafeEqualStr('abc', 'abd')).toBe(false);
    expect(timingSafeEqualStr('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualStr('', '')).toBe(true);
  });

  it('verifyOwnerToken compares against the stored hash', () => {
    const token = newOwnerToken();
    const hash = sha256Hex(token);
    expect(verifyOwnerToken(token, hash)).toBe(true);
    expect(verifyOwnerToken(newOwnerToken(), hash)).toBe(false);
    expect(verifyOwnerToken('', hash)).toBe(false);
    expect(verifyOwnerToken(hash, hash)).toBe(false);
  });
});

describe('PIN hashing', () => {
  it('hashes with a random salt as "salt:hash" hex and verifies', async () => {
    const h1 = await hashPin('1234');
    const h2 = await hashPin('1234');
    expect(h1).toMatch(/^[0-9a-f]{32}:[0-9a-f]{64}$/);
    expect(h1).not.toBe(h2);
    expect(await verifyPin('1234', h1)).toBe(true);
    expect(await verifyPin('1234', h2)).toBe(true);
    expect(await verifyPin('1235', h1)).toBe(false);
    expect(await verifyPin('12345', h1)).toBe(false);
  });

  it('rejects malformed input', async () => {
    await expect(hashPin('12')).rejects.toThrow();
    await expect(hashPin('123456789')).rejects.toThrow();
    await expect(hashPin('12a4')).rejects.toThrow();
    const h = await hashPin('87654321');
    expect(await verifyPin('87654321', h)).toBe(true);
    expect(await verifyPin('', h)).toBe(false);
    expect(await verifyPin('87654321', null)).toBe(false);
    expect(await verifyPin('87654321', 'garbage')).toBe(false);
    expect(await verifyPin('x'.repeat(100), h)).toBe(false);
  });
});

describe('cookie values', () => {
  it('owner cookie binds id and owner token hash', () => {
    const hash = sha256Hex('token');
    const v = ownerCookieValue('123456789', hash);
    expect(v).toBe(hmacB64url(`own:123456789:${hash}`));
    expect(ownerCookieValue('123456780', hash)).not.toBe(v);
    expect(ownerCookieValue('123456789', sha256Hex('other'))).not.toBe(v);
  });

  it('PIN cookie changes when the PIN hash changes', async () => {
    const a = pinCookieValue('123456789', await hashPin('1111'));
    const b = pinCookieValue('123456789', await hashPin('1111'));
    expect(a).not.toBe(b);
    expect(pinCookieValue('123456789', 'salt:hash')).toBe(hmacB64url('pin:123456789:salt:hash'));
  });
});

describe('recovery signatures', () => {
  const id = '334345435';
  const hash = sha256Hex('owner-token');
  const now = 1_800_000_000;

  it('signs "<exp>.<sig>" and verifies', () => {
    const value = signRecovery(id, hash, now + 3600);
    expect(value).toMatch(/^\d+\.[A-Za-z0-9_-]{43}$/);
    expect(value.split('.')[1]).toBe(hmacB64url(`rec:${id}:${now + 3600}:${hash}`));
    expect(verifyRecovery(id, hash, value, now)).toBe('ok');
  });

  it('detects expiry, tampering and wrong collection', () => {
    const value = signRecovery(id, hash, now + 10);
    expect(verifyRecovery(id, hash, value, now + 10)).toBe('expired');
    expect(verifyRecovery(id, hash, value, now + 11)).toBe('expired');
    const [exp, sig] = value.split('.');
    expect(verifyRecovery(id, hash, `${Number(exp) + 100000}.${sig}`, now)).toBe('invalid');
    expect(verifyRecovery('334345436', hash, value, now)).toBe('invalid');
    expect(verifyRecovery(id, sha256Hex('rotated'), value, now)).toBe('invalid');
    expect(verifyRecovery(id, hash, `${exp}.${sig.slice(0, -1)}A`, now)).toBe(sig.endsWith('A') ? 'ok' : 'invalid');
    for (const junk of ['', '.', 'abc.def', `${exp}`, `${exp}.${sig}.x`, `-1.${sig}`]) {
      expect(verifyRecovery(id, hash, junk, now)).toBe('invalid');
    }
  });
});
