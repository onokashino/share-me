import { expect, test } from 'vitest';
import kat from './vectors/kat.json';
import { deriveKeys } from '../src/kdf.js';
import { importAesKey } from '../src/aead.js';
import { encryptToBytes, decryptFromBytes } from '../src/stream.js';

const unhex = (s: string) => new Uint8Array(s.match(/../g)!.map((h) => parseInt(h, 16)));
const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

test('library reproduces the pinned KAT ciphertext byte-for-byte', async () => {
  const keys = await deriveKeys(unhex(kat.master), unhex(kat.salt));
  expect(hex(keys.contentKey)).toBe(kat.contentKey);
  expect(hex(keys.noncePrefix)).toBe(kat.noncePrefix);

  const contentKey = await importAesKey(keys.contentKey);
  const pt = new Uint8Array(kat.plaintextLen).map((_, i) => i & 0xff);
  const ct = await encryptToBytes(contentKey, keys.noncePrefix, pt, kat.segmentSize);
  expect(hex(ct)).toBe(kat.ciphertext);

  const back = await decryptFromBytes(contentKey, keys.noncePrefix, unhex(kat.ciphertext), kat.segmentSize);
  expect([...back]).toEqual([...pt]);
});
