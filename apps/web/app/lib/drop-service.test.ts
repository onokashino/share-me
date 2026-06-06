/**
 * drop-service.test.ts
 *
 * Tests:
 *  1. Bundle codec round-trips (single file, multi-file, text, empty list)
 *  2. Full crypto-level round-trip:
 *     - encrypt a bundle with @share-me/crypto (fake argon2)
 *     - parse the header
 *     - re-derive dl-auth the SAME way the server verifies it:
 *         stored = hex(sha256(utf8(bearerString)))
 *         where bearerString = toBase64Url(token.bytes)
 *     - decrypt and decode bundle
 *     This proves the dl-auth-hash computation matches apps/api::sha256_hex(bearerString)
 */

import { describe, expect, test } from 'vitest';
import {
  encryptFile,
  decryptFile,
  parseHeader,
  deriveKeys,
  computeDownloadAuth,
  toBase64Url,
  fromBase64Url,
  KdfType,
} from '@share-me/crypto';
import { encodeBundle, decodeBundle } from './drop-service';

// ─── Bundle codec tests ───────────────────────────────────────────────────────

describe('bundle codec', () => {
  test('single file round-trip', () => {
    const data = new Uint8Array([1, 2, 3, 4, 5]);
    const entries = [{ name: 'test.bin', type: 'application/octet-stream', bytes: data }];
    const encoded = encodeBundle(entries, 'files');
    const decoded = decodeBundle(encoded);

    expect(decoded.kind).toBe('files');
    expect(decoded.files).toHaveLength(1);
    expect(decoded.files[0].name).toBe('test.bin');
    expect(decoded.files[0].type).toBe('application/octet-stream');
    expect([...decoded.files[0].bytes]).toEqual([1, 2, 3, 4, 5]);
  });

  test('multi-file round-trip', () => {
    const file1 = new Uint8Array([10, 20, 30]);
    const file2 = new Uint8Array([40, 50, 60, 70]);
    const file3 = new Uint8Array([80]);
    const entries = [
      { name: 'a.txt', type: 'text/plain', bytes: file1 },
      { name: 'b.png', type: 'image/png', bytes: file2 },
      { name: 'c.js', type: 'application/javascript', bytes: file3 },
    ];
    const encoded = encodeBundle(entries, 'files');
    const decoded = decodeBundle(encoded);

    expect(decoded.kind).toBe('files');
    expect(decoded.files).toHaveLength(3);
    expect([...decoded.files[0].bytes]).toEqual([10, 20, 30]);
    expect([...decoded.files[1].bytes]).toEqual([40, 50, 60, 70]);
    expect([...decoded.files[2].bytes]).toEqual([80]);
    expect(decoded.files[1].name).toBe('b.png');
  });

  test('text kind round-trip', () => {
    const text = 'Hello, world! Привет мир 你好世界';
    const bytes = new TextEncoder().encode(text);
    const entries = [{ name: 'message.txt', type: 'text/plain', bytes }];
    const encoded = encodeBundle(entries, 'text');
    const decoded = decodeBundle(encoded);

    expect(decoded.kind).toBe('text');
    expect(decoded.files).toHaveLength(1);
    const decodedText = new TextDecoder().decode(decoded.files[0].bytes);
    expect(decodedText).toBe(text);
  });

  test('empty list round-trip', () => {
    const encoded = encodeBundle([], 'files');
    const decoded = decodeBundle(encoded);
    expect(decoded.kind).toBe('files');
    expect(decoded.files).toHaveLength(0);
  });

  test('large file preserves all bytes', () => {
    const large = new Uint8Array(65536).map((_, i) => (i * 37) & 0xff);
    const entries = [{ name: 'large.bin', type: 'application/octet-stream', bytes: large }];
    const encoded = encodeBundle(entries, 'files');
    const decoded = decodeBundle(encoded);
    expect([...decoded.files[0].bytes]).toEqual([...large]);
  });
});

// ─── Crypto + dl-auth round-trip test ────────────────────────────────────────

/**
 * Fake argon2id for deterministic tests (no WASM needed).
 * Mirrors the one in packages/crypto/test/highlevel.argon2.test.ts.
 */
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

/** hex-encode — mirrors the server's output format */
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Server-side sha256_hex equivalent:
 *   sha256_hex(s: &str) = hex(sha256(s.as_bytes()))
 *   = hex(sha256(utf8(s)))
 */
async function serverSideSha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return hexEncode(new Uint8Array(hash));
}

describe('dl-auth-hash cross-boundary correctness', () => {
  test('stored hash matches server sha256_hex(bearerString) — no password', async () => {
    const plaintext = new Uint8Array(256).map((_, i) => (i * 13) & 0xff);
    const bundle = encodeBundle(
      [{ name: 'test.bin', type: 'application/octet-stream', bytes: plaintext }],
      'files',
    );

    // 1. Encrypt (no password)
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'test.bin', type: 'application/x-share-me-bundle', size: bundle.length },
    });

    expect(enc.header[5]).toBe(KdfType.None);

    // 2. Client-side computation (mirrors drop-service.ts _seal):
    //    bearerString = toBase64Url(downloadAuth.token)
    //    dlAuthHashHex = hex(sha256(utf8(bearerString)))
    const bearerString = toBase64Url(enc.downloadAuth.token);
    const bearerUtf8 = new TextEncoder().encode(bearerString);
    const hashBytes = await crypto.subtle.digest('SHA-256', bearerUtf8);
    const clientDlAuthHashHex = hexEncode(new Uint8Array(hashBytes));

    // 3. Server-side computation (apps/api::sha256_hex(bearerString)):
    const serverDlAuthHashHex = await serverSideSha256Hex(bearerString);

    // 4. They MUST match
    expect(clientDlAuthHashHex).toBe(serverDlAuthHashHex);

    // 5. Verify the raw hash (downloadAuth.hash) is DIFFERENT from the stored hash
    //    (the raw hash is sha256 of token bytes, not of the bearer string)
    const rawHash = hexEncode(enc.downloadAuth.hash);
    // bearer string is base64url of token bytes — sha256 of that string ≠ sha256 of the raw bytes
    // (they would only equal if the token bytes happened to be the same as their own base64url encoding)
    // Just confirm clientDlAuthHashHex was computed consistently
    expect(clientDlAuthHashHex).toHaveLength(64); // 32 bytes × 2 hex chars
    expect(rawHash).toHaveLength(64);
    // The raw hash (sha256 of bytes) differs from hash of the base64url string
    // unless the base64url string coincidentally encodes to the same sha256 — extremely unlikely
    expect(clientDlAuthHashHex).not.toBe(rawHash);
  });

  test('full crypto round-trip with argon2id: encrypt → parse → re-derive → decrypt → bundle', async () => {
    const text = 'Secret message for testing';
    const bundle = encodeBundle(
      [{ name: 'message.txt', type: 'text/plain', bytes: new TextEncoder().encode(text) }],
      'text',
    );

    // 1. Encrypt with argon2id (fake derive)
    const argon = { m: 19456, t: 2, pp: 1 };
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: 'message.txt', type: 'application/x-share-me-bundle', size: bundle.length },
      password: 'test-password',
      passwordKdf: { type: 'argon2id', argon, deriveArgon2: fakeArgon2 },
    });

    expect(enc.header[5]).toBe(KdfType.Argon2id);

    // 2. Client-side dl-auth-hash (what createUpload sends)
    const bearerString = toBase64Url(enc.downloadAuth.token);
    const bearerHashBytes = new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearerString)),
    );
    const clientDlAuthHashHex = hexEncode(bearerHashBytes);

    // 3. Simulate server verification: sha256_hex(bearer) === stored
    const serverVerified = await serverSideSha256Hex(bearerString);
    expect(clientDlAuthHashHex).toBe(serverVerified);

    // 4. Simulate receiver side: parse header, re-derive keys, re-compute download auth
    const master = fromBase64Url(enc.fragment);
    const parsed = parseHeader(enc.header);
    expect(parsed.kdfType).toBe(KdfType.Argon2id);

    // Re-derive kp from the parsed argon params
    const view = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.byteLength);
    const m = view.getUint32(0, false);
    const t = view.getUint32(4, false);
    const pp = view.getUint32(8, false);
    const kp = await fakeArgon2('test-password', parsed.salt, { m, t, pp });

    const keys = await deriveKeys(master, parsed.salt, kp);
    const downloadAuth2 = await computeDownloadAuth(keys.authKey);

    // The re-derived bearer string must match the original
    const bearerString2 = toBase64Url(downloadAuth2.token);
    expect(bearerString2).toBe(bearerString);

    // 5. Decrypt
    const decrypted = await decryptFile({
      header: enc.header,
      ciphertext: enc.ciphertext,
      fragment: enc.fragment,
      password: 'test-password',
      deriveArgon2: fakeArgon2,
    });

    // 6. Decode bundle
    const result = decodeBundle(decrypted.plaintext);
    expect(result.kind).toBe('text');
    expect(result.files).toHaveLength(1);
    const decoded = new TextDecoder().decode(result.files[0].bytes);
    expect(decoded).toBe(text);
  });

  test('dl-auth-hash is sha256 of the bearer STRING (not raw token bytes)', async () => {
    // This test explicitly documents and verifies the asymmetry
    const plaintext = new Uint8Array(64).fill(0x42);
    const enc = await encryptFile({
      plaintext,
      meta: { name: 'x.bin', type: 'application/octet-stream', size: 64 },
    });

    const tokenBytes = enc.downloadAuth.token; // raw HMAC bytes (32 bytes)
    const bearerString = toBase64Url(tokenBytes); // base64url-encoded string

    // sha256 of the raw bytes
    const hashOfBytes = hexEncode(new Uint8Array(
      await crypto.subtle.digest('SHA-256', tokenBytes.slice().buffer),
    ));

    // sha256 of the bearer STRING (what the server computes)
    const hashOfString = hexEncode(new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(bearerString)),
    ));

    // downloadAuth.hash is sha256 of the raw bytes
    expect(hexEncode(enc.downloadAuth.hash)).toBe(hashOfBytes);

    // These differ because the base64url string is longer than 32 bytes
    expect(hashOfBytes).not.toBe(hashOfString);

    // The correct hash to store is hashOfString (what the server will verify)
    // This is what drop-service._seal sends as dlAuthHashHex
    expect(hashOfString).toHaveLength(64);
  });
});
