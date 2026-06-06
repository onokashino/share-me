/**
 * blob-upload.ts — Client-only; direct browser→Rust blob upload via XHR.
 *
 * Uses XMLHttpRequest (not fetch) so `xhr.upload.onprogress` gives real
 * progress events. The upload token is single-use; the 204 response means
 * the server atomically cleared it.
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
