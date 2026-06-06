import { expect, test } from 'vitest';
import { decryptFromBytes, encryptToBytes } from '../src/stream.js';
import { importAesKey } from '../src/aead.js';

async function setup() {
  const key = await importAesKey(new Uint8Array(32).fill(4));
  const prefix = new Uint8Array(7).fill(2);
  return { key, prefix };
}

test('round-trips multi-segment plaintext', async () => {
  const { key, prefix } = await setup();
  const pt = new Uint8Array(1024 * 3 + 7).map((_, i) => i & 0xff);
  const ct = await encryptToBytes(key, prefix, pt, 1024);
  const back = await decryptFromBytes(key, prefix, ct, 1024);
  expect([...back]).toEqual([...pt]);
});

test('round-trips an empty payload (single empty final segment)', async () => {
  const { key, prefix } = await setup();
  const ct = await encryptToBytes(key, prefix, new Uint8Array(0), 1024);
  expect((await decryptFromBytes(key, prefix, ct, 1024)).length).toBe(0);
});

test('round-trips an exact-multiple payload', async () => {
  const { key, prefix } = await setup();
  const pt = new Uint8Array(2048).fill(1);
  const ct = await encryptToBytes(key, prefix, pt, 1024);
  expect((await decryptFromBytes(key, prefix, ct, 1024)).length).toBe(2048);
});

test('dropping the final segment hard-fails (truncation)', async () => {
  const { key, prefix } = await setup();
  const pt = new Uint8Array(1024 + 10).fill(3);
  const ct = await encryptToBytes(key, prefix, pt, 1024);
  const truncated = ct.subarray(0, 1024 + 16); // keep only the first full segment
  await expect(decryptFromBytes(key, prefix, truncated, 1024)).rejects.toThrow();
});

test('reordering two segments hard-fails', async () => {
  const { key, prefix } = await setup();
  const pt = new Uint8Array(1024 * 2).fill(3);
  const ct = await encryptToBytes(key, prefix, pt, 1024);
  const segLen = 1024 + 16;
  const swapped = new Uint8Array(ct.length);
  swapped.set(ct.subarray(segLen, 2 * segLen), 0);
  swapped.set(ct.subarray(0, segLen), segLen);
  await expect(decryptFromBytes(key, prefix, swapped, 1024)).rejects.toThrow();
});

test('flipping a ciphertext byte hard-fails', async () => {
  const { key, prefix } = await setup();
  const pt = new Uint8Array(100).fill(3);
  const ct = await encryptToBytes(key, prefix, pt, 1024);
  ct[0] = ct[0]! ^ 1;
  await expect(decryptFromBytes(key, prefix, ct, 1024)).rejects.toThrow();
});
