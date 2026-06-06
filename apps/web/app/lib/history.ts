/**
 * history.ts — device-local "My links" store.
 *
 * Plain client module (NOT a Server Action). Records every drop the user seals
 * on this device in `localStorage['sm_history']` (JSON array, newest first),
 * then merges those records with live server status on demand.
 *
 * Secrets discipline:
 *  • Only the master key fragment (`key`) is stored locally so the link can be
 *    rebuilt — exactly what already lives in the URL `#k=` the user copied.
 *  • The owner_token is NEVER here; status/revoke go through the Server Actions
 *    in `./actions`, which read the httpOnly `owner_<id>` cookie server-side.
 *
 * SSR-safe: `localStorage` / `location` are client-only, so every entry point
 * guards on `typeof window === 'undefined'`. In practice this module is only
 * imported by client components, but the guards keep it import-safe everywhere.
 */

import { getStatus, revokeUpload } from './actions';

const KEY = 'sm_history';
const CAP = 100;

// ─── types ─────────────────────────────────────────────────────────────────────

export interface HistoryRecord {
  id: string;
  /** SealResult.fragment — rebuilds the link locally (master key, URL #k=). */
  key: string;
  kind: 'files' | 'text';
  /** file names; [] for text */
  names: string[];
  /** number of files; 0 for text */
  fileCount: number;
  /** maxDownloads === 1 (single-download / burn) */
  burn: boolean;
  usePw: boolean;
  /** Date.now() at seal */
  createdAt: number;
  revokedLocally?: boolean;
}

export interface HistoryItem extends HistoryRecord {
  status: 'active' | 'expired' | 'exhausted' | 'revoked' | 'gone';
  downloads: number;
}

/** Shape of the StatusResp payload returned by getStatus (subset we read). */
interface StatusPayload {
  download_count: number;
  max_downloads: number | null;
  expires_at: string | null;
}

// ─── storage helpers ───────────────────────────────────────────────────────────

function readAll(): HistoryRecord[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as HistoryRecord[]) : [];
  } catch {
    return [];
  }
}

function writeAll(records: HistoryRecord[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    // quota / private-mode failures are non-fatal — history is best-effort
  }
}

// ─── public API ────────────────────────────────────────────────────────────────

/**
 * Record a freshly-sealed drop. Newest first; capped at CAP to bound storage.
 */
export function recordDrop(rec: Omit<HistoryRecord, 'createdAt'>): void {
  if (typeof window === 'undefined') return;
  const records = readAll();
  records.unshift({ ...rec, createdAt: Date.now() });
  writeAll(records.slice(0, CAP));
}

/**
 * Derive the live status of a single record from its getStatus result.
 *
 *  • revokedLocally        → 'revoked'
 *  • getStatus not-found   → 'gone'
 *  • getStatus no-owner    → 'active' (cookie cleared → unverifiable; downloads 0)
 *  • else from payload:
 *      expires_at in the past                          → 'expired'
 *      max_downloads != null && count >= max_downloads → 'exhausted'
 *      otherwise                                       → 'active'
 */
function deriveStatus(
  rec: HistoryRecord,
  res: Awaited<ReturnType<typeof getStatus>>,
): { status: HistoryItem['status']; downloads: number } {
  if (rec.revokedLocally) return { status: 'revoked', downloads: 0 };

  if ('error' in res) {
    if (res.error === 'not-found') return { status: 'gone', downloads: 0 };
    // 'no-owner' — cookie cleared; last-known, treat as active, downloads unknown
    return { status: 'active', downloads: 0 };
  }

  const p = res as unknown as StatusPayload;
  const downloads = typeof p.download_count === 'number' ? p.download_count : 0;

  if (p.expires_at && Date.now() > Date.parse(p.expires_at)) {
    return { status: 'expired', downloads };
  }
  if (p.max_downloads != null && downloads >= p.max_downloads) {
    return { status: 'exhausted', downloads };
  }
  return { status: 'active', downloads };
}

/**
 * Read all records and merge each with its live server status.
 * N parallel getStatus calls — fine on a personal device.
 */
export async function listHistory(): Promise<HistoryItem[]> {
  if (typeof window === 'undefined') return [];
  const records = readAll();

  const statuses = await Promise.all(
    records.map((rec) =>
      rec.revokedLocally
        ? Promise.resolve<Awaited<ReturnType<typeof getStatus>>>({ error: 'no-owner' })
        : getStatus(rec.id),
    ),
  );

  return records.map((rec, i) => {
    const { status, downloads } = deriveStatus(rec, statuses[i]);
    return { ...rec, status, downloads };
  });
}

/**
 * Revoke a drop server-side, then mark the local record revoked and persist.
 */
export async function revoke(id: string): Promise<void> {
  await revokeUpload(id);
  if (typeof window === 'undefined') return;
  const records = readAll();
  const rec = records.find((r) => r.id === id);
  if (rec) {
    rec.revokedLocally = true;
    writeAll(records);
  }
}

/**
 * Remove a record from the local list entirely (no server call).
 */
export function removeHistory(id: string): void {
  if (typeof window === 'undefined') return;
  const records = readAll();
  const idx = records.findIndex((r) => r.id === id);
  if (idx !== -1) {
    records.splice(idx, 1);
    writeAll(records);
  }
}

/**
 * Rebuild the absolute share link from id + key (master key fragment).
 */
export function buildLink(id: string, key: string): string {
  return `${location.origin}/?f=${id}#k=${key}`;
}
