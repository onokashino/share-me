import { expect, test, describe } from 'vitest';
import { encryptFile, decryptFile, encryptFileStream, decryptFileStream } from '../src/highlevel.js';
import { encodeBundle, encodeBundleStream, decodeBundleStream } from '../src/bundle.js';

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

const meta = (size: number) => ({ name: 'f.bin', type: 'application/octet-stream', size });

// Sizes straddling the 1 MiB default segment boundary.
const SIZES = [0, 1, 1024 * 1024 - 1, 1024 * 1024 + 3];

describe('highlevel streaming interops with buffered', () => {
  for (const size of SIZES) {
    test(`stream encrypt -> buffered decrypt, size=${size}`, async () => {
      const pt = sample(size);
      const enc = await encryptFileStream({ source: fromChunks(pt, 64 * 1024), totalLength: size, meta: meta(size) });
      const ct = await collect(enc.ciphertextStream);
      const dec = await decryptFile({ header: enc.header, ciphertext: ct, fragment: enc.fragment });
      expect([...dec.plaintext]).toEqual([...pt]);
      expect(dec.meta.size).toBe(size);
    });

    test(`buffered encrypt -> stream decrypt, size=${size}`, async () => {
      const pt = sample(size);
      const enc = await encryptFile({ plaintext: pt, meta: meta(size) });
      const dec = await decryptFileStream({
        header: enc.header,
        ciphertextStream: fromChunks(enc.ciphertext, 7000),
        fragment: enc.fragment,
      });
      const out = await collect(dec.plaintextStream);
      expect([...out]).toEqual([...pt]);
    });
  }

  test('full stream roundtrip with a password', async () => {
    const pt = sample(1024 * 1024 + 500);
    const enc = await encryptFileStream({
      source: fromChunks(pt, 50_000),
      totalLength: pt.length,
      meta: meta(pt.length),
      password: 'hunter2',
    });
    const ct = await collect(enc.ciphertextStream);
    const dec = await decryptFileStream({
      header: enc.header,
      ciphertextStream: fromChunks(ct, 33_333),
      fragment: enc.fragment,
      password: 'hunter2',
    });
    const out = await collect(dec.plaintextStream);
    expect([...out]).toEqual([...pt]);
  });

  test('wrong password is rejected before any plaintext is released', async () => {
    const pt = sample(100);
    const enc = await encryptFileStream({
      source: fromChunks(pt, 32),
      totalLength: pt.length,
      meta: meta(pt.length),
      password: 'right',
    });
    const ct = await collect(enc.ciphertextStream);
    await expect(
      decryptFileStream({ header: enc.header, ciphertextStream: fromChunks(ct, 16), fragment: enc.fragment, password: 'wrong' }),
    ).rejects.toThrow();
  });
});

describe('bundle streaming', () => {
  const entries = [
    { name: 'a.txt', type: 'text/plain', bytes: sample(10) },
    { name: 'b.bin', type: 'application/octet-stream', bytes: sample(1000) },
  ];

  test('encodeBundleStream is byte-identical to encodeBundle', async () => {
    const buffered = encodeBundle(entries, 'files');
    const { totalLength, stream } = encodeBundleStream(
      entries.map((e) => ({ name: e.name, type: e.type, size: e.bytes.length, stream: () => fromChunks(e.bytes, 7) })),
      'files',
    );
    const streamed = await collect(stream);
    expect(totalLength).toBe(buffered.length);
    expect([...streamed]).toEqual([...buffered]);
  });

  test('decodeBundleStream reconstructs files from a buffered bundle', async () => {
    const buffered = encodeBundle(entries, 'files');
    const got: Array<{ name: string; bytes: number[] }> = [];
    const manifest = await decodeBundleStream(fromChunks(buffered, 13), async (file, pipe) => {
      const acc: number[] = [];
      await pipe((c) => {
        acc.push(...c);
      });
      got.push({ name: file.name, bytes: acc });
    });
    expect(manifest.kind).toBe('files');
    expect(got.map((g) => g.name)).toEqual(['a.txt', 'b.bin']);
    expect(got[1]!.bytes).toEqual([...entries[1]!.bytes]);
  });

  test('trailing bytes after the declared files are rejected', async () => {
    const buffered = encodeBundle(entries, 'files');
    const tampered = new Uint8Array(buffered.length + 1);
    tampered.set(buffered, 0);
    await expect(
      decodeBundleStream(fromChunks(tampered, 100), async (_f, pipe) => {
        await pipe(() => {});
      }),
    ).rejects.toThrow();
  });
});
