/**
 * blob-upload.ts — Client-only; direct browser→Rust blob upload.
 *
 * Two paths:
 *  • putBlob       — XMLHttpRequest, gives real upload progress events. Buffered
 *                    body (a Blob). Used when request streaming is unavailable.
 *  • putBlobStream — fetch with a ReadableStream body (`duplex: 'half'`), so the
 *                    ciphertext is sent as it is produced, never fully buffered.
 *                    Needs Chromium + HTTP/2; gated by supportsRequestStreams().
 *
 * The upload token is single-use; the 204 response means the server atomically
 * cleared it.
 */

export function putBlob(
  id: string,
  uploadToken: string,
  ciphertext: Uint8Array | Blob,
  onProgress: (p: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', `/api/v1/uploads/${id}/blob`);
    xhr.setRequestHeader('Authorization', `Bearer ${uploadToken}`);
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };

    xhr.onload = () => {
      if (xhr.status === 204) {
        resolve();
      } else {
        reject(new Error(`upload failed: HTTP ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('network error during upload'));
    xhr.onabort = () => reject(new DOMException('Upload aborted', 'AbortError'));

    signal?.addEventListener('abort', () => xhr.abort(), { once: true });

    // Wrap in Blob so the body length is always correct regardless of buffer type
    const body = ciphertext instanceof Blob ? ciphertext : new Blob([ciphertext.buffer as ArrayBuffer]);
    xhr.send(body);
  });
}

let _supportsRequestStreams: boolean | undefined;

/**
 * Whether this browser can send a ReadableStream as a fetch request body.
 * True on Chromium (and only actually works over HTTP/2). False on Firefox /
 * Safari, where we fall back to the buffered XHR path. The standard feature
 * detection: a streaming body would drop the Content-Type, and `duplex` is read
 * during Request construction.
 */
export function supportsRequestStreams(): boolean {
  if (_supportsRequestStreams !== undefined) return _supportsRequestStreams;
  try {
    let duplexAccessed = false;
    const hasContentType = new Request('https://share-me.invalid/', {
      method: 'POST',
      body: new ReadableStream(),
      // @ts-expect-error `duplex` is not yet in the DOM RequestInit type
      get duplex() {
        duplexAccessed = true;
        return 'half';
      },
    }).headers.has('Content-Type');
    _supportsRequestStreams = duplexAccessed && !hasContentType;
  } catch {
    _supportsRequestStreams = false;
  }
  return _supportsRequestStreams;
}

export async function putBlobStream(
  id: string,
  uploadToken: string,
  body: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): Promise<void> {
  const init = {
    method: 'PUT',
    headers: { Authorization: `Bearer ${uploadToken}`, 'Content-Type': 'application/octet-stream' },
    body,
    duplex: 'half',
    signal,
  } as RequestInit & { duplex: 'half' };
  const res = await fetch(`/api/v1/uploads/${id}/blob`, init);
  if (res.status !== 204) throw new Error(`upload failed: HTTP ${res.status}`);
}
