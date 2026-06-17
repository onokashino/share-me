/**
 * drop-service.ts — Client-only orchestration seam.
 *
 * Implements:
 *  • Bundle codec  — multi-file envelope (client convention; server sees one opaque blob)
 *  • sealFiles / sealText — encrypt + upload
 *  • openMeta / openDrop  — decrypt + download
 *  • fingerprint / newSession — utilities
 *
 * Download-auth cross-boundary correctness
 * ─────────────────────────────────────────
 * apps/api/src/tokens.rs::sha256_hex(input: &str) hashes the UTF-8 bytes of the
 * bearer STRING, not the raw token bytes.
 *
 * apps/api/src/routes/download.rs line:
 *   tokens::sha256_hex(auth.token())
 *   → sha256(utf8(bearerString))
 *
 * @share-me/crypto computeDownloadAuth() returns:
 *   token: Uint8Array  — raw HMAC-SHA256 bytes
 *   hash:  Uint8Array  — sha256(rawTokenBytes)   ← NOT what the server expects
 *
 * The client MUST:
 *   1. Encode token bytes as base64url → bearerString
 *   2. Compute hex(sha256(utf8(bearerString))) → dlAuthHashHex for createUpload
 *   3. Present bearerString as the Authorization Bearer when downloading
 *
 * This ensures: server sha256_hex(bearer) === stored dlAuthHashHex.
 */

'use client';

import {
  encryptFile,
  decryptFile,
  parseHeader,
  deriveKeys,
  decryptMetadata,
  computeDownloadAuth,
  toBase64Url,
  fromBase64Url,
  KdfType,
  type DownloadAuth,
} from '@share-me/crypto';
import { deriveArgon2, derivePasswordKey, DEFAULT_ARGON_PARAMS } from './kdf-client';
import { createUpload, getMeta, getHeaderBytes } from './actions';
import { putBlob } from './blob-upload';
import { downloadAndDecrypt } from './blob-download';

// Bundle codec lives in @share-me/crypto so the web app and the CLI share one
// on-the-wire container format.
import { encodeBundle, decodeBundle, type BundleEntry } from '@share-me/crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const subtle = globalThis.crypto.subtle;

/** SHA-256 of arbitrary bytes → Uint8Array */
async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  // slice() ensures we have a plain ArrayBuffer (not SharedArrayBuffer)
  return new Uint8Array(await subtle.digest('SHA-256', data.slice().buffer));
}

/** hex-encode a Uint8Array */
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Compute the dl-auth-hash that matches what apps/api stores and compares.
 *
 * Server: sha256_hex(bearerString) where sha256_hex hashes the UTF-8 bytes.
 * So: dlAuthHashHex = hex(sha256(utf8(toBase64Url(token.bytes))))
 */
async function computeDlAuthHashHex(tokenBytes: Uint8Array): Promise<string> {
  const bearerString = toBase64Url(tokenBytes);
  const bearerUtf8 = new TextEncoder().encode(bearerString);
  const hashBytes = await sha256Bytes(bearerUtf8);
  return hexEncode(hashBytes);
}

/** Expiry label → seconds */
function expiryToSecs(expiry: '1h' | '1d' | '7d' | '30d'): number {
  const map = { '1h': 3600, '1d': 86400, '7d': 604800, '30d': 2592000 } as const;
  return map[expiry];
}

/** base64-standard encode (for header bytes sent to createUpload) */
function base64Std(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/** fingerprint: SHA-256(master) → first 16 hex bytes, uppercase, paired with spaces */
export async function fingerprint(master: Uint8Array): Promise<string> {
  const hash = await sha256Bytes(master);
  const hex = hexEncode(hash.slice(0, 16)).toUpperCase();
  // Group into pairs: "A1 B2 C3 ..."
  return hex.match(/.{2}/g)!.join(' ');
}

/** Generate a fresh session id for a download attempt. */
export function newSession(): string {
  return crypto.randomUUID();
}

// ─── sealFiles ────────────────────────────────────────────────────────────────

export interface SealOpts {
  password?: string;
  expiry: '1h' | '1d' | '7d' | '30d';
  maxDownloads: number;  // 0 = no limit
  burn: boolean;
  unlockAt?: number;     // unix ms
  onProgress: (p: number) => void;
}

export interface SealResult {
  id: string;
  fragment: string;
  link: string;
  fingerprint: string;
  kdf: 'argon2id' | 'pbkdf2' | 'none';
}

export async function sealFiles(
  files: File[],
  opts: SealOpts,
): Promise<SealResult> {
  opts.onProgress(0.02);

  // 1. Read each file to bytes
  const entries: BundleEntry[] = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      type: f.type || 'application/octet-stream',
      bytes: new Uint8Array(await f.arrayBuffer()),
    })),
  );

  // 2. Encode bundle
  const bundle = encodeBundle(entries, 'files');
  opts.onProgress(0.08);

  // 3. Determine meta name
  const metaName = files.length === 1 ? files[0].name : `${files.length} files`;

  return _seal(bundle, metaName, 'application/x-share-me-bundle', opts);
}

export async function sealText(
  text: string,
  opts: SealOpts,
): Promise<SealResult> {
  opts.onProgress(0.02);
  const bytes = new TextEncoder().encode(text);
  const bundle = encodeBundle(
    [{ name: 'message.txt', type: 'text/plain', bytes }],
    'text',
  );
  opts.onProgress(0.08);
  return _seal(bundle, 'message.txt', 'text/plain', opts);
}

/**
 * _seal — encrypt + upload a pre-encoded bundle.
 *
 * metaType encodes the drop kind in the encrypted FileMetadata so receivers
 * can determine kind from the header alone (without downloading the blob):
 *   'application/x-share-me-bundle' → kind === 'files'
 *   'text/plain'                    → kind === 'text'
 */
async function _seal(
  bundle: Uint8Array,
  metaName: string,
  metaType: 'application/x-share-me-bundle' | 'text/plain',
  opts: SealOpts,
): Promise<SealResult> {
  // 4. Encrypt
  let kdfResult: 'argon2id' | 'pbkdf2' | 'none' = 'none';
  const argon = DEFAULT_ARGON_PARAMS;

  const encrypted = await encryptFile({
    plaintext: bundle,
    meta: {
      name: metaName,
      type: metaType,
      size: bundle.length,
    },
    ...(opts.password
      ? {
          password: opts.password,
          passwordKdf: { type: 'argon2id', argon, deriveArgon2 },
        }
      : {}),
  });
  opts.onProgress(0.55);

  // Track which KDF was actually used by checking what the worker returned
  // (worker may fall back to PBKDF2 if WASM unavailable)
  if (opts.password) {
    // The kdf-client will have used argon2id or pbkdf2 depending on WASM availability.
    // We can detect this by checking the header kdfType (byte 5).
    const kdfTypeByte = encrypted.header[5];
    kdfResult = kdfTypeByte === KdfType.Argon2id ? 'argon2id' : 'pbkdf2';
  }

  // 5. Compute dl-auth bearer string + stored hash
  const bearerString = toBase64Url(encrypted.downloadAuth.token);
  const dlAuthHashHex = await computeDlAuthHashHex(encrypted.downloadAuth.token);

  // 6. Create upload record on the server
  const expiresInSecs = expiryToSecs(opts.expiry);
  const maxDownloads = opts.burn ? 1 : (opts.maxDownloads || undefined);
  const unlockInSecs = opts.unlockAt
    ? Math.floor((opts.unlockAt - Date.now()) / 1000)
    : undefined;

  const { id, uploadToken } = await createUpload({
    headerB64: base64Std(encrypted.header),
    dlAuthHashHex,
    maxDownloads,
    expiresInSecs,
    unlockInSecs: unlockInSecs && unlockInSecs > 0 ? unlockInSecs : undefined,
  });
  opts.onProgress(0.65);

  // 7. Upload the blob
  await putBlob(id, uploadToken, encrypted.ciphertext, (p) => {
    opts.onProgress(0.65 + p * 0.33);
  });
  opts.onProgress(0.99);

  const fp = await fingerprint(fromBase64Url(encrypted.fragment));

  return {
    id,
    fragment: encrypted.fragment,
    link: `?f=${id}#k=${encrypted.fragment}`,
    fingerprint: fp,
    kdf: kdfResult,
  };
}

// ─── openMeta ────────────────────────────────────────────────────────────────

export const openMeta = getMeta;

// ─── peekMeta ────────────────────────────────────────────────────────────────

/**
 * Decrypt only the header (no blob download) to retrieve {kind, name, size}.
 *
 * FileMetadata.type encodes the drop kind:
 *   'application/x-share-me-bundle' → kind === 'files'
 *   'text/plain'                    → kind === 'text'
 *
 * Returns:
 *   { kind, name, size }    — on success
 *   { error: 'gone' }       — header endpoint returned 410
 *   { needsPassword: true } — file is password-protected and no password was supplied
 *
 * Throws on other unexpected errors (corrupt header, wrong key, etc.) — callers
 * should treat peekMeta as best-effort and fall back to the server lifecycle.
 */
export async function peekMeta(
  id: string,
  fragment: string,
  password?: string,
): Promise<
  | { kind: 'files' | 'text'; name: string; size: number }
  | { error: 'gone' }
  | { needsPassword: true }
> {
  // 1. Fetch the header bytes from the BFF
  const headerResult = await getHeaderBytes(id);
  if ('error' in headerResult) return { error: 'gone' };

  // 2. Decode base64 → Uint8Array
  const headerBin = atob(headerResult.headerB64);
  const header = new Uint8Array(headerBin.length);
  for (let i = 0; i < headerBin.length; i++) header[i] = headerBin.charCodeAt(i);

  // 3. Parse the header
  const parsed = parseHeader(header);

  // 4. If password-protected and no password supplied, signal the UI
  if (parsed.kdfType !== KdfType.None && !password) {
    return { needsPassword: true };
  }

  // 5. Derive keys — mirror openDrop's key-derivation path exactly
  const master = fromBase64Url(fragment);
  let kp: Uint8Array | undefined;
  if (parsed.kdfType === KdfType.Argon2id) {
    if (!password) return { needsPassword: true };
    kp = await deriveArgon2(password, parsed.salt, {
      m: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(0, false),
      t: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(4, false),
      pp: new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(8, false),
    });
  } else if (parsed.kdfType === KdfType.Pbkdf2) {
    if (!password) return { needsPassword: true };
    const { pbkdf2: derivePbkdf2 } = await import('@share-me/crypto');
    const iters = new DataView(parsed.params.buffer, parsed.params.byteOffset).getUint32(0, false);
    kp = await derivePbkdf2(password, parsed.salt, iters);
  }

  const keys = await deriveKeys(master, parsed.salt, kp);

  // 6. Decrypt the metadata — if this throws (corrupt/wrong key), let it propagate
  const meta = await decryptMetadata(keys.metadataKey, parsed.metaCiphertext);

  // 7. Derive kind from the type field set at seal time:
  //    sealFiles → type === 'application/x-share-me-bundle'
  //    sealText  → type === 'text/plain'
  const kind: 'files' | 'text' = meta.type === 'text/plain' ? 'text' : 'files';

  return { kind, name: meta.name, size: meta.size };
}

// ─── openDrop ────────────────────────────────────────────────────────────────

export interface OpenDropOpts {
  id: string;
  fragment: string;
  password?: string;
  sessionId: string;
  onProgress: (p: number) => void;
  signal?: AbortSignal;
}

export type OpenDropResult =
  | { needsPassword: true }
  | {
      needsPassword: false;
      kind: 'files' | 'text';
      files: Array<{ name: string; type: string; bytes: Uint8Array }>;
      text?: string; // populated when kind === 'text'
    };

export async function openDrop(opts: OpenDropOpts): Promise<OpenDropResult> {
  opts.onProgress(0.02);

  // 1. Fetch the header
  const headerResult = await getHeaderBytes(opts.id);
  if ('error' in headerResult) throw new Error('gone');

  // Decode the base64 header
  const headerBin = atob(headerResult.headerB64);
  const header = new Uint8Array(headerBin.length);
  for (let i = 0; i < headerBin.length; i++) header[i] = headerBin.charCodeAt(i);

  opts.onProgress(0.08);

  // 2. Parse header to check kdfType
  const parsed = parseHeader(header);

  // 3. If password-protected and none provided, signal the UI
  if (parsed.kdfType !== KdfType.None && !opts.password) {
    return { needsPassword: true };
  }

  opts.onProgress(0.15);

  // 4. Re-derive keys from the fragment to get authKey → downloadAuth
  const master = fromBase64Url(opts.fragment);

  // Derive kp (password material) if needed
  let kp: Uint8Array | undefined;
  if (parsed.kdfType === KdfType.Argon2id) {
    if (!opts.password) return { needsPassword: true };
    if (parsed.params.length < 12) throw new Error('malformed argon2id params');
    const dv = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length);
    const m = dv.getUint32(0, false);
    const t = dv.getUint32(4, false);
    const pp = dv.getUint32(8, false);
    // Bound KDF cost read from the untrusted header (matches @share-me/crypto).
    if (m < 1 || m > 1_048_576 || t < 1 || t > 64 || pp < 1 || pp > 16) {
      throw new Error('argon2id params out of range');
    }
    kp = await deriveArgon2(opts.password, parsed.salt, { m, t, pp });
  } else if (parsed.kdfType === KdfType.Pbkdf2) {
    if (!opts.password) return { needsPassword: true };
    if (parsed.params.length < 4) throw new Error('malformed pbkdf2 params');
    const { pbkdf2: derivePbkdf2 } = await import('@share-me/crypto');
    const iters = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length).getUint32(0, false);
    if (iters < 1 || iters > 20_000_000) throw new Error('pbkdf2 iterations out of range');
    kp = await derivePbkdf2(opts.password, parsed.salt, iters);
  }

  const keys = await deriveKeys(master, parsed.salt, kp);
  opts.onProgress(0.30);

  // 5. Compute download auth bearer
  const downloadAuth: DownloadAuth = await computeDownloadAuth(keys.authKey);
  const downloadAuthToken = toBase64Url(downloadAuth.token);

  opts.onProgress(0.35);

  // 6. Download + decrypt
  const decrypted = await downloadAndDecrypt({
    id: opts.id,
    fragment: opts.fragment,
    downloadAuthToken,
    sessionId: opts.sessionId,
    header,
    password: opts.password,
    onProgress: (p) => opts.onProgress(0.35 + p * 0.60),
    signal: opts.signal,
  });

  opts.onProgress(0.96);

  // 7. Decode bundle
  const bundle = decodeBundle(decrypted.plaintext);

  opts.onProgress(1.0);

  if (bundle.kind === 'text') {
    const text = new TextDecoder().decode(bundle.files[0].bytes);
    return { needsPassword: false, kind: 'text', files: bundle.files, text };
  }

  return { needsPassword: false, kind: 'files', files: bundle.files };
}
