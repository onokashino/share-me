export const MAGIC = new Uint8Array([0x53, 0x48, 0x4d, 0x45]); // "SHME"
export const VERSION = 1;

export const KEY_LEN = 32;          // AES-256 / HMAC-256 key bytes
export const SALT_LEN = 16;
export const NONCE_LEN = 12;        // 96-bit GCM nonce
export const NONCE_PREFIX_LEN = 7;  // prefix ‖ u32 counter ‖ 1 flag = 12
export const TAG_LEN = 16;          // GCM tag bytes
export const COMMIT_LEN = 32;
export const HMAC_LEN = 32;
export const MASTER_LEN = 32;       // URL-fragment master secret

export const DEFAULT_SEGMENT_SIZE = 1024 * 1024; // 1 MiB
export const MAX_SEGMENT_COUNT = 0xffffffff;     // 32-bit counter ceiling (hard cap)

export const PBKDF2_ITERS = 600_000;

export const KdfType = { None: 0, Argon2id: 1, Pbkdf2: 2 } as const;
export type KdfTypeValue = (typeof KdfType)[keyof typeof KdfType];

const variant = (pw: boolean) => (pw ? 'pw' : 'nopw');
export const INFO = {
  content: (pw: boolean) => `share-me/v1/content-key/${variant(pw)}`,
  metadata: (pw: boolean) => `share-me/v1/metadata-key/${variant(pw)}`,
  auth: (pw: boolean) => `share-me/v1/auth-token/${variant(pw)}`,
  commit: (pw: boolean) => `share-me/v1/commit/${variant(pw)}`,
  noncePrefix: (pw: boolean) => `share-me/v1/nonce-prefix/${variant(pw)}`,
} as const;

export const DL_AUTH_CONTEXT = 'share-me/v1/dl-auth';
export const SEG_AAD_TAG = new TextEncoder().encode('shme-seg');
export const META_AAD = new TextEncoder().encode('shme-meta');

