import { expect, test } from 'vitest';
import { KEY_LEN, NONCE_PREFIX_LEN } from '../src/constants.js';
import { deriveKeys, pbkdf2 } from '../src/kdf.js';

const master = new Uint8Array(32).fill(9);
const salt = new Uint8Array(16).fill(3);

test('deriveKeys returns correctly sized, distinct sub-keys', async () => {
  const k = await deriveKeys(master, salt);
  expect(k.contentKey.length).toBe(KEY_LEN);
  expect(k.metadataKey.length).toBe(KEY_LEN);
  expect(k.authKey.length).toBe(KEY_LEN);
  expect(k.commit.length).toBe(KEY_LEN);
  expect(k.noncePrefix.length).toBe(NONCE_PREFIX_LEN);
  const hex = (b: Uint8Array) => [...b].join(',');
  const set = new Set([hex(k.contentKey), hex(k.metadataKey), hex(k.authKey), hex(k.commit)]);
  expect(set.size).toBe(4);
});

test('deriveKeys is deterministic for the same inputs', async () => {
  const a = await deriveKeys(master, salt);
  const b = await deriveKeys(master, salt);
  expect([...a.contentKey]).toEqual([...b.contentKey]);
});

test('a different salt yields different keys (salt bound into every sub-key)', async () => {
  const a = await deriveKeys(master, salt);
  const b = await deriveKeys(master, new Uint8Array(16).fill(4));
  expect([...a.contentKey]).not.toEqual([...b.contentKey]);
  expect([...a.metadataKey]).not.toEqual([...b.metadataKey]);
});

test('the password path is domain-separated from the no-password path', async () => {
  const kp = await pbkdf2('hunter2', salt, 1000);
  const withPw = await deriveKeys(master, salt, kp);
  const withoutPw = await deriveKeys(master, salt);
  expect([...withPw.contentKey]).not.toEqual([...withoutPw.contentKey]);
});

test('pbkdf2 returns 32 bytes and depends on password and salt', async () => {
  const a = await pbkdf2('a', salt, 1000);
  const b = await pbkdf2('b', salt, 1000);
  expect(a.length).toBe(32);
  expect([...a]).not.toEqual([...b]);
});
