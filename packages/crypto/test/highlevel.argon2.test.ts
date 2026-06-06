import { expect, test } from 'vitest';
import { decryptFile, encryptFile, KdfType } from '../src/index.js';

const sample = new Uint8Array(1500).map((_, i) => (i * 31) & 0xff);
const meta = { name: 'a.bin', type: 'application/octet-stream', size: sample.length };

// a fake argon2id: deterministic but distinct from pbkdf2 — stands in for hash-wasm in tests
const fakeArgon2: (pw: string, salt: Uint8Array, p: { m: number; t: number; pp: number }) => Promise<Uint8Array> =
  async (pw, salt, p) => {
    const seed = new TextEncoder().encode(`argon:${pw}:${p.m}:${p.t}:${p.pp}`);
    const buf = new Uint8Array(32);
    for (let i = 0; i < 32; i++) buf[i] = (seed[i % seed.length]! ^ salt[i % salt.length]! ^ i) & 0xff;
    return buf;
  };

test('argon2id tier: encrypt records kdfType+params, decrypt round-trips with the same derive', async () => {
  const argon = { m: 19456, t: 2, pp: 1 };
  const enc = await encryptFile({
    plaintext: sample, meta, segmentSize: 1024, password: 'pw',
    passwordKdf: { type: 'argon2id', argon, deriveArgon2: fakeArgon2 },
  });
  // header byte 5 == KdfType.Argon2id  (MAGIC[0..3] + VERSION[4] + kdfType[5])
  // Note: the plan spec says "byte 1" but the actual SHME layout puts kdfType at byte 5.
  expect(enc.header[5]).toBe(KdfType.Argon2id);

  const ok = await decryptFile({
    header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'pw',
    deriveArgon2: fakeArgon2,
  });
  expect([...ok.plaintext]).toEqual([...sample]);

  // wrong password fails at the key-commitment check
  await expect(
    decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'nope', deriveArgon2: fakeArgon2 }),
  ).rejects.toThrow(/commit/i);
});

test('pbkdf2 path still works (built-in, no derive hook)', async () => {
  const enc = await encryptFile({ plaintext: sample, meta, segmentSize: 1024, password: 'pw', pbkdf2Iters: 1000 });
  expect(enc.header[5]).toBe(KdfType.Pbkdf2);
  const ok = await decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'pw' });
  expect([...ok.plaintext]).toEqual([...sample]);
});
