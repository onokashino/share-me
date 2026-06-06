export { VERSION, DEFAULT_SEGMENT_SIZE, KdfType } from './constants';
export { toBase64Url, fromBase64Url } from './base64url';
export { deriveKeys, pbkdf2, type DerivedKeys } from './kdf';
export { encryptMetadata, decryptMetadata, type FileMetadata } from './metadata';
export { encodeHeader, parseHeader, verifyHeader, type HeaderFields, type ParsedHeader } from './header';
export {
  encryptToBytes,
  decryptFromBytes,
  encryptSegment,
  decryptSegment,
  segmentCountFor,
  segmentNonce,
  segmentAad,
} from './stream';
export { computeDownloadAuth, type DownloadAuth } from './auth';
export {
  encryptFile,
  decryptFile,
  type EncryptInput,
  type EncryptOutput,
  type DecryptInput,
  type DecryptOutput,
  type PasswordKdf,
  type DeriveArgon2Fn,
} from './highlevel';

