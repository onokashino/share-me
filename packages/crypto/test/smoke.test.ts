import { expect, test } from 'vitest';
import * as crypto from '../src/index.js';

test('public API surface is exported', () => {
  expect(typeof crypto.encryptFile).toBe('function');
  expect(typeof crypto.decryptFile).toBe('function');
  expect(typeof crypto.computeDownloadAuth).toBe('function');
  expect(typeof crypto.parseHeader).toBe('function');
  expect(crypto.VERSION).toBe(1);
});
