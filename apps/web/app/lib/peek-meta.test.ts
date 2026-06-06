/**
 * peek-meta.test.ts
 *
 * Tests the header-only decrypt path that peekMeta uses:
 *   encryptFile → parseHeader → deriveKeys → decryptMetadata → {kind,name,size}
 *
 * Runs in Node 20 (vitest environment: 'node') — WebCrypto is available via
 * globalThis.crypto (Node 20 exposes it natively).
 *
 * Uses a fake argon2 so no WASM worker is needed.
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';
import {
  encryptFile,
  parseHeader,
  deriveKeys,
  decryptMetadata,
  fromBase64Url,
  KdfType,
  pbkdf2,
} from '@share-me/crypto';
import { encodeBundle } from './drop-service';

// ---------------------------------------------------------------------------
// Fake Argon2id — deterministic, no WASM
// ---------------------------------------------------------------------------
const fakeArgon2 = async (
  pw: string,
  salt: Uint8Array,
  p: { m: number; t: number; pp: number },
): Promise<Uint8Array> => {
  const seed = new TextEncoder().encode(`argon:${pw}:${p.m}:${p.t}:${p.pp}`);
  const buf = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    buf[i] = (seed[i % seed.length]! ^ salt[i % salt.length]! ^ i) & 0xff;
  }
  return buf;
};

// ---------------------------------------------------------------------------
// Helper: perform the peekMeta header-decrypt logic directly
// (mirrors peekMeta in drop-service.ts but without the server call, using a
//  pre-produced header bytes and fragment — so we can test the crypto seam
//  without a running server)
// ---------------------------------------------------------------------------
async function headerDecrypt(
  headerBytes: Uint8Array,
  fragment: string,
  password?: string,
  deriveArgon2Fn = fakeArgon2,
): Promise<
  | { kind: 'files' | 'text'; name: string; size: number }
  | { needsPassword: true }
> {
  const parsed = parseHeader(headerBytes);

  if (parsed.kdfType !== KdfType.None && !password) {
    return { needsPassword: true };
  }

  const master = fromBase64Url(fragment);
  let kp: Uint8Array | undefined;

  if (parsed.kdfType === KdfType.Argon2id) {
    if (!password) return { needsPassword: true };
    kp = await deriveArgon2Fn(password, parsed.salt, {
      m: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(0, false),
      t: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(4, false),
      pp: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(8, false),
    });
  } else if (parsed.kdfType === KdfType.Pbkdf2) {
    if (!password) return { needsPassword: true };
    const iters = new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(0, false);
    kp = await pbkdf2(password, parsed.salt, iters);
  }

  const keys = await deriveKeys(master, parsed.salt, kp);
  const meta = await decryptMetadata(keys.metadataKey, parsed.metaCiphertext);

  const kind: 'files' | 'text' = meta.type === 'text/plain' ? 'text' : 'files';
  return { kind, name: meta.name, size: meta.size };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('peekMeta header-decrypt path', () => {
  // ── files drop (no password) ──────────────────────────────────────────────
  test('files drop: KdfType.None → returns {kind:files, name, size}', async () => {
    const content = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const bundle = encodeBundle(
      [{ name: 'photo.jpg', type: 'image/jpeg', bytes: content }],
      'files',
    );

    const enc = await encryptFile({
      plaintext: bundle,
      // sealFiles uses type 'application/x-share-me-bundle'
      meta: { name: 'photo.jpg', type: 'application/x-share-me-bundle', size: bundle.length },
    });

    expect(enc.header[5]).toBe(KdfType.None);

    const result = await headerDecrypt(enc.header, enc.fragment);

    expect(result).not.toHaveProperty('needsPassword');
    expect(result).toMatchObject({ kind: 'files', name: 'photo.jpg', size: bundle.length });
  });

  // ── text drop (no password) ───────────────────────────────────────────────
  test('text drop: KdfType.None → returns {kind:text, name, size}', async () => {
    const text = 'Hello from share-me!';
    const bytes = new TextEncoder().encode(text);
    const bundle = encodeBundle(
      [{ name: 'message.txt', type: 'text/plain', bytes }],
      'text',
    );

    const enc = await encryptFile({
      plaintext: bundle,
      // sealText uses type 'text/plain' (the seal-side tweak)
      meta: { name: 'message.txt', type: 'text/plain', size: bundle.length },
    });

    expect(enc.header[5]).toBe(KdfType.None);

    const result = await headerDecrypt(enc.header, enc.fragment);

    expect(result).not.toHaveProperty('needsPassword');
    expect(result).toMatchObject({ kind: 'text', name: 'message.txt', size: bundle.length });
  });

  // ── no-password file does NOT return needsPassword ─────────────────────────
  test('KdfType.None without password does NOT return needsPassword', async () => {
    const bundle = encodeBundle(
      [{ name: 'x.bin', type: 'application/octet-stream', bytes: new Uint8Array([42]) }],
      'files',
    );
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'x.bin', type: 'application/x-share-me-bundle', size: bundle.length },
    });

    expect(enc.header[5]).toBe(KdfType.None);

    const result = await headerDecrypt(enc.header, enc.fragment /* no password */);
    expect(result).not.toHaveProperty('needsPassword');
    expect(result).toHaveProperty('kind');
  });

  // ── password-protected, no password supplied → needsPassword ─────────────
  test('Argon2id-protected, no password → {needsPassword:true}', async () => {
    const bundle = encodeBundle(
      [{ name: 'secret.txt', type: 'text/plain', bytes: new TextEncoder().encode('hi') }],
      'text',
    );
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'secret.txt', type: 'text/plain', size: bundle.length },
      password: 'hunter2',
      passwordKdf: { type: 'argon2id', argon: { m: 19456, t: 2, pp: 1 }, deriveArgon2: fakeArgon2 },
    });

    expect(enc.header[5]).toBe(KdfType.Argon2id);

    const result = await headerDecrypt(enc.header, enc.fragment /* no password */);
    expect(result).toEqual({ needsPassword: true });
  });

  // ── password-protected, correct password supplied → {kind,name,size} ──────
  test('Argon2id-protected, correct password → {kind:text, name, size}', async () => {
    const text = 'Top secret message';
    const bytes = new TextEncoder().encode(text);
    const bundle = encodeBundle(
      [{ name: 'message.txt', type: 'text/plain', bytes }],
      'text',
    );
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'message.txt', type: 'text/plain', size: bundle.length },
      password: 'correct-horse',
      passwordKdf: { type: 'argon2id', argon: { m: 19456, t: 2, pp: 1 }, deriveArgon2: fakeArgon2 },
    });

    expect(enc.header[5]).toBe(KdfType.Argon2id);

    const result = await headerDecrypt(enc.header, enc.fragment, 'correct-horse');

    expect(result).not.toHaveProperty('needsPassword');
    expect(result).toMatchObject({ kind: 'text', name: 'message.txt', size: bundle.length });
  });

  // ── multi-file drop (no password) → kind:files ────────────────────────────
  test('multi-file drop → kind:files with combined name', async () => {
    const entries = [
      { name: 'a.png', type: 'image/png', bytes: new Uint8Array([1, 2]) },
      { name: 'b.pdf', type: 'application/pdf', bytes: new Uint8Array([3, 4, 5]) },
    ];
    const bundle = encodeBundle(entries, 'files');

    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: '2 files', type: 'application/x-share-me-bundle', size: bundle.length },
    });

    const result = await headerDecrypt(enc.header, enc.fragment);
    expect(result).toMatchObject({ kind: 'files', name: '2 files', size: bundle.length });
  });
});

// ---------------------------------------------------------------------------
// peekMeta mock-server integration test
// (exercises the full peekMeta function with a mocked getHeaderBytes)
// ---------------------------------------------------------------------------

describe('peekMeta with mocked getHeaderBytes', () => {
  test('gone response returns {error:gone}', async () => {
    // Dynamically import to allow vi.mock to work properly
    const actionsModule = await import('./actions');
    const getHeaderBytesSpy = vi.spyOn(actionsModule, 'getHeaderBytes');
    getHeaderBytesSpy.mockResolvedValueOnce({ error: 'gone' });

    // Import peekMeta after the mock is set up
    const { peekMeta } = await import('./drop-service');

    const result = await peekMeta('some-id', 'some-fragment');
    expect(result).toEqual({ error: 'gone' });

    getHeaderBytesSpy.mockRestore();
  });

  test('no-password drop returns {kind, name, size}', async () => {
    const content = new TextEncoder().encode('hello world');
    const bundle = encodeBundle(
      [{ name: 'note.txt', type: 'text/plain', bytes: content }],
      'text',
    );
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'note.txt', type: 'text/plain', size: bundle.length },
    });

    // Encode header as base64 (same way getHeaderBytes does it)
    let bin = '';
    for (const b of enc.header) bin += String.fromCharCode(b);
    const headerB64 = btoa(bin);

    const actionsModule = await import('./actions');
    const getHeaderBytesSpy = vi.spyOn(actionsModule, 'getHeaderBytes');
    getHeaderBytesSpy.mockResolvedValueOnce({ headerB64 });

    const { peekMeta } = await import('./drop-service');

    const result = await peekMeta('test-id', enc.fragment);
    expect(result).toMatchObject({ kind: 'text', name: 'note.txt', size: bundle.length });

    getHeaderBytesSpy.mockRestore();
  });
});
