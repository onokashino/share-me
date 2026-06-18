export interface BundleEntry {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export interface BundleManifest {
  kind: 'files' | 'text';
  files: Array<{ name: string; type: string; size: number }>;
}

/**
 * Encode one or more entries into a single Uint8Array:
 *   [u32be manifestLen][manifest JSON utf8][entry bytes concatenated]
 * This is the share-me drop container: both the web app and the CLI wrap their
 * payload in a bundle so file names / kind survive end-to-end inside the
 * ciphertext (the server only ever sees the encrypted bundle).
 */
export function encodeBundle(entries: BundleEntry[], kind: 'files' | 'text'): Uint8Array {
  const manifest: BundleManifest = {
    kind,
    files: entries.map((e) => ({ name: e.name, type: e.type, size: e.bytes.length })),
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const totalSize = 4 + manifestBytes.length + entries.reduce((s, e) => s + e.bytes.length, 0);

  const buf = new Uint8Array(totalSize);
  const view = new DataView(buf.buffer);
  view.setUint32(0, manifestBytes.length, false); // big-endian
  buf.set(manifestBytes, 4);

  let off = 4 + manifestBytes.length;
  for (const e of entries) {
    buf.set(e.bytes, off);
    off += e.bytes.length;
  }
  return buf;
}

/** Decode a bundle back to its constituent files + kind. */
export function decodeBundle(plaintext: Uint8Array): {
  kind: 'files' | 'text';
  files: Array<{ name: string; type: string; bytes: Uint8Array }>;
} {
  if (plaintext.length < 4) throw new Error('bundle too short');
  const view = new DataView(plaintext.buffer, plaintext.byteOffset, plaintext.byteLength);
  const manifestLen = view.getUint32(0, false); // big-endian
  if (plaintext.length < 4 + manifestLen) throw new Error('bundle manifest truncated');

  const manifestStr = new TextDecoder().decode(plaintext.slice(4, 4 + manifestLen));
  const manifest = JSON.parse(manifestStr) as BundleManifest;

  let off = 4 + manifestLen;
  const files = manifest.files.map((f) => {
    const bytes = plaintext.slice(off, off + f.size);
    off += f.size;
    return { name: f.name, type: f.type, bytes };
  });

  return { kind: manifest.kind, files };
}

// ── Streaming bundle ─────────────────────────────────────────────────────────

/** A bundle entry whose bytes are produced lazily as a stream. */
export interface BundleStreamEntry {
  name: string;
  type: string;
  size: number;
  stream: () => ReadableStream<Uint8Array>;
}

/** Per-file callback view passed to {@link decodeBundleStream}. */
export interface BundleStreamFile {
  name: string;
  type: string;
  size: number;
  kind: 'files' | 'text';
  index: number;
  count: number;
}

/** The `[u32be manifestLen][manifest JSON]` prefix — byte-identical to encodeBundle's head. */
function bundleHead(entries: Array<{ name: string; type: string; size: number }>, kind: 'files' | 'text'): Uint8Array {
  const manifest: BundleManifest = {
    kind,
    files: entries.map((e) => ({ name: e.name, type: e.type, size: e.size })),
  };
  const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest));
  const head = new Uint8Array(4 + manifestBytes.length);
  new DataView(head.buffer).setUint32(0, manifestBytes.length, false);
  head.set(manifestBytes, 4);
  return head;
}

/** Wrap an async byte iterator as a ReadableStream (portable across browser + Node). */
function readableFromAsyncIterable(it: AsyncIterable<Uint8Array>): ReadableStream<Uint8Array> {
  const iter = it[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>({
    async pull(ctrl) {
      const { done, value } = await iter.next();
      if (done) ctrl.close();
      else ctrl.enqueue(value);
    },
    async cancel(reason) {
      await iter.return?.(reason);
    },
  });
}

/**
 * Streaming counterpart of {@link encodeBundle}: emits the manifest head, then
 * each entry's bytes in order, without ever holding the whole payload in
 * memory. `totalLength` is the exact plaintext length (head + all sizes), ready
 * to hand to encryptFileStream.
 */
export function encodeBundleStream(
  entries: BundleStreamEntry[],
  kind: 'files' | 'text',
): { totalLength: number; stream: ReadableStream<Uint8Array> } {
  const head = bundleHead(entries, kind);
  const totalLength = head.length + entries.reduce((s, e) => s + e.size, 0);

  async function* chunks(): AsyncGenerator<Uint8Array> {
    yield head;
    for (const e of entries) {
      const reader = e.stream().getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
  }

  return { totalLength, stream: readableFromAsyncIterable(chunks()) };
}

/** Pull-based reader over a byte stream: exact-length reads + bounded piping. */
function byteStreamReader(rs: ReadableStream<Uint8Array>) {
  const reader = rs.getReader();
  const chunks: Uint8Array[] = [];
  let buffered = 0;
  let ended = false;

  async function fill(min: number): Promise<void> {
    while (buffered < min && !ended) {
      const { done, value } = await reader.read();
      if (done) {
        ended = true;
        break;
      }
      if (value.length > 0) {
        chunks.push(value);
        buffered += value.length;
      }
    }
  }

  function take(n: number): Uint8Array {
    const want = Math.min(n, buffered);
    const out = new Uint8Array(want);
    let off = 0;
    while (off < want) {
      const head = chunks[0];
      if (head === undefined) throw new Error('byteStreamReader underflow');
      const need = want - off;
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
    buffered -= want;
    return out;
  }

  return {
    async readExact(n: number): Promise<Uint8Array> {
      await fill(n);
      if (buffered < n) throw new Error('bundle stream ended before manifest was complete');
      return take(n);
    },
    async pipeExact(n: number, onChunk: (c: Uint8Array) => Promise<void> | void): Promise<void> {
      let remaining = n;
      while (remaining > 0) {
        if (buffered === 0) {
          await fill(1);
          if (buffered === 0) throw new Error('bundle stream ended before all files were read');
        }
        const chunk = take(remaining);
        remaining -= chunk.length;
        await onChunk(chunk);
      }
    },
    async finish(): Promise<void> {
      await fill(1);
      if (buffered > 0) throw new Error('trailing bytes after the final bundle file');
      reader.releaseLock();
    },
  };
}

/**
 * Streaming counterpart of {@link decodeBundle}. Reads the manifest from the
 * head of the plaintext stream, then invokes `onFile` once per file with a
 * `pipe` that streams exactly that file's bytes. The caller decides where each
 * file goes (disk, a Blob, the File System Access API). Returns the manifest.
 */
export async function decodeBundleStream(
  plaintext: ReadableStream<Uint8Array>,
  onFile: (
    file: BundleStreamFile,
    pipe: (onChunk: (c: Uint8Array) => Promise<void> | void) => Promise<void>,
  ) => Promise<void>,
): Promise<BundleManifest> {
  const r = byteStreamReader(plaintext);
  const lenBytes = await r.readExact(4);
  const manifestLen = new DataView(lenBytes.buffer, lenBytes.byteOffset, 4).getUint32(0, false);
  const manifest = JSON.parse(new TextDecoder().decode(await r.readExact(manifestLen))) as BundleManifest;

  let index = 0;
  for (const f of manifest.files) {
    await onFile(
      { name: f.name, type: f.type, size: f.size, kind: manifest.kind, index, count: manifest.files.length },
      (onChunk) => r.pipeExact(f.size, onChunk),
    );
    index++;
  }
  await r.finish();
  return manifest;
}
