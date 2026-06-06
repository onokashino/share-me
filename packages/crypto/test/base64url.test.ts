import { expect, test } from 'vitest';
import { fromBase64Url, toBase64Url } from '../src/base64url.js';

test('round-trips arbitrary bytes without padding', () => {
  for (const len of [0, 1, 2, 3, 31, 32, 48]) {
    const bytes = new Uint8Array(len).map((_, i) => (i * 73 + 11) & 0xff);
    const s = toBase64Url(bytes);
    expect(s).not.toMatch(/[+/=]/); // url-safe, no padding
    expect([...fromBase64Url(s)]).toEqual([...bytes]);
  }
});

test('decodes a known vector', () => {
  expect(toBase64Url(new Uint8Array([255, 254, 253]))).toBe('__79');
});
