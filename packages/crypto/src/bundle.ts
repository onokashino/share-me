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
