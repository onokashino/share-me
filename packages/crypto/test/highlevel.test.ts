import { expect, test } from 'vitest';
import { decryptFile, encryptFile } from '../src/highlevel.js';

const sample = new Uint8Array(1024 * 2 + 17).map((_, i) => (i * 31) & 0xff);
const meta = { name: 'a.bin', type: 'application/octet-stream', size: sample.length };

test('no-password: encrypt → open → decrypt round-trips and exposes metadata', async () => {
  const enc = await encryptFile({ plaintext: sample, meta, segmentSize: 1024 });
  expect(enc.fragment).not.toMatch(/[+/=]/);
  expect(enc.downloadAuth.hash.length).toBe(32);

  const opened = await decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment });
  expect(opened.meta.name).toBe('a.bin');
  expect(opened.meta.segmentCount).toBe(3);
  expect([...opened.plaintext]).toEqual([...sample]);
});

test('password: correct password decrypts, wrong password fails at commit', async () => {
  const enc = await encryptFile({ plaintext: sample, meta, segmentSize: 1024, password: 'correct horse', pbkdf2Iters: 1000 });

  const ok = await decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'correct horse' });
  expect([...ok.plaintext]).toEqual([...sample]);

  await expect(
    decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment, password: 'wrong' }),
  ).rejects.toThrow(/commit/i);
});

test('opening without the required password fails fast', async () => {
  const enc = await encryptFile({ plaintext: sample, meta, segmentSize: 1024, password: 'pw', pbkdf2Iters: 1000 });
  await expect(
    decryptFile({ header: enc.header, ciphertext: enc.ciphertext, fragment: enc.fragment }),
  ).rejects.toThrow(/password/i);
});
