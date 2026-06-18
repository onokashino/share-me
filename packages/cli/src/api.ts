import { t } from './i18n';

export interface CreateResp {
  id: string;
  owner_token: string;
  upload_token: string;
}

export interface CreateBody {
  header: string;
  download_auth_hash: string;
  max_downloads: number | null;
  expires_in_secs: number | null;
  unlock_in_secs: number | null;
}

export interface MetaResp {
  has_password: boolean;
  size_cipher: number;
  max_downloads: number | null;
  download_count: number;
  expires_at: string | null;
  unlock_at: string | null;
}

export async function createUpload(server: string, body: CreateBody): Promise<CreateResp> {
  const res = await fetch(`${server}/api/v1/uploads`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(t().errHttp('create upload', res.status));
  return res.json() as Promise<CreateResp>;
}

export async function putBlobStream(
  server: string,
  id: string,
  uploadToken: string,
  body: ReadableStream<Uint8Array>,
): Promise<void> {
  // `duplex: 'half'` is required by Node/undici to send a streaming request
  // body; it is not yet in the DOM RequestInit type, hence the intersection.
  const init = {
    method: 'PUT',
    headers: { authorization: `Bearer ${uploadToken}`, 'content-type': 'application/octet-stream' },
    body,
    duplex: 'half',
  } as RequestInit & { duplex: 'half' };
  const res = await fetch(`${server}/api/v1/uploads/${id}/blob`, init);
  if (res.status !== 204) throw new Error(t().errHttp('blob upload', res.status));
}

export async function getHeader(server: string, id: string): Promise<Uint8Array> {
  const res = await fetch(`${server}/api/v1/dl/${id}`);
  if (res.status === 410) throw new Error(t().errGone);
  if (!res.ok) throw new Error(t().errHttp('fetch header', res.status));
  return new Uint8Array(await res.arrayBuffer());
}

export async function getMeta(server: string, id: string): Promise<MetaResp> {
  const res = await fetch(`${server}/api/v1/dl/${id}/meta`);
  if (res.status === 410) throw new Error(t().errGone);
  if (!res.ok) throw new Error(t().errHttp('fetch meta', res.status));
  return res.json() as Promise<MetaResp>;
}

export async function downloadBlobStream(
  server: string,
  id: string,
  bearer: string,
  sessionId: string,
): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${server}/api/v1/dl/${id}/blob`, {
    headers: { authorization: `Bearer ${bearer}`, 'x-download-session': sessionId },
  });
  if (res.status === 401) throw new Error(t().errUnauthorized);
  if (res.status === 410) throw new Error(t().errGone);
  if (res.status === 423) throw new Error(t().errLocked);
  if (!res.ok) throw new Error(t().errHttp('download', res.status));
  if (!res.body) throw new Error(t().errHttp('download', res.status));
  return res.body as ReadableStream<Uint8Array>;
}

export async function getStatus(server: string, id: string, ownerToken: string): Promise<unknown> {
  const res = await fetch(`${server}/api/v1/uploads/${id}/status`, {
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  if (!res.ok) throw new Error(t().errHttp('status', res.status));
  return res.json();
}

export async function revoke(server: string, id: string, ownerToken: string): Promise<void> {
  const res = await fetch(`${server}/api/v1/uploads/${id}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${ownerToken}` },
  });
  if (res.status !== 204 && res.status !== 404) throw new Error(t().errHttp('revoke', res.status));
}
