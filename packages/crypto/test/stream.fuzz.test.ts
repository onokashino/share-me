import { expect, test } from 'vitest';
import { decryptFile, encryptFile } from '../src/highlevel.js';

const meta = { name: 'f.bin', type: 'application/octet-stream', size: 0 };

function mutate(buf: Uint8Array, seed: number): Uint8Array {
  const out = buf.slice();
  // deterministic pseudo-random single-byte flip (no Math.random, for reproducibility)
  const idx = (seed * 2654435761) % out.length;
  out[idx] = (out[idx]! ^ (((seed % 255) + 1) & 0xff)) & 0xff;
  return out;
}

test('flipping any single byte of header or ciphertext is rejected', async () => {
  const pt = new Uint8Array(1024 * 2 + 33).map((_, i) => (i * 7) & 0xff);
  const enc = await encryptFile({ plaintext: pt, meta: { ...meta, size: pt.length }, segmentSize: 1024 });

  for (let seed = 1; seed <= 64; seed++) {
    const badHeader = mutate(enc.header, seed);
    await expect(
      decryptFile({ header: badHeader, ciphertext: enc.ciphertext, fragment: enc.fragment }),
    ).rejects.toThrow();

    const badCt = mutate(enc.ciphertext, seed);
    await expect(
      decryptFile({ header: enc.header, ciphertext: badCt, fragment: enc.fragment }),
    ).rejects.toThrow();
  }
});

test('random garbage never parses as a valid file', async () => {
  for (let seed = 1; seed <= 32; seed++) {
    const junk = new Uint8Array(200).map((_, i) => (i * seed * 13) & 0xff);
    await expect(
      decryptFile({ header: junk, ciphertext: junk, fragment: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }),
    ).rejects.toThrow();
  }
});

test('appending trailing bytes after the final segment is rejected', async () => {
  const pt = new Uint8Array(50).fill(1);
  const enc = await encryptFile({ plaintext: pt, meta: { ...meta, size: 50 }, segmentSize: 1024 });
  const extended = new Uint8Array(enc.ciphertext.length + 16);
  extended.set(enc.ciphertext, 0);
  await expect(
    decryptFile({ header: enc.header, ciphertext: extended, fragment: enc.fragment }),
  ).rejects.toThrow();
});
