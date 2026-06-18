/**
 * blob-download.ts — Client-only; opens the browser→Rust blob download as a
 * stream. The response body is handed back as a ReadableStream so the caller
 * can pipe it straight through streaming decryption (drop-service.ts) without
 * buffering the whole ciphertext in memory.
 */

export async function openCiphertextStream(opts: {
  id: string;
  downloadAuthToken: string;
  sessionId: string;
  signal?: AbortSignal;
}): Promise<{ stream: ReadableStream<Uint8Array>; total: number }> {
  const res = await fetch(`/api/v1/dl/${opts.id}/blob`, {
    headers: {
      Authorization: `Bearer ${opts.downloadAuthToken}`,
      'x-download-session': opts.sessionId,
    },
    signal: opts.signal,
  });

  if (res.status === 401) throw new Error('unauthorized');
  if (res.status === 410) throw new Error('gone');
  if (res.status === 423) throw new Error('locked');
  if (!res.ok || !res.body) throw new Error(`download failed: HTTP ${res.status}`);

  const total = Number(res.headers.get('Content-Length') ?? 0);
  return { stream: res.body, total };
}
