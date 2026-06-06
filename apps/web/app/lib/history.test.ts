/**
 * history.test.ts
 *
 * Tests the device-local "My links" store. The real `./actions` use
 * `next/headers` (server-only) and cannot run in the node test env, so we
 * `vi.mock('./actions')` and drive getStatus / revokeUpload return values.
 *
 * `history.ts` SSR-guards on `typeof window === 'undefined'`. The vitest env is
 * 'node' (no window/localStorage/location), so we install minimal stubs before
 * each test to exercise the real logic.
 *
 * Coverage:
 *  • status derivation: active / expired / exhausted / not-found→gone /
 *    no-owner→active / revokedLocally→revoke flow
 *  • buildLink (with a stubbed location.origin)
 *  • recordDrop ordering + cap, removeHistory
 */

import { describe, expect, test, vi, beforeEach } from 'vitest';

// ─── mock the Server Actions module ─────────────────────────────────────────────
vi.mock('./actions', () => ({
  getStatus: vi.fn(),
  revokeUpload: vi.fn(),
}));

import { getStatus, revokeUpload } from './actions';
import {
  recordDrop,
  listHistory,
  revoke,
  removeHistory,
  buildLink,
  type HistoryRecord,
} from './history';

// ─── localStorage stub ──────────────────────────────────────────────────────────
function makeLocalStorage() {
  let store: Record<string, string> = {};
  return {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => {
      store[k] = String(v);
    },
    removeItem: (k: string) => {
      delete store[k];
    },
    clear: () => {
      store = {};
    },
  };
}

const ORIGIN = 'https://share.example';

beforeEach(() => {
  vi.clearAllMocks();
  const ls = makeLocalStorage();
  // node env has no window/localStorage/location — install minimal stubs
  (globalThis as Record<string, unknown>).window = globalThis;
  (globalThis as Record<string, unknown>).localStorage = ls;
  (globalThis as Record<string, unknown>).location = { origin: ORIGIN };
});

// ─── helpers ────────────────────────────────────────────────────────────────────

function baseRec(over: Partial<HistoryRecord> = {}): Omit<HistoryRecord, 'createdAt'> {
  return {
    id: 'id1',
    key: 'frag1',
    kind: 'files',
    names: ['a.txt'],
    fileCount: 1,
    burn: false,
    usePw: false,
    ...over,
  };
}

// ─── recordDrop ──────────────────────────────────────────────────────────────────

describe('recordDrop', () => {
  test('stamps createdAt and stores newest-first', () => {
    recordDrop(baseRec({ id: 'first' }));
    recordDrop(baseRec({ id: 'second' }));

    const raw = JSON.parse(localStorage.getItem('sm_history')!) as HistoryRecord[];
    expect(raw).toHaveLength(2);
    expect(raw[0].id).toBe('second'); // newest first
    expect(raw[1].id).toBe('first');
    expect(typeof raw[0].createdAt).toBe('number');
    expect(raw[0].createdAt).toBeGreaterThan(0);
  });

  test('caps the list at 100 records', () => {
    for (let i = 0; i < 105; i++) recordDrop(baseRec({ id: `id${i}` }));
    const raw = JSON.parse(localStorage.getItem('sm_history')!) as HistoryRecord[];
    expect(raw).toHaveLength(100);
    expect(raw[0].id).toBe('id104'); // most recent kept
    expect(raw[99].id).toBe('id5'); // oldest 5 dropped
  });
});

// ─── listHistory: status derivation ──────────────────────────────────────────────

describe('listHistory status derivation', () => {
  test('active: payload within limits and not expired', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({
      download_count: 2,
      max_downloads: 10,
      expires_at: new Date(Date.now() + 3600e3).toISOString(),
    });

    const items = await listHistory();
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('active');
    expect(items[0].downloads).toBe(2);
  });

  test('active: null max_downloads and null expiry', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({
      download_count: 99,
      max_downloads: null,
      expires_at: null,
    });

    const items = await listHistory();
    expect(items[0].status).toBe('active');
    expect(items[0].downloads).toBe(99);
  });

  test('expired: expires_at in the past', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({
      download_count: 0,
      max_downloads: 10,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const items = await listHistory();
    expect(items[0].status).toBe('expired');
  });

  test('exhausted: download_count >= max_downloads', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({
      download_count: 5,
      max_downloads: 5,
      expires_at: null,
    });

    const items = await listHistory();
    expect(items[0].status).toBe('exhausted');
    expect(items[0].downloads).toBe(5);
  });

  test('expired takes precedence over exhausted when both apply', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({
      download_count: 10,
      max_downloads: 5,
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    const items = await listHistory();
    expect(items[0].status).toBe('expired');
  });

  test('not-found → gone', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({ error: 'not-found' });

    const items = await listHistory();
    expect(items[0].status).toBe('gone');
    expect(items[0].downloads).toBe(0);
  });

  test('no-owner → active (unverifiable), downloads 0', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(getStatus).mockResolvedValue({ error: 'no-owner' });

    const items = await listHistory();
    expect(items[0].status).toBe('active');
    expect(items[0].downloads).toBe(0);
  });

  test('revokedLocally record → revoked without calling getStatus', async () => {
    recordDrop(baseRec({ id: 'a' }));
    // simulate a prior revoke marking the record
    vi.mocked(revokeUpload).mockResolvedValue({ ok: true });
    await revoke('a');

    vi.mocked(getStatus).mockClear();

    const items = await listHistory();
    expect(items[0].status).toBe('revoked');
    // revoked records short-circuit — getStatus must NOT be called for them
    expect(getStatus).not.toHaveBeenCalled();
  });

  test('empty store → empty list, no getStatus calls', async () => {
    const items = await listHistory();
    expect(items).toEqual([]);
    expect(getStatus).not.toHaveBeenCalled();
  });
});

// ─── revoke ───────────────────────────────────────────────────────────────────

describe('revoke', () => {
  test('calls revokeUpload and marks the record revokedLocally', async () => {
    recordDrop(baseRec({ id: 'a' }));
    vi.mocked(revokeUpload).mockResolvedValue({ ok: true });

    await revoke('a');

    expect(revokeUpload).toHaveBeenCalledWith('a');
    const raw = JSON.parse(localStorage.getItem('sm_history')!) as HistoryRecord[];
    expect(raw[0].revokedLocally).toBe(true);
  });
});

// ─── removeHistory ───────────────────────────────────────────────────────────

describe('removeHistory', () => {
  test('splices the record out of storage', () => {
    recordDrop(baseRec({ id: 'a' }));
    recordDrop(baseRec({ id: 'b' }));

    removeHistory('a');

    const raw = JSON.parse(localStorage.getItem('sm_history')!) as HistoryRecord[];
    expect(raw).toHaveLength(1);
    expect(raw[0].id).toBe('b');
  });

  test('no-op when id is absent', () => {
    recordDrop(baseRec({ id: 'a' }));
    removeHistory('missing');
    const raw = JSON.parse(localStorage.getItem('sm_history')!) as HistoryRecord[];
    expect(raw).toHaveLength(1);
  });
});

// ─── buildLink ───────────────────────────────────────────────────────────────

describe('buildLink', () => {
  test('builds an absolute link with ?f= and #k= from location.origin', () => {
    expect(buildLink('abc', 'XYZ')).toBe(`${ORIGIN}/?f=abc#k=XYZ`);
  });
});
