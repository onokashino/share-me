import { META_AAD, NONCE_LEN } from './constants';
import { gcmDecrypt, gcmEncrypt, importAesKey } from './aead';

export interface FileMetadata {
  name: string;
  type: string;
  size: number;
  segmentCount: number;
  expiresAt: number | null; // epoch ms, defense-in-depth copy of the server-side expiry
}

// Zero nonce is safe: used EXACTLY ONCE under a per-file metadata key (§4.4).
const ZERO_NONCE = new Uint8Array(NONCE_LEN);

export async function encryptMetadata(metaKey: Uint8Array, meta: FileMetadata): Promise<Uint8Array> {
  const key = await importAesKey(metaKey);
  const pt = new TextEncoder().encode(JSON.stringify(meta));
  return gcmEncrypt(key, ZERO_NONCE, META_AAD, pt);
}

export async function decryptMetadata(metaKey: Uint8Array, ciphertext: Uint8Array): Promise<FileMetadata> {
  const key = await importAesKey(metaKey);
  const pt = await gcmDecrypt(key, ZERO_NONCE, META_AAD, ciphertext);
  return JSON.parse(new TextDecoder().decode(pt)) as FileMetadata;
}

