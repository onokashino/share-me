import { expect, test } from 'vitest';
import { concatBytes, constantTimeEqual, randomBytes, toArrayBuffer, u32be } from '../src/bytes.js';

test('concatBytes joins in order', () => {
  expect([...concatBytes(new Uint8Array([1, 2]), new Uint8Array([3]))]).toEqual([1, 2, 3]);
});

test('u32be is big-endian', () => {
  expect([...u32be(0x01020304)]).toEqual([1, 2, 3, 4]);
  expect([...u32be(0)]).toEqual([0, 0, 0, 0]);
});

test('constantTimeEqual compares content and rejects length mismatch', () => {
  expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
  expect(constantTimeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  expect(constantTimeEqual(new Uint8Array([1]), new Uint8Array([1, 2]))).toBe(false);
});

test('randomBytes returns the requested length and is not all-zero', () => {
  const b = randomBytes(32);
  expect(b.length).toBe(32);
  expect(b.some((x) => x !== 0)).toBe(true);
});

test('toArrayBuffer extracts exactly the subarray range (subarray-safe)', () => {
  const big = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  const sub = big.subarray(3, 7); // bytes [3,4,5,6]
  const ab = toArrayBuffer(sub);
  expect(ab.byteLength).toBe(4);
  expect([...new Uint8Array(ab)]).toEqual([3, 4, 5, 6]);
});
