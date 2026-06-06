/**
 * kdf-client.ts — Client-only KDF multiplexer.
 *
 * Spawns the Argon2id worker ONCE (lazily) and multiplexes concurrent
 * derive requests by numeric id.
 *
 * IMPORTANT: This module must only be imported from client code.
 * `Worker` is undefined during Next.js SSR; importing this file from a
 * Server Component or Server Action will throw at runtime.
 */

import type { WorkerRequest, WorkerResponse } from './argon2.worker';

type PendingResolve = {
  resolve: (value: { out: Uint8Array; kdf: 'argon2id' | 'pbkdf2' }) => void;
  reject: (reason: unknown) => void;
};

let worker: Worker | null = null;
let nextId = 0;
const pending = new Map<number, PendingResolve>();

function getWorker(): Worker {
  if (!worker) {
    // Turbopack-supported form: new URL('./argon2.worker.ts', import.meta.url)
    worker = new Worker(new URL('./argon2.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const msg = e.data;
      const entry = pending.get(msg.id);
      if (!entry) return;
      pending.delete(msg.id);

      if (msg.ok) {
        entry.resolve({ out: msg.out, kdf: msg.kdf });
      } else {
        entry.reject(new Error(msg.error));
      }
    };

    worker.onerror = (err) => {
      // On a catastrophic worker crash, reject all pending requests
      const reason = new Error(`KDF worker error: ${err.message}`);
      for (const entry of pending.values()) {
        entry.reject(reason);
      }
      pending.clear();
      // Allow re-creation on next call
      worker = null;
    };
  }
  return worker;
}

/** Argon2id params used for password-protected uploads. */
export const DEFAULT_ARGON_PARAMS = { m: 19456, t: 2, pp: 1 } as const;

/**
 * Derive a 32-byte key from a password and salt using Argon2id (WASM)
 * with PBKDF2-HMAC-SHA256 (600 000 iters, native SubtleCrypto) as fallback
 * when WASM is unavailable.
 *
 * Returns both the derived key and which KDF was actually used so the UI
 * can warn the user if it fell back to PBKDF2 (per spec §4.6 consent-at-
 * encrypt-time).
 */
export function derivePasswordKey(
  password: string,
  salt: Uint8Array,
  argon: { m: number; t: number; pp: number },
): Promise<{ out: Uint8Array; kdf: 'argon2id' | 'pbkdf2' }> {
  return new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });

    const req: WorkerRequest = { id, password, salt, m: argon.m, t: argon.t, pp: argon.pp };
    // Transfer the salt buffer into the worker (zero-copy)
    const saltCopy = salt.slice(); // copy so the caller's buffer stays valid
    getWorker().postMessage({ ...req, salt: saltCopy }, [saltCopy.buffer]);
  });
}

/**
 * `deriveArgon2` adapter — matches the `DeriveArgon2Fn` signature expected
 * by `@share-me/crypto`'s `encryptFile` / `decryptFile`.
 *
 * Usage:
 *   encryptFile({ ..., passwordKdf: { type: 'argon2id', argon, deriveArgon2 } })
 *   decryptFile({ ..., deriveArgon2 })
 */
export const deriveArgon2 = (
  password: string,
  salt: Uint8Array,
  p: { m: number; t: number; pp: number },
): Promise<Uint8Array> =>
  derivePasswordKey(password, salt, p).then((r) => r.out);
