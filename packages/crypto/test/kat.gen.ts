// Run with: npx tsx test/kat.gen.ts > test/vectors/kat.json
import { deriveKeys } from '../src/kdf.js';
import { importAesKey } from '../src/aead.js';
import { encryptToBytes } from '../src/stream.js';

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');

const master = new Uint8Array(32).fill(0x11);
const salt = new Uint8Array(16).fill(0x22);
const plaintext = new Uint8Array(1024 + 5).map((_, i) => i & 0xff);
const segmentSize = 1024;

const keys = await deriveKeys(master, salt);
const contentKey = await importAesKey(keys.contentKey);
const ciphertext = await encryptToBytes(contentKey, keys.noncePrefix, plaintext, segmentSize);

console.log(
  JSON.stringify(
    {
      master: hex(master),
      salt: hex(salt),
      segmentSize,
      plaintextLen: plaintext.length,
      contentKey: hex(keys.contentKey),
      noncePrefix: hex(keys.noncePrefix),
      ciphertext: hex(ciphertext),
    },
    null,
    2,
  ),
);
