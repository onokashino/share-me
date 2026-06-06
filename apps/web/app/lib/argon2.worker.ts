/// <reference lib="webworker" />
import { argon2id } from 'hash-wasm';

/** Active WASM probe: instantiates a minimal module.
 *  A passive `typeof WebAssembly !== 'undefined'` check is NOT sufficient —
 *  `WebAssembly` may be defined but `wasm-unsafe-eval` CSP can block instantiation.
 */
function wasmWorks(): boolean {
  try {
    // Minimal valid WASM binary: magic + version
    const mod = new WebAssembly.Module(
      Uint8Array.of(0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00),
    );
    new WebAssembly.Instance(mod);
    return true;
  } catch {
    return false;
  }
}

async function pbkdf2Fallback(
  password: string,
  salt: Uint8Array,
  iterations = 600_000,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: salt as unknown as BufferSource, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export type WorkerRequest = {
  id: number;
  password: string;
  salt: Uint8Array;
  /** Memory size in KiB (e.g. 19456 for 19 MiB) */
  m: number;
  /** Number of iterations */
  t: number;
  /** Parallelism */
  pp: number;
};

export type WorkerResponse =
  | { id: number; ok: true; out: Uint8Array; kdf: 'argon2id' | 'pbkdf2' }
  | { id: number; ok: false; error: string };

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const { id, password, salt, m, t, pp } = e.data;
  try {
    let out: Uint8Array;
    let kdf: 'argon2id' | 'pbkdf2';

    if (wasmWorks()) {
      // hash-wasm: memorySize is in KiB; pass m directly (caller uses 19456 for 19 MiB)
      out = await argon2id({
        password,
        salt,
        parallelism: pp,
        iterations: t,
        memorySize: m,
        hashLength: 32,
        outputType: 'binary',
      });
      kdf = 'argon2id';
    } else {
      out = await pbkdf2Fallback(password, salt);
      kdf = 'pbkdf2';
    }

    // Transfer the underlying buffer back to the main thread (zero-copy)
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { id, ok: true, out, kdf } satisfies WorkerResponse,
      [out.buffer],
    );
  } catch (err) {
    (self as unknown as DedicatedWorkerGlobalScope).postMessage(
      { id, ok: false, error: String(err) } satisfies WorkerResponse,
    );
  }
};
