import { argon2id } from 'hash-wasm';
import { toBase64Url } from '@share-me/crypto';

/** Argon2id cost parameters — identical to the browser client's defaults. */
export const DEFAULT_ARGON_PARAMS = { m: 19456, t: 2, pp: 1 } as const;

/** DeriveArgon2Fn for @share-me/crypto, backed by hash-wasm (no Web Worker in Node). */
export const deriveArgon2 = async (
  password: string,
  salt: Uint8Array,
  p: { m: number; t: number; pp: number },
): Promise<Uint8Array> =>
  argon2id({
    password,
    salt,
    parallelism: p.pp,
    iterations: p.t,
    memorySize: p.m,
    hashLength: 32,
    outputType: 'binary',
  });

export function hexEncode(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** base64-standard (the header bytes are sent to the API as base64-std). */
export function base64Std(bytes: Uint8Array): string {
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * Must match what apps/api stores and compares:
 *   server does sha256_hex(bearerString) over the UTF-8 bytes of the bearer,
 *   and the bearer string is base64url(token).
 */
export async function computeDlAuthHashHex(tokenBytes: Uint8Array): Promise<string> {
  const bearerUtf8 = new TextEncoder().encode(toBase64Url(tokenBytes));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bearerUtf8);
  return hexEncode(new Uint8Array(digest));
}
