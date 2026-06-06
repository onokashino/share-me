import { expect, test } from 'vitest';
import { gcmDecrypt, gcmEncrypt, hmacSign, importAesKey, sha256 } from '../src/aead.js';

const key = new Uint8Array(32).fill(7);
const nonce = new Uint8Array(12).fill(1);
const aad = new TextEncoder().encode('aad');

test('AES-GCM round-trips with AAD', async () => {
  const k = await importAesKey(key);
  const pt = new TextEncoder().encode('hello');
  const ct = await gcmEncrypt(k, nonce, aad, pt);
  expect(ct.length).toBe(pt.length + 16);
  const back = await gcmDecrypt(k, nonce, aad, ct);
  expect(new TextDecoder().decode(back)).toBe('hello');
});

test('AES-GCM rejects a wrong AAD', async () => {
  const k = await importAesKey(key);
  const ct = await gcmEncrypt(k, nonce, aad, new Uint8Array([1, 2, 3]));
  await expect(gcmDecrypt(k, nonce, new Uint8Array([9]), ct)).rejects.toThrow();
});

test('hmacSign and sha256 produce 32 bytes', async () => {
  expect((await hmacSign(key, new Uint8Array([1]))).length).toBe(32);
  expect((await sha256(new Uint8Array([1]))).length).toBe(32);
});
