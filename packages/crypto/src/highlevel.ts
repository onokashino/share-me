import { DEFAULT_SEGMENT_SIZE, KdfType, MASTER_LEN, PBKDF2_ITERS } from './constants';
import { concatBytes, randomBytes, readU32be, u32be } from './bytes';
import { fromBase64Url, toBase64Url } from './base64url';
import { deriveKeys, pbkdf2 } from './kdf';
import { encryptMetadata, decryptMetadata, type FileMetadata } from './metadata';
import { encodeHeader, parseHeader, verifyHeader } from './header';
import { importAesKey } from './aead';
import { decryptFromBytes, decryptStream, encryptStream, encryptToBytes, segmentCountFor } from './stream';
import { computeDownloadAuth, type DownloadAuth } from './auth';

// Upper bounds on KDF cost parameters read from the (untrusted) header. Reject
// absurd values before invoking the KDF so a hostile server cannot make the
// client allocate gigabytes / hang. Generous — well above any legit setting.
const MAX_PBKDF2_ITERS = 20_000_000;
const MAX_ARGON2_MEM_KIB = 1_048_576; // 1 GiB
const MAX_ARGON2_TIME = 64;
const MAX_ARGON2_LANES = 16;

/** Argon2id derivation function type — injected by the caller (e.g. apps/web provides a worker-based implementation). */
export type DeriveArgon2Fn = (
  password: string,
  salt: Uint8Array,
  p: { m: number; t: number; pp: number },
) => Promise<Uint8Array>;

export type PasswordKdf =
  | { type: 'pbkdf2'; iterations?: number }
  | { type: 'argon2id'; argon: { m: number; t: number; pp: number }; deriveArgon2: DeriveArgon2Fn };

/** Fields shared by the buffered and streaming encrypt entry points. */
interface EncryptParams {
  meta: { name: string; type: string; size: number; expiresAt?: number | null };
  password?: string;
  pbkdf2Iters?: number; // legacy — treated as { type:'pbkdf2', iterations }; defaults to PBKDF2_ITERS
  passwordKdf?: PasswordKdf;
}

interface PreparedEncryption {
  fragment: string;
  header: Uint8Array;
  downloadAuth: DownloadAuth;
  contentKey: CryptoKey;
  noncePrefix: Uint8Array;
}

/**
 * Everything an encryption needs except the bytes themselves: fresh master +
 * salt, KDF resolution, derived keys, encrypted metadata, and the signed
 * header. Shared by encryptFile (buffered) and encryptFileStream so the wire
 * format has exactly one source of truth. `plaintextLength` feeds the segment
 * count stored in the metadata and must equal the real plaintext byte length.
 */
async function prepareEncryption(
  input: EncryptParams,
  plaintextLength: number,
  segmentSize: number,
): Promise<PreparedEncryption> {
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

  const fileMeta: FileMetadata = {
    name: input.meta.name,
    type: input.meta.type,
    size: input.meta.size,
    segmentCount: segmentCountFor(plaintextLength, segmentSize),
    expiresAt: input.meta.expiresAt ?? null,
  };
  const metaCiphertext = await encryptMetadata(keys.metadataKey, fileMeta);

  const header = await encodeHeader(
    { kdfType, salt, segmentSize, params, metaCiphertext, commit: keys.commit },
    keys.authKey,
  );

  const contentKey = await importAesKey(keys.contentKey);
  const downloadAuth = await computeDownloadAuth(keys.authKey);
  return { fragment: toBase64Url(master), header, downloadAuth, contentKey, noncePrefix: keys.noncePrefix };
}

export interface EncryptInput extends EncryptParams {
  plaintext: Uint8Array;
  segmentSize?: number;
}

export interface EncryptOutput {
  fragment: string;       // base64url(master) → URL '#'
  header: Uint8Array;
  ciphertext: Uint8Array;
  downloadAuth: DownloadAuth;
}

export async function encryptFile(input: EncryptInput): Promise<EncryptOutput> {
  const segmentSize = input.segmentSize ?? DEFAULT_SEGMENT_SIZE;
  const prep = await prepareEncryption(input, input.plaintext.length, segmentSize);
  const ciphertext = await encryptToBytes(prep.contentKey, prep.noncePrefix, input.plaintext, segmentSize);
  return { fragment: prep.fragment, header: prep.header, ciphertext, downloadAuth: prep.downloadAuth };
}

export interface EncryptStreamInput extends EncryptParams {
  /** Plaintext byte stream (e.g. File.stream() or a bundle source). */
  source: ReadableStream<Uint8Array>;
  /** Exact total plaintext byte length — must match what `source` yields. */
  totalLength: number;
  segmentSize?: number;
}

export interface EncryptStreamOutput {
  fragment: string;
  header: Uint8Array;
  ciphertextStream: ReadableStream<Uint8Array>;
  downloadAuth: DownloadAuth;
}

/**
 * Streaming counterpart of {@link encryptFile}. Produces the same header and a
 * ciphertext *stream* whose bytes are identical to encryptFile's `ciphertext`
 * for the same plaintext, so streamed and buffered uploads interoperate.
 */
export async function encryptFileStream(input: EncryptStreamInput): Promise<EncryptStreamOutput> {
  const segmentSize = input.segmentSize ?? DEFAULT_SEGMENT_SIZE;
  const prep = await prepareEncryption(input, input.totalLength, segmentSize);
  const ciphertextStream = input.source.pipeThrough(encryptStream(prep.contentKey, prep.noncePrefix, segmentSize));
  return { fragment: prep.fragment, header: prep.header, ciphertextStream, downloadAuth: prep.downloadAuth };
}

interface PreparedDecryption {
  meta: FileMetadata;
  contentKey: CryptoKey;
  noncePrefix: Uint8Array;
  segmentSize: number;
}

/**
 * Resolve the KDF, verify the commitment + header HMAC, and decrypt the
 * metadata BEFORE any ciphertext is touched. Shared by decryptFile and
 * decryptFileStream so both paths authenticate the header identically.
 */
async function prepareDecryption(
  header: Uint8Array,
  fragment: string,
  password: string | undefined,
  deriveArgon2: DeriveArgon2Fn | undefined,
): Promise<PreparedDecryption> {
  const master = fromBase64Url(fragment);
  const parsed = parseHeader(header);

  let kp: Uint8Array | undefined;
  if (parsed.kdfType === KdfType.Pbkdf2) {
    if (password === undefined) throw new Error('this file requires a password');
    if (parsed.params.length < 4) throw new Error('malformed pbkdf2 params');
    const iters = readU32be(parsed.params, 0);
    if (iters < 1 || iters > MAX_PBKDF2_ITERS) throw new Error('pbkdf2 iterations out of range');
    kp = await pbkdf2(password, parsed.salt, iters);
  } else if (parsed.kdfType === KdfType.Argon2id) {
    if (password === undefined) throw new Error('this file requires a password');
    if (!deriveArgon2) throw new Error('argon2id derive function not provided');
    if (parsed.params.length < 12) throw new Error('malformed argon2id params');
    const m = readU32be(parsed.params, 0);
    const t = readU32be(parsed.params, 4);
    const pp = readU32be(parsed.params, 8);
    // Bound KDF cost read from the untrusted header before invoking it.
    if (m < 1 || m > MAX_ARGON2_MEM_KIB || t < 1 || t > MAX_ARGON2_TIME || pp < 1 || pp > MAX_ARGON2_LANES) {
      throw new Error('argon2id params out of range');
    }
    kp = await deriveArgon2(password, parsed.salt, { m, t, pp });
  } else {
    // KdfType.None
    if (password !== undefined) throw new Error('this file is not password-protected');
  }

  const keys = await deriveKeys(master, parsed.salt, kp);

  // Verify commitment + header HMAC BEFORE releasing any plaintext.
  await verifyHeader(parsed, keys.authKey, keys.commit);

  const meta = await decryptMetadata(keys.metadataKey, parsed.metaCiphertext);
  const contentKey = await importAesKey(keys.contentKey);
  return { meta, contentKey, noncePrefix: keys.noncePrefix, segmentSize: parsed.segmentSize };
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
  const prep = await prepareDecryption(input.header, input.fragment, input.password, input.deriveArgon2);
  const plaintext = await decryptFromBytes(prep.contentKey, prep.noncePrefix, input.ciphertext, prep.segmentSize);
  return { meta: prep.meta, plaintext };
}

export interface DecryptStreamInput {
  header: Uint8Array;
  ciphertextStream: ReadableStream<Uint8Array>;
  fragment: string;
  password?: string;
  deriveArgon2?: DeriveArgon2Fn;
}

export interface DecryptStreamOutput {
  meta: FileMetadata;
  plaintextStream: ReadableStream<Uint8Array>;
}

/**
 * Streaming counterpart of {@link decryptFile}. The header is fully
 * authenticated before the returned `plaintextStream` yields anything; each
 * ciphertext segment is then verified as it flows. See {@link decryptStream}
 * for the progressive-release caveat.
 */
export async function decryptFileStream(input: DecryptStreamInput): Promise<DecryptStreamOutput> {
  const prep = await prepareDecryption(input.header, input.fragment, input.password, input.deriveArgon2);
  const plaintextStream = input.ciphertextStream.pipeThrough(
    decryptStream(prep.contentKey, prep.noncePrefix, prep.segmentSize),
  );
  return { meta: prep.meta, plaintextStream };
}
