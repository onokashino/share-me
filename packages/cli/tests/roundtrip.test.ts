import { describe, it, expect } from 'vitest';
import { encryptFile, decryptFile } from '@share-me/crypto';
import { DEFAULT_ARGON_PARAMS, deriveArgon2, computeDlAuthHashHex } from '../src/crypto-node';

const sample = new TextEncoder().encode('hello from the share-me CLI ✨');

describe('crypto round-trip in Node', () => {
  it('encrypts and decrypts without a password', async () => {
    const enc = await encryptFile({ plaintext: sample, meta: { name: 'note.txt', type: 'text/plain', size: sample.length } });
    const dec = await decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment });
    expect(new Uint8Array(dec.plaintext)).toEqual(sample);
    expect(dec.meta.name).toBe('note.txt');
  });

  it('round-trips with an Argon2id password', async () => {
    const enc = await encryptFile({
      plaintext: sample,
      meta: { name: 'secret.txt', type: 'text/plain', size: sample.length },
      password: 'correct horse',
      passwordKdf: { type: 'argon2id', argon: DEFAULT_ARGON_PARAMS, deriveArgon2 },
    });
    const dec = await decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'correct horse', deriveArgon2 });
    expect(new Uint8Array(dec.plaintext)).toEqual(sample);

    await expect(
      decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'wrong', deriveArgon2 }),
    ).rejects.toThrow();
  });

  it('computes a 64-hex-char download-auth hash', async () => {
    const enc = await encryptFile({ plaintext: sample, meta: { name: 'x', type: 'text/plain', size: sample.length } });
    const hex = await computeDlAuthHashHex(enc.downloadAuth.token);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });
});
