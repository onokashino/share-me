import { expect, test } from 'vitest';
import { DEFAULT_SEGMENT_SIZE, NONCE_LEN } from '../src/constants.js';
import { encryptToBytes, segmentAad, segmentCountFor, segmentNonce } from '../src/stream.js';
import { importAesKey } from '../src/aead.js';

const prefix = new Uint8Array(7).fill(1);

test('segmentNonce is prefix ‖ u32 counter ‖ flag and 12 bytes long', () => {
  const n = segmentNonce(prefix, 0x01020304, true);
  expect(n.length).toBe(NONCE_LEN);
  expect([...n]).toEqual([1, 1, 1, 1, 1, 1, 1, 1, 2, 3, 4, 1]);
  expect(segmentNonce(prefix, 0, false)[11]).toBe(0);
});

test('segmentAad binds counter and final flag', () => {
  const a = segmentAad(5, true);
  const b = segmentAad(5, false);
  expect([...a]).not.toEqual([...b]);
});

test('segmentCountFor follows the canonical rule', () => {
  expect(segmentCountFor(0, 1024)).toBe(1);
  expect(segmentCountFor(1, 1024)).toBe(1);
  expect(segmentCountFor(1024, 1024)).toBe(1);
  expect(segmentCountFor(1025, 1024)).toBe(2);
  expect(segmentCountFor(2048, 1024)).toBe(2);
});

test('ciphertext length = plaintext + 16 bytes tag per segment', async () => {
  const key = await importAesKey(new Uint8Array(32).fill(4));
  const p = new Uint8Array(7).fill(2);
  const pt = new Uint8Array(1024 + 100).fill(9);
  const ct = await encryptToBytes(key, p, pt, 1024);
  expect(ct.length).toBe(pt.length + 2 * 16);
});

test('default segment size constant is wired', () => {
  expect(DEFAULT_SEGMENT_SIZE).toBe(1024 * 1024);
});
