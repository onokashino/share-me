import { COMMIT_LEN, HMAC_LEN, MAGIC, SALT_LEN, VERSION } from './constants';
import { concatBytes, constantTimeEqual, readU32be, u32be } from './bytes';
import { hmacSign } from './aead';

export interface HeaderFields {
  kdfType: number;
  salt: Uint8Array;
  segmentSize: number;
  params: Uint8Array;
  metaCiphertext: Uint8Array;
  commit: Uint8Array;
}

export interface ParsedHeader extends HeaderFields {
  preHmac: Uint8Array; // bytes covered by the HMAC
  hmac: Uint8Array;
  byteLength: number;  // total header length (so the caller can locate the ciphertext stream)
}

export async function encodeHeader(f: HeaderFields, authKey: Uint8Array): Promise<Uint8Array> {
  if (f.salt.length !== SALT_LEN) throw new Error('bad salt length');
  if (f.commit.length !== COMMIT_LEN) throw new Error('bad commit length');
  if (f.params.length > 255) throw new Error('params too long');
  const pre = concatBytes(
    MAGIC,
    new Uint8Array([VERSION, f.kdfType]),
    f.salt,
    u32be(f.segmentSize),
    new Uint8Array([f.params.length]),
    f.params,
    u32be(f.metaCiphertext.length),
    f.metaCiphertext,
    f.commit,
  );
  const hmac = await hmacSign(authKey, pre);
  return concatBytes(pre, hmac);
}

export function parseHeader(bytes: Uint8Array): ParsedHeader {
  let o = 0;
  const need = (n: number) => {
    if (o + n > bytes.length) throw new Error('header truncated');
  };
  need(4);
  if (!constantTimeEqual(bytes.subarray(0, 4), MAGIC)) throw new Error('bad magic');
  o = 4;
  need(2);
  const version = bytes[o++]!;
  if (version !== VERSION) throw new Error(`unsupported version ${version}`);
  const kdfType = bytes[o++]!;
  need(SALT_LEN);
  const salt = bytes.subarray(o, o + SALT_LEN);
  o += SALT_LEN;
  need(4);
  const segmentSize = readU32be(bytes, o);
  o += 4;
  need(1);
  const paramsLen = bytes[o++]!;
  need(paramsLen);
  const params = bytes.subarray(o, o + paramsLen);
  o += paramsLen;
  need(4);
  const metaLen = readU32be(bytes, o);
  o += 4;
  need(metaLen);
  const metaCiphertext = bytes.subarray(o, o + metaLen);
  o += metaLen;
  need(COMMIT_LEN);
  const commit = bytes.subarray(o, o + COMMIT_LEN);
  o += COMMIT_LEN;
  const preHmac = bytes.subarray(0, o);
  need(HMAC_LEN);
  const hmac = bytes.subarray(o, o + HMAC_LEN);
  o += HMAC_LEN;
  return { kdfType, salt, segmentSize, params, metaCiphertext, commit, preHmac, hmac, byteLength: o };
}

export async function verifyHeader(parsed: ParsedHeader, authKey: Uint8Array, derivedCommit: Uint8Array): Promise<void> {
  if (!constantTimeEqual(parsed.commit, derivedCommit)) throw new Error('commit mismatch (wrong key/password)');
  const expected = await hmacSign(authKey, parsed.preHmac);
  if (!constantTimeEqual(parsed.hmac, expected)) throw new Error('header HMAC verification failed');
}

