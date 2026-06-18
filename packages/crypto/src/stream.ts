import { MAX_SEGMENT_COUNT, SEG_AAD_TAG, TAG_LEN } from './constants';
import { concatBytes, u32be } from './bytes';
import { gcmDecrypt, gcmEncrypt } from './aead';

export function segmentNonce(prefix: Uint8Array, counter: number, isFinal: boolean): Uint8Array {
  if (counter < 0 || counter > MAX_SEGMENT_COUNT) {
    throw new Error('segment counter exceeds the 32-bit limit');
  }
  return concatBytes(prefix, u32be(counter), new Uint8Array([isFinal ? 1 : 0]));
}

export function segmentAad(counter: number, isFinal: boolean): Uint8Array {
  return concatBytes(SEG_AAD_TAG, u32be(counter), new Uint8Array([isFinal ? 1 : 0]));
}

export function segmentCountFor(length: number, segmentSize: number): number {
  if (length === 0) return 1;
  return Math.ceil(length / segmentSize);
}

export const CIPHERTEXT_SEGMENT_OVERHEAD = TAG_LEN;

function concatParts(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

export async function encryptSegment(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  counter: number,
  isFinal: boolean,
  segmentPlaintext: Uint8Array,
): Promise<Uint8Array> {
  const nonce = segmentNonce(noncePrefix, counter, isFinal);
  const aad = segmentAad(counter, isFinal);
  return gcmEncrypt(contentKey, nonce, aad, segmentPlaintext);
}

export async function encryptToBytes(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  plaintext: Uint8Array,
  segmentSize: number,
): Promise<Uint8Array> {
  const n = segmentCountFor(plaintext.length, segmentSize);
  // Fail fast before doing any work if this plaintext+segmentSize would overflow
  // the 32-bit segment counter (segment indices are 0..n-1).
  if (n - 1 > MAX_SEGMENT_COUNT) {
    throw new Error('plaintext requires too many segments for the 32-bit counter');
  }
  const parts: Uint8Array[] = [];
  for (let i = 0; i < n; i++) {
    const start = i * segmentSize;
    const end = Math.min(start + segmentSize, plaintext.length);
    const isFinal = i === n - 1;
    parts.push(await encryptSegment(contentKey, noncePrefix, i, isFinal, plaintext.subarray(start, end)));
  }
  return concatParts(parts);
}

export async function decryptSegment(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  counter: number,
  isFinal: boolean,
  ciphertextSegment: Uint8Array,
): Promise<Uint8Array> {
  const nonce = segmentNonce(noncePrefix, counter, isFinal);
  const aad = segmentAad(counter, isFinal);
  return gcmDecrypt(contentKey, nonce, aad, ciphertextSegment);
}

export async function decryptFromBytes(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  ciphertext: Uint8Array,
  segmentSize: number,
): Promise<Uint8Array> {
  const ctSegLen = segmentSize + TAG_LEN;
  const out: Uint8Array[] = [];
  let offset = 0;
  let counter = 0;
  if (ciphertext.length < TAG_LEN) throw new Error('ciphertext too short');
  while (true) {
    const remaining = ciphertext.length - offset;
    const isFinal = remaining <= ctSegLen;
    const take = isFinal ? remaining : ctSegLen;
    const seg = ciphertext.subarray(offset, offset + take);
    out.push(await decryptSegment(contentKey, noncePrefix, counter, isFinal, seg));
    offset += take;
    counter++;
    if (isFinal) break;
  }
  if (offset !== ciphertext.length) throw new Error('trailing bytes after final segment');
  return concatParts(out);
}

/**
 * A FIFO byte buffer that hands out exact-length slices without re-copying the
 * whole backlog on every push (segment re-chunking would otherwise be O(n^2)).
 */
function byteQueue() {
  const chunks: Uint8Array[] = [];
  let len = 0;
  return {
    get length() {
      return len;
    },
    push(c: Uint8Array): void {
      if (c.length > 0) {
        chunks.push(c);
        len += c.length;
      }
    },
    take(n: number): Uint8Array {
      const out = new Uint8Array(n);
      let off = 0;
      while (off < n) {
        const head = chunks[0];
        if (head === undefined) throw new Error('byteQueue underflow');
        const need = n - off;
        if (head.length <= need) {
          out.set(head, off);
          off += head.length;
          chunks.shift();
        } else {
          out.set(head.subarray(0, need), off);
          chunks[0] = head.subarray(need);
          off += need;
        }
      }
      len -= n;
      return out;
    },
  };
}

/**
 * Streaming counterpart of {@link encryptToBytes}: re-chunks an arbitrary
 * plaintext byte stream into fixed `segmentSize` segments and emits one
 * ciphertext segment each. Output is byte-identical to encryptToBytes for the
 * same input, so streamed and buffered uploads are wire-compatible. The
 * trailing (or only) segment is flushed with isFinal=true.
 */
export function encryptStream(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  segmentSize: number,
): TransformStream<Uint8Array, Uint8Array> {
  const q = byteQueue();
  let counter = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, ctrl) {
      q.push(chunk);
      while (q.length > segmentSize) {
        ctrl.enqueue(await encryptSegment(contentKey, noncePrefix, counter, false, q.take(segmentSize)));
        counter++;
      }
    },
    async flush(ctrl) {
      ctrl.enqueue(await encryptSegment(contentKey, noncePrefix, counter, true, q.take(q.length)));
    },
  });
}

/**
 * Streaming counterpart of {@link decryptFromBytes}, mirroring encryptStream's
 * segmentation: a full ciphertext segment is `segmentSize + TAG_LEN` bytes and
 * is non-final while strictly more than one remains; the trailing segment is
 * final. Each segment is GCM-verified, and a truncated or reordered stream is
 * rejected because the counter and final flag are bound into the AAD/nonce.
 *
 * Note: plaintext segments are released as they authenticate, before the final
 * segment is seen. Truncation is still detected (the stream errors instead of
 * ending cleanly), but a consumer writing to disk must treat output as
 * provisional until the stream closes without error.
 */
export function decryptStream(
  contentKey: CryptoKey,
  noncePrefix: Uint8Array,
  segmentSize: number,
): TransformStream<Uint8Array, Uint8Array> {
  const ctSegLen = segmentSize + TAG_LEN;
  const q = byteQueue();
  let counter = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    async transform(chunk, ctrl) {
      q.push(chunk);
      while (q.length > ctSegLen) {
        ctrl.enqueue(await decryptSegment(contentKey, noncePrefix, counter, false, q.take(ctSegLen)));
        counter++;
      }
    },
    async flush(ctrl) {
      if (q.length < TAG_LEN) throw new Error('ciphertext too short');
      ctrl.enqueue(await decryptSegment(contentKey, noncePrefix, counter, true, q.take(q.length)));
    },
  });
}

