import { expect, test } from 'vitest';
import { KdfType } from '../src/constants.js';
import { encodeHeader, parseHeader, verifyHeader, type HeaderFields } from '../src/header.js';

const authKey = new Uint8Array(32).fill(8);
const fields: HeaderFields = {
  kdfType: KdfType.None,
  salt: new Uint8Array(16).fill(3),
  segmentSize: 1024 * 1024,
  params: new Uint8Array(0),
  metaCiphertext: new Uint8Array([10, 20, 30, 40]),
  commit: new Uint8Array(32).fill(2),
};

test('encode → parse round-trips every field', async () => {
  const bytes = await encodeHeader(fields, authKey);
  const parsed = parseHeader(bytes);
  expect(parsed.kdfType).toBe(fields.kdfType);
  expect([...parsed.salt]).toEqual([...fields.salt]);
  expect(parsed.segmentSize).toBe(fields.segmentSize);
  expect([...parsed.metaCiphertext]).toEqual([...fields.metaCiphertext]);
  expect([...parsed.commit]).toEqual([...fields.commit]);
});

test('verifyHeader accepts the right authKey + commit', async () => {
  const bytes = await encodeHeader(fields, authKey);
  const parsed = parseHeader(bytes);
  await expect(verifyHeader(parsed, authKey, fields.commit)).resolves.toBeUndefined();
});

test('verifyHeader rejects a tampered segmentSize (HMAC fails)', async () => {
  const bytes = await encodeHeader(fields, authKey);
  bytes[6] = (bytes[6]! ^ 0xff); // flip a byte inside segmentSize
  const parsed = parseHeader(bytes);
  await expect(verifyHeader(parsed, authKey, fields.commit)).rejects.toThrow(/header/i);
});

test('verifyHeader rejects a wrong commit (key-confusion guard)', async () => {
  const bytes = await encodeHeader(fields, authKey);
  const parsed = parseHeader(bytes);
  await expect(verifyHeader(parsed, authKey, new Uint8Array(32).fill(0xaa))).rejects.toThrow(/commit/i);
});

test('parseHeader rejects bad magic', () => {
  const bytes = new Uint8Array(80);
  expect(() => parseHeader(bytes)).toThrow(/magic/i);
});
