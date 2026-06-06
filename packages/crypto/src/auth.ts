import { DL_AUTH_CONTEXT } from './constants';
import { hmacSign, sha256 } from './aead';

export interface DownloadAuth {
  token: Uint8Array; // sent by the recipient to fetch the blob
  hash: Uint8Array;  // SHA-256(token); stored server-side at upload
}

export async function computeDownloadAuth(authKey: Uint8Array): Promise<DownloadAuth> {
  const token = await hmacSign(authKey, new TextEncoder().encode(DL_AUTH_CONTEXT));
  const hash = await sha256(token);
  return { token, hash };
}

