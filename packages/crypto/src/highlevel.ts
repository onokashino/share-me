import { DEFAULT_SEGMENT_SIZE, KdfType, MASTER_LEN, PBKDF2_ITERS } from './constants';
import { concatBytes, randomBytes, readU32be, u32be } from './bytes';
import { fromBase64Url, toBase64Url } from './base64url';
import { deriveKeys, pbkdf2 } from './kdf';
import { encryptMetadata, decryptMetadata, type FileMetadata } from './metadata';
import { encodeHeader, parseHeader, verifyHeader } from './header';
import { importAesKey } from './aead';
import { decryptFromBytes, encryptToBytes, segmentCountFor } from './stream';
import { computeDownloadAuth, type DownloadAuth } from './auth';

/** Argon2id derivation function type — injected by the caller (e.g. apps/web provides a worker-based implementation). */
export type DeriveArgon2Fn = (
  password: string,
  salt: Uint8Array,
  p: { m: number; t: number; pp: number },
) => Promise<Uint8Array>;

export type PasswordKdf =
  | { type: 'pbkdf2'; iterations?: number }
  | { type: 'argon2id'; argon: { m: number; t: number; pp: number }; deriveArgon2: DeriveArgon2Fn };

export interface EncryptInput {
  plaintext: Uint8Array;
  meta: { name: string; type: string; size: number; expiresAt?: number | null };
  password?: string;
  segmentSize?: number;
  pbkdf2Iters?: number; // legacy — treated as { type:'pbkdf2', iterations }; defaults to PBKDF2_ITERS
  passwordKdf?: PasswordKdf;
}

export interface EncryptOutput {
  fragment: string;       // base64url(master) → URL '#'
  header: Uint8Array;
  ciphertext: Uint8Array;
  downloadAuth: DownloadAuth;
}

export async function encryptFile(input: EncryptInput): Promise<EncryptOutput> {
  const segmentSize = input.segmentSize ?? DEFAULT_SEGMENT_SIZE;
  const master = randomBytes(MASTER_LEN);
  const salt = randomBytes(16);

  let kp: Uint8Array | undefined;
  let kdfType: number;
  let params: Uint8Array;

  if (input.password !== undefined) {
    // Resolve the KDF tier: explicit passwordKdf > legacy pbkdf2Iters > default pbkdf2
    const kdf: PasswordKdf =
      input.passwordKdf ??
      (input.pbkdf2Iters !== undefined
        ? { type: 'pbkdf2', iterations: input.pbkdf2Iters }
        : { type: 'pbkdf2' });

    if (kdf.type === 'argon2id') {
      kp = await kdf.deriveArgon2(input.password, salt, kdf.argon);
      kdfType = KdfType.Argon2id;
      params = concatBytes(u32be(kdf.argon.m), u32be(kdf.argon.t), u32be(kdf.argon.pp));
    } else {
      const iters = kdf.iterations ?? PBKDF2_ITERS;
      kp = await pbkdf2(input.password, salt, iters);
      kdfType = KdfType.Pbkdf2;
      params = u32be(iters);
    }
  } else {
    kdfType = KdfType.None;
    params = new Uint8Array(0);
  }

  const keys = await deriveKeys(master, salt, kp);

  const segmentCount = segmentCountFor(input.plaintext.length, segmentSize);
  const fileMeta: FileMetadata = {
    name: input.meta.name,
    type: input.meta.type,
    size: input.meta.size,
    segmentCount,
    expiresAt: input.meta.expiresAt ?? null,
  };
  const metaCiphertext = await encryptMetadata(keys.metadataKey, fileMeta);

  const header = await encodeHeader(
    { kdfType, salt, segmentSize, params, metaCiphertext, commit: keys.commit },
    keys.authKey,
  );

  const contentKey = await importAesKey(keys.contentKey);
  const ciphertext = await encryptToBytes(contentKey, keys.noncePrefix, input.plaintext, segmentSize);

  const downloadAuth = await computeDownloadAuth(keys.authKey);
  return { fragment: toBase64Url(master), header, ciphertext, downloadAuth };
}

export interface DecryptInput {
  header: Uint8Array;
  ciphertext: Uint8Array;
  fragment: string;
  password?: string;
  /** Required when decrypting an Argon2id-protected file. Injected by the caller (e.g. apps/web's worker-based implementation). */
  deriveArgon2?: DeriveArgon2Fn;
}

export interface DecryptOutput {
  meta: FileMetadata;
  plaintext: Uint8Array;
}

export async function decryptFile(input: DecryptInput): Promise<DecryptOutput> {
  const master = fromBase64Url(input.fragment);
  const parsed = parseHeader(input.header);

  let kp: Uint8Array | undefined;
  if (parsed.kdfType === KdfType.Pbkdf2) {
    if (input.password === undefined) throw new Error('this file requires a password');
    const iters = readU32be(parsed.params, 0);
    kp = await pbkdf2(input.password, parsed.salt, iters);
  } else if (parsed.kdfType === KdfType.Argon2id) {
    if (input.password === undefined) throw new Error('this file requires a password');
    if (!input.deriveArgon2) throw new Error('argon2id derive function not provided');
    const m = readU32be(parsed.params, 0);
    const t = readU32be(parsed.params, 4);
    const pp = readU32be(parsed.params, 8);
    kp = await input.deriveArgon2(input.password, parsed.salt, { m, t, pp });
  } else {
    // KdfType.None
    if (input.password !== undefined) throw new Error('this file is not password-protected');
  }

  const keys = await deriveKeys(master, parsed.salt, kp);

  // Verify commitment + header HMAC BEFORE releasing any plaintext.
  await verifyHeader(parsed, keys.authKey, keys.commit);

  const meta = await decryptMetadata(keys.metadataKey, parsed.metaCiphertext);
  const contentKey = await importAesKey(keys.contentKey);
  const plaintext = await decryptFromBytes(contentKey, keys.noncePrefix, input.ciphertext, parsed.segmentSize);
  return { meta, plaintext };
}

