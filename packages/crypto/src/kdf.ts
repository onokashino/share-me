import { INFO, KEY_LEN, NONCE_PREFIX_LEN, PBKDF2_ITERS } from './constants';
import { concatBytes, toArrayBuffer } from './bytes';

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: string, lenBytes: number): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', toArrayBuffer(ikm), 'HKDF', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: toArrayBuffer(salt), info: toArrayBuffer(enc.encode(info)) },
    key,
    lenBytes * 8,
  );
  return new Uint8Array(bits);
}

export async function pbkdf2(password: string, salt: Uint8Array, iterations: number = PBKDF2_ITERS): Promise<Uint8Array> {
  const key = await subtle.importKey('raw', toArrayBuffer(enc.encode(password)), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: toArrayBuffer(salt), iterations },
    key,
    KEY_LEN * 8,
  );
  return new Uint8Array(bits);
}

export interface DerivedKeys {
  contentKey: Uint8Array;
  metadataKey: Uint8Array;
  authKey: Uint8Array;
  commit: Uint8Array;
  noncePrefix: Uint8Array;
}

/**
 * Derive all sub-keys. WebCrypto's HKDF performs Extract(salt, ikm) then Expand(info),
 * so passing the same (salt, ikm) with distinct info labels realises the spec's
 * "HKDF-Extract(salt, M‖Kp) then Expand with distinct info" in one call per sub-key.
 * Password material (kp) is CONCATENATED into the IKM — never XORed.
 */
export async function deriveKeys(master: Uint8Array, salt: Uint8Array, kp?: Uint8Array): Promise<DerivedKeys> {
  const pw = kp !== undefined;
  const ikm = pw ? concatBytes(master, kp) : master;
  const [contentKey, metadataKey, authKey, commit, noncePrefix] = await Promise.all([
    hkdf(salt, ikm, INFO.content(pw), KEY_LEN),
    hkdf(salt, ikm, INFO.metadata(pw), KEY_LEN),
    hkdf(salt, ikm, INFO.auth(pw), KEY_LEN),
    hkdf(salt, ikm, INFO.commit(pw), KEY_LEN),
    hkdf(salt, ikm, INFO.noncePrefix(pw), NONCE_PREFIX_LEN),
  ]);
  return { contentKey, metadataKey, authKey, commit, noncePrefix };
}

