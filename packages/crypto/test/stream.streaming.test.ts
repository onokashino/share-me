import { expect, test, describe } from 'vitest';
import {
  encryptToBytes,
  decryptFromBytes,
  encryptStream,
  decryptStream,
} from '../src/stream.js';
import { importAesKey } from '../src/aead.js';

const prefix = new Uint8Array(7).fill(3);
const SEG = 64; // small segment size to exercise multi-segment paths cheaply

async function key() {
  return importAesKey(new Uint8Array(32).fill(7));
}

function fromChunks(data: Uint8Array, chunkSize: number): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(ctrl) {
      for (let i = 0; i < data.length; i += chunkSize) {
        ctrl.enqueue(data.subarray(i, Math.min(i + chunkSize, data.length)));
      }
      ctrl.close();
    },
  });
}

async function collect(rs: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const parts: Uint8Array[] = [];
  const reader = rs.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
  }
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function sample(len: number): Uint8Array {
  const a = new Uint8Array(len);
  for (let i = 0; i < len; i++) a[i] = (i * 31 + 7) & 0xff;
  return a;
}

// Sizes that hit every boundary: empty, sub-segment, exact, exact+1, multi, ragged.
const SIZES = [0, 1, SEG - 1, SEG, SEG + 1, 2 * SEG, 3 * SEG + 17];
// Input chunk sizes the producer hands us, independent of the segment size.
const CHUNKS = [1, 7, SEG, 3 * SEG + 5];

describe('encryptStream is byte-identical to encryptToBytes', () => {
  for (const size of SIZES) {
    for (const chunk of CHUNKS) {
      test(`size=${size} chunk=${chunk}`, async () => {
        const k = await key();
        const pt = sample(size);
        const buffered = await encryptToBytes(k, prefix, pt, SEG);
        const streamed = await collect(fromChunks(pt, Math.max(1, chunk)).pipeThrough(encryptStream(k, prefix, SEG)));
        expect([...streamed]).toEqual([...buffered]);
      });
    }
  }
});

describe('wire compatibility across buffered and streaming', () => {
  for (const size of SIZES) {
    test(`streaming decrypt of buffered ciphertext, size=${size}`, async () => {
      const k = await key();
      const pt = sample(size);
      const ct = await encryptToBytes(k, prefix, pt, SEG);
      const out = await collect(fromChunks(ct, 5).pipeThrough(decryptStream(k, prefix, SEG)));
      expect([...out]).toEqual([...pt]);
    });

    test(`buffered decrypt of streamed ciphertext, size=${size}`, async () => {
      const k = await key();
      const pt = sample(size);
      const ct = await collect(fromChunks(pt, 7).pipeThrough(encryptStream(k, prefix, SEG)));
      const out = await decryptFromBytes(k, prefix, ct, SEG);
      expect([...out]).toEqual([...pt]);
    });

    test(`full streaming round trip, size=${size}`, async () => {
      const k = await key();
      const pt = sample(size);
      const out = await collect(
        fromChunks(pt, 13).pipeThrough(encryptStream(k, prefix, SEG)).pipeThrough(decryptStream(k, prefix, SEG)),
      );
      expect([...out]).toEqual([...pt]);
    });
  }
});

describe('streaming decrypt rejects tampering', () => {
  test('truncating the last byte fails', async () => {
    const k = await key();
    const ct = await encryptToBytes(k, prefix, sample(3 * SEG + 17), SEG);
    const cut = ct.subarray(0, ct.length - 1);
    await expect(collect(fromChunks(cut, 9).pipeThrough(decryptStream(k, prefix, SEG)))).rejects.toThrow();
  });

  test('dropping the final segment fails', async () => {
    const k = await key();
    const ct = await encryptToBytes(k, prefix, sample(2 * SEG), SEG);
    // remove the entire final ciphertext segment; the previous one was encrypted
    // as non-final and must not authenticate as the final segment.
    const cut = ct.subarray(0, SEG + 16);
    await expect(collect(fromChunks(cut, 16).pipeThrough(decryptStream(k, prefix, SEG)))).rejects.toThrow();
  });

  test('flipping a ciphertext byte fails', async () => {
    const k = await key();
    const ct = await encryptToBytes(k, prefix, sample(SEG + 5), SEG);
    const bad = ct.slice();
    bad[2] = ((bad[2] ?? 0) ^ 0x01) & 0xff;
    await expect(collect(fromChunks(bad, 8).pipeThrough(decryptStream(k, prefix, SEG)))).rejects.toThrow();
  });
});
