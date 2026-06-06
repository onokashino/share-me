import { expect, test } from 'vitest';
import { computeDownloadAuth } from '../src/auth.js';

const authKey = new Uint8Array(32).fill(8);

test('download-auth token + hash are 32 bytes and derived from authKey', async () => {
  const a = await computeDownloadAuth(authKey);
  expect(a.token.length).toBe(32);
  expect(a.hash.length).toBe(32);
  const b = await computeDownloadAuth(new Uint8Array(32).fill(9));
  expect([...a.token]).not.toEqual([...b.token]);
});

test('hash is SHA-256 of the token (server stores only the hash)', async () => {
  const { token, hash } = await computeDownloadAuth(authKey);
  const recomputed = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', token.buffer as ArrayBuffer));
  expect([...recomputed]).toEqual([...hash]);
});
