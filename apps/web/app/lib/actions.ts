'use server';

/**
 * BFF Server Actions — all metadata ops go server→Rust; secrets discipline:
 *
 *  • owner_token  : stored ONLY as httpOnly cookie `owner_<id>`; NEVER returned to client
 *  • upload_token : returned to the client for a single-use blob PUT
 *  • master key   : lives ONLY in the URL `#k=` fragment — never touches the server
 *
 * `cookies()` is async in Next 16 — always `await cookies()`.
 */

import { cookies } from 'next/headers';

const API = process.env.API_INTERNAL_URL ?? 'http://api:8080';

// ---------------------------------------------------------------------------
// createUpload
// ---------------------------------------------------------------------------

export async function createUpload(input: {
  headerB64: string;
  dlAuthHashHex: string;
  maxDownloads?: number;
  expiresInSecs?: number;
  unlockInSecs?: number;
}): Promise<{ id: string; uploadToken: string }> {
  const res = await fetch(`${API}/api/v1/uploads`, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      header: input.headerB64,
      download_auth_hash: input.dlAuthHashHex,
      max_downloads: input.maxDownloads ?? null,
      expires_in_secs: input.expiresInSecs ?? null,
      unlock_in_secs: input.unlockInSecs ?? null,
    }),
  });
  if (!res.ok) throw new Error(`create upload failed: HTTP ${res.status}`);

  const { id, owner_token, upload_token } = (await res.json()) as {
    id: string;
    owner_token: string;
    upload_token: string;
  };

  // Store the owner token in an httpOnly cookie — never return it to the client
  (await cookies()).set(`owner_${id}`, owner_token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });

  // Return ONLY id + uploadToken — owner_token stays server-side
  return { id, uploadToken: upload_token };
}

// ---------------------------------------------------------------------------
// getStatus  (requires the owner httpOnly cookie)
// ---------------------------------------------------------------------------

export async function getStatus(
  id: string,
): Promise<
  | { error: 'no-owner' }
  | { error: 'not-found' }
  | Record<string, unknown>
> {
  const owner = (await cookies()).get(`owner_${id}`)?.value;
  if (!owner) return { error: 'no-owner' };

  const res = await fetch(`${API}/api/v1/uploads/${id}/status`, {
    cache: 'no-store',
    headers: { authorization: `Bearer ${owner}` },
  });

  if (res.status === 404) return { error: 'not-found' };
  if (!res.ok) throw new Error(`getStatus failed: HTTP ${res.status}`);

  return res.json() as Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// revokeUpload  (DELETE — requires owner cookie, clears it on success)
// ---------------------------------------------------------------------------

export async function revokeUpload(
  id: string,
): Promise<{ ok: true } | { error: 'no-owner' }> {
  const jar = await cookies();
  const owner = jar.get(`owner_${id}`)?.value;
  if (!owner) return { error: 'no-owner' };

  const res = await fetch(`${API}/api/v1/uploads/${id}`, {
    method: 'DELETE',
    cache: 'no-store',
    headers: { authorization: `Bearer ${owner}` },
  });

  // 204 = deleted; 404 = already gone — both are acceptable
  if (res.status !== 204 && res.status !== 404) {
    throw new Error(`revokeUpload failed: HTTP ${res.status}`);
  }

  jar.delete(`owner_${id}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// getMeta  (public, no auth)
// ---------------------------------------------------------------------------

export async function getMeta(
  id: string,
): Promise<
  | { error: 'gone' }
  | {
      has_password: boolean;
      size_cipher: number;
      max_downloads: number | null;
      download_count: number;
      expires_at: string | null;
      unlock_at: string | null;
    }
> {
  const res = await fetch(`${API}/api/v1/dl/${id}/meta`, {
    cache: 'no-store',
  });

  if (res.status === 410) return { error: 'gone' };
  if (!res.ok) throw new Error(`getMeta failed: HTTP ${res.status}`);

  return res.json();
}

// ---------------------------------------------------------------------------
// getHeaderBytes  (public, returns raw header as base64)
// ---------------------------------------------------------------------------

export async function getHeaderBytes(
  id: string,
): Promise<{ headerB64: string } | { error: 'gone' }> {
  const res = await fetch(`${API}/api/v1/dl/${id}`, {
    cache: 'no-store',
  });

  if (res.status === 410) return { error: 'gone' };
  if (!res.ok) throw new Error(`getHeaderBytes failed: HTTP ${res.status}`);

  const buf = new Uint8Array(await res.arrayBuffer());
  let bin = '';
  for (const b of buf) bin += String.fromCharCode(b);
  return { headerB64: btoa(bin) };
}
