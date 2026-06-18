/**
 * drop-service.ts — Client-only orchestration seam.
 *
 * Implements:
 *  • sealFiles / sealText — encrypt + upload (streamed when the browser allows
 *    a fetch request-stream body, otherwise buffered)
 *  • openDrop             — download + decrypt into memory (preview UX)
 *  • saveDropToDisk       — stream a large files drop straight to disk via the
 *    File System Access API, never buffering the whole payload
 *  • peekMeta / openMeta / fingerprint / newSession — utilities
 *
 * The bundle container + segmented STREAM crypto live in @share-me/crypto, so
 * the web app and the CLI share one on-the-wire format byte for byte.
 *
 * Download-auth cross-boundary correctness
 * ─────────────────────────────────────────
 * apps/api hashes the UTF-8 bytes of the bearer STRING. So the client must:
 *   1. base64url-encode the token bytes → bearerString
 *   2. send hex(sha256(utf8(bearerString))) as download_auth_hash on create
 *   3. present bearerString as the Bearer when downloading
 */

'use client';

import {
  encryptFile,
  encryptFileStream,
  decryptFileStream,
  encodeBundle,
  decodeBundle,
  encodeBundleStream,
  decodeBundleStream,
  parseHeader,
  deriveKeys,
  decryptMetadata,
  computeDownloadAuth,
  toBase64Url,
  fromBase64Url,
  KdfType,
  DEFAULT_SEGMENT_SIZE,
  type ParsedHeader,
  type BundleEntry,
  type BundleStreamEntry,
} from '@share-me/crypto';
import { deriveArgon2, DEFAULT_ARGON_PARAMS } from './kdf-client';
import { createUpload, getMeta, getHeaderBytes } from './actions';
import { putBlob, putBlobStream, supportsRequestStreams } from './blob-upload';
import { openCiphertextStream } from './blob-download';

// Re-exported so existing tests (and any callers) can reach the shared bundle
// codec through this module.
export { encodeBundle, decodeBundle };

// ─── Helpers ─────────────────────────────────────────────────────────────────

const subtle = globalThis.crypto.subtle;
const GCM_TAG_LEN = 16;

/** SHA-256 of arbitrary bytes → Uint8Array */
async function sha256Bytes(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await subtle.digest('SHA-256', data.slice().buffer));
}

/** hex-encode a Uint8Array */
function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** dl-auth-hash = hex(sha256(utf8(base64url(token)))) — matches apps/api. */
async function computeDlAuthHashHex(tokenBytes: Uint8Array): Promise<string> {
  const bearerUtf8 = new TextEncoder().encode(toBase64Url(tokenBytes));
  return hexEncode(await sha256Bytes(bearerUtf8));
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

/** base64-standard decode → bytes */
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
  let n = 0;
  for (const c of chunks) n += c.length;
  const out = new Uint8Array(n);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/** Ciphertext length for a given plaintext length (one GCM tag per segment). */
function estimateCipherLen(plaintextLen: number): number {
  const segs = plaintextLen === 0 ? 1 : Math.ceil(plaintextLen / DEFAULT_SEGMENT_SIZE);
  return plaintextLen + segs * GCM_TAG_LEN;
}

/** A pass-through stream that reports byte progress against a known total. */
function countingStream(total: number, onProgress: (p: number) => void): TransformStream<Uint8Array, Uint8Array> {
  let sent = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctrl) {
      sent += chunk.byteLength;
      if (total > 0) onProgress(Math.min(1, sent / total));
      ctrl.enqueue(chunk);
    },
  });
}

/** fingerprint: SHA-256(master) → first 16 hex bytes, uppercase, space-paired */
export async function fingerprint(master: Uint8Array): Promise<string> {
  const hash = await sha256Bytes(master);
  return hexEncode(hash.slice(0, 16)).toUpperCase().match(/.{2}/g)!.join(' ');
}

/** Generate a fresh session id for a download attempt. */
export function newSession(): string {
  return crypto.randomUUID();
}

/** Derive the password key material (kp) from a parsed header. */
async function deriveKp(parsed: ParsedHeader, password: string | undefined): Promise<Uint8Array | undefined> {
  if (parsed.kdfType === KdfType.Argon2id) {
    if (!password) throw new Error('password required');
    if (parsed.params.length < 12) throw new Error('malformed argon2id params');
    const dv = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length);
    const m = dv.getUint32(0, false);
    const t = dv.getUint32(4, false);
    const pp = dv.getUint32(8, false);
    if (m < 1 || m > 1_048_576 || t < 1 || t > 64 || pp < 1 || pp > 16) {
      throw new Error('argon2id params out of range');
    }
    return deriveArgon2(password, parsed.salt, { m, t, pp });
  }
  if (parsed.kdfType === KdfType.Pbkdf2) {
    if (!password) throw new Error('password required');
    if (parsed.params.length < 4) throw new Error('malformed pbkdf2 params');
    const { pbkdf2: derivePbkdf2 } = await import('@share-me/crypto');
    const dv = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length);
    const iters = dv.getUint32(0, false);
    if (iters < 1 || iters > 20_000_000) throw new Error('pbkdf2 iterations out of range');
    return derivePbkdf2(password, parsed.salt, iters);
  }
  return undefined;
}

// ─── sealFiles / sealText ──────────────────────────────────────────────────────

export interface SealOpts {
  password?: string;
  expiry: '1h' | '1d' | '7d' | '30d';
  maxDownloads: number; // 0 = no limit
  burn: boolean;
  unlockAt?: number; // unix ms
  onProgress: (p: number) => void;
}

export interface SealResult {
  id: string;
  fragment: string;
  link: string;
  fingerprint: string;
  kdf: 'argon2id' | 'pbkdf2' | 'none';
}

export async function sealFiles(files: File[], opts: SealOpts): Promise<SealResult> {
  opts.onProgress(0.02);
  const metaName = files.length === 1 ? files[0].name : `${files.length} files`;

  // Preferred path: stream each File from disk through encryption into the PUT.
  if (supportsRequestStreams() && files.length > 0) {
    const entries: BundleStreamEntry[] = files.map((f) => ({
      name: f.name,
      type: f.type || 'application/octet-stream',
      size: f.size,
      stream: () => f.stream() as ReadableStream<Uint8Array>,
    }));
    const { totalLength, stream } = encodeBundleStream(entries, 'files');
    try {
      return await _seal({ mode: 'stream', stream, totalLength }, metaName, 'application/x-share-me-bundle', opts);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') throw e;
      // Streaming upload failed (e.g. no HTTP/2 on this host). Retry buffered
      // with a fresh upload record; the orphaned streaming record expires.
    }
  }

  const entries: BundleEntry[] = await Promise.all(
    files.map(async (f) => ({
      name: f.name,
      type: f.type || 'application/octet-stream',
      bytes: new Uint8Array(await f.arrayBuffer()),
    })),
  );
  const bundle = encodeBundle(entries, 'files');
  opts.onProgress(0.08);
  return _seal({ mode: 'buffered', bytes: bundle }, metaName, 'application/x-share-me-bundle', opts);
}

export async function sealText(text: string, opts: SealOpts): Promise<SealResult> {
  opts.onProgress(0.02);
  const bytes = new TextEncoder().encode(text);
  // Text is tiny — the buffered path keeps the simple upload-progress UX.
  const bundle = encodeBundle([{ name: 'message.txt', type: 'text/plain', bytes }], 'text');
  opts.onProgress(0.08);
  return _seal({ mode: 'buffered', bytes: bundle }, 'message.txt', 'text/plain', opts);
}

type SealPayload =
  | { mode: 'buffered'; bytes: Uint8Array }
  | { mode: 'stream'; stream: ReadableStream<Uint8Array>; totalLength: number };

/**
 * _seal — encrypt + upload a payload. metaType encodes the drop kind in the
 * encrypted metadata so receivers can tell text from files from the header
 * alone ('text/plain' → text; 'application/x-share-me-bundle' → files).
 */
async function _seal(
  payload: SealPayload,
  metaName: string,
  metaType: 'application/x-share-me-bundle' | 'text/plain',
  opts: SealOpts,
): Promise<SealResult> {
  const pw = opts.password
    ? { password: opts.password, passwordKdf: { type: 'argon2id' as const, argon: DEFAULT_ARGON_PARAMS, deriveArgon2 } }
    : {};

  let header: Uint8Array;
  let fragment: string;
  let downloadAuthToken: Uint8Array;
  let sendBlob: (id: string, uploadToken: string) => Promise<void>;

  if (payload.mode === 'stream') {
    const enc = await encryptFileStream({
      source: payload.stream,
      totalLength: payload.totalLength,
      meta: { name: metaName, type: metaType, size: payload.totalLength },
      ...pw,
    });
    header = enc.header;
    fragment = enc.fragment;
    downloadAuthToken = enc.downloadAuth.token;
    const counted = enc.ciphertextStream.pipeThrough(
      countingStream(estimateCipherLen(payload.totalLength), (p) => opts.onProgress(0.65 + p * 0.33)),
    );
    sendBlob = (id, uploadToken) => putBlobStream(id, uploadToken, counted);
  } else {
    const enc = await encryptFile({
      plaintext: payload.bytes,
      meta: { name: metaName, type: metaType, size: payload.bytes.length },
      ...pw,
    });
    header = enc.header;
    fragment = enc.fragment;
    downloadAuthToken = enc.downloadAuth.token;
    sendBlob = (id, uploadToken) => putBlob(id, uploadToken, enc.ciphertext, (p) => opts.onProgress(0.65 + p * 0.33));
  }
  opts.onProgress(0.55);

  const kdf: 'argon2id' | 'pbkdf2' | 'none' = opts.password
    ? header[5] === KdfType.Argon2id
      ? 'argon2id'
      : 'pbkdf2'
    : 'none';

  const dlAuthHashHex = await computeDlAuthHashHex(downloadAuthToken);
  const expiresInSecs = expiryToSecs(opts.expiry);
  const maxDownloads = opts.burn ? 1 : opts.maxDownloads || undefined;
  const unlockInSecs = opts.unlockAt ? Math.floor((opts.unlockAt - Date.now()) / 1000) : undefined;

  const { id, uploadToken } = await createUpload({
    headerB64: base64Std(header),
    dlAuthHashHex,
    maxDownloads,
    expiresInSecs,
    unlockInSecs: unlockInSecs && unlockInSecs > 0 ? unlockInSecs : undefined,
  });
  opts.onProgress(0.65);

  await sendBlob(id, uploadToken);
  opts.onProgress(0.99);

  const fp = await fingerprint(fromBase64Url(fragment));
  return { id, fragment, link: `?f=${id}#k=${fragment}`, fingerprint: fp, kdf };
}

// ─── openMeta ────────────────────────────────────────────────────────────────

export const openMeta = getMeta;

// ─── peekMeta ────────────────────────────────────────────────────────────────

/**
 * Decrypt only the header (no blob download) to retrieve {kind, name, size}.
 * Best-effort: returns { error:'gone' } on 410 and { needsPassword:true } when
 * a password is needed; throws on other unexpected errors.
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
  const headerResult = await getHeaderBytes(id);
  if ('error' in headerResult) return { error: 'gone' };

  const header = b64ToBytes(headerResult.headerB64);
  const parsed = parseHeader(header);

  if (parsed.kdfType !== KdfType.None && !password) {
    return { needsPassword: true };
  }

  const master = fromBase64Url(fragment);
  const kp = await deriveKp(parsed, password);
  const keys = await deriveKeys(master, parsed.salt, kp);

  const meta = await decryptMetadata(keys.metadataKey, parsed.metaCiphertext);
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
      text?: string;
    };

export async function openDrop(opts: OpenDropOpts): Promise<OpenDropResult> {
  opts.onProgress(0.02);

  const headerResult = await getHeaderBytes(opts.id);
  if ('error' in headerResult) throw new Error('gone');
  const header = b64ToBytes(headerResult.headerB64);
  opts.onProgress(0.08);

  const parsed = parseHeader(header);
  if (parsed.kdfType !== KdfType.None && !opts.password) {
    return { needsPassword: true };
  }
  opts.onProgress(0.15);

  const master = fromBase64Url(opts.fragment);
  const kp = await deriveKp(parsed, opts.password);
  const keys = await deriveKeys(master, parsed.salt, kp);
  opts.onProgress(0.3);

  const downloadAuthToken = toBase64Url((await computeDownloadAuth(keys.authKey)).token);
  opts.onProgress(0.35);

  const { stream, total } = await openCiphertextStream({
    id: opts.id,
    downloadAuthToken,
    sessionId: opts.sessionId,
    signal: opts.signal,
  });
  const counted = stream.pipeThrough(countingStream(total, (p) => opts.onProgress(0.35 + p * 0.6)));
  const { plaintextStream } = await decryptFileStream({
    header,
    ciphertextStream: counted,
    fragment: opts.fragment,
    password: opts.password,
    deriveArgon2,
  });

  // Assemble in memory so the receiver UI can preview / save / zip.
  const files: Array<{ name: string; type: string; bytes: Uint8Array }> = [];
  let isText = false;
  await decodeBundleStream(plaintextStream, async (file, pipe) => {
    if (file.kind === 'text') isText = true;
    const chunks: Uint8Array[] = [];
    await pipe((c) => {
      chunks.push(c);
    });
    files.push({ name: file.name, type: file.type, bytes: concatChunks(chunks) });
  });
  opts.onProgress(1.0);

  if (isText) {
    const text = new TextDecoder().decode(files[0]?.bytes ?? new Uint8Array());
    return { needsPassword: false, kind: 'text', files, text };
  }
  return { needsPassword: false, kind: 'files', files };
}

// ─── saveDropToDisk (File System Access — large files, constant memory) ────────

/** Whether this browser can stream downloads straight to a chosen directory. */
export function supportsFileSystemAccess(): boolean {
  return typeof (globalThis as unknown as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

export interface SaveToDiskOpts {
  id: string;
  fragment: string;
  password?: string;
  sessionId: string;
  onProgress: (p: number) => void;
  signal?: AbortSignal;
}

export type SaveToDiskResult = { kind: 'saved'; names: string[] } | { needsPassword: true };

function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() || 'file';
  const cleaned = base.replace(/[<>:"/\\|?* -]/g, '_').replace(/^\.+/, '').trim();
  return cleaned || 'file';
}

/**
 * Stream a files drop directly to a user-chosen directory, never holding the
 * whole payload in memory. The directory picker is opened first (it must run
 * inside the caller's click gesture). Throws 'picker-cancelled' if dismissed.
 */
export async function saveDropToDisk(opts: SaveToDiskOpts): Promise<SaveToDiskResult> {
  // Open the directory picker first, while the user gesture is still fresh.
  let dir: FileSystemDirectoryHandle;
  try {
    dir = await (
      globalThis as unknown as {
        showDirectoryPicker: (o?: { mode?: string }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker({ mode: 'readwrite' });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw new Error('picker-cancelled');
    throw e;
  }

  const headerResult = await getHeaderBytes(opts.id);
  if ('error' in headerResult) throw new Error('gone');
  const header = b64ToBytes(headerResult.headerB64);
  const parsed = parseHeader(header);
  if (parsed.kdfType !== KdfType.None && !opts.password) return { needsPassword: true };

  const master = fromBase64Url(opts.fragment);
  const kp = await deriveKp(parsed, opts.password);
  const keys = await deriveKeys(master, parsed.salt, kp);
  const downloadAuthToken = toBase64Url((await computeDownloadAuth(keys.authKey)).token);

  const { stream, total } = await openCiphertextStream({
    id: opts.id,
    downloadAuthToken,
    sessionId: opts.sessionId,
    signal: opts.signal,
  });
  const counted = stream.pipeThrough(countingStream(total, opts.onProgress));
  const { plaintextStream } = await decryptFileStream({
    header,
    ciphertextStream: counted,
    fragment: opts.fragment,
    password: opts.password,
    deriveArgon2,
  });

  const names: string[] = [];
  await decodeBundleStream(plaintextStream, async (file, pipe) => {
    const safe = sanitizeName(file.name);
    const fh = await dir.getFileHandle(safe, { create: true });
    const writable = await fh.createWritable();
    try {
      await pipe(async (c) => {
        await writable.write(c as unknown as BufferSource);
      });
      await writable.close();
    } catch (e) {
      await writable.abort().catch(() => {});
      throw e;
    }
    names.push(safe);
  });

  return { kind: 'saved', names };
}
