import { expect, test } from 'vitest';
import { decryptMetadata, encryptMetadata, type FileMetadata } from '../src/metadata.js';

const metaKey = new Uint8Array(32).fill(5);
const meta: FileMetadata = { name: 'secret.pdf', type: 'application/pdf', size: 1234, segmentCount: 2, expiresAt: null };

test('metadata round-trips under the metadata key', async () => {
  const ct = await encryptMetadata(metaKey, meta);
  expect(ct.length).toBeGreaterThan(16);
  expect(await decryptMetadata(metaKey, ct)).toEqual(meta);
});

test('a wrong key fails to decrypt metadata', async () => {
  const ct = await encryptMetadata(metaKey, meta);
  await expect(decryptMetadata(new Uint8Array(32).fill(6), ct)).rejects.toThrow();
});
