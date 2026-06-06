/**
 * blob-download.ts — Client-only; browser→Rust blob download via fetch + reader.
 *
 * Reads the response body incrementally, reporting progress against
 * Content-Length, then hands the assembled ciphertext to @share-me/crypto
 * for in-memory decryption.
 */

import { decryptFile, type DecryptOutput } from '@share-me/crypto';
import { deriveArgon2 } from './kdf-client';

export async function downloadAndDecrypt(opts: {
  id: string;
  fragment: string;
  downloadAuthToken: string;
  sessionId: string;
  header: Uint8Array;
  password?: string;
  onProgress: (p: number) => void;
  signal?: AbortSignal;
}): Promise<DecryptOutput> {
  const res = await fetch(`/api/v1/dl/${opts.id}/blob`, {
    headers: {
      Authorization: `Bearer ${opts.downloadAuthToken}`,
      'x-download-session': opts.sessionId,
    },
    signal: opts.signal,
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 410) throw new Error('gone');
  if (res.status === 423) throw new Error('locked');
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get('Content-Length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.byteLength;
    if (total > 0) opts.onProgress(received / total);
  }

  // Assemble into a single Uint8Array
  const ciphertext = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) {
    ciphertext.set(c, off);
    off += c.byteLength;
  }

  return decryptFile({
    header: opts.header,
    ciphertext,
    fragment: opts.fragment,
    password: opts.password,
    deriveArgon2,
  });
}
