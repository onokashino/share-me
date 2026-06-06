/**
 * format.ts — typed utility helpers.
 *
 * Ported EXACTLY from:
 *   ex/crypto.js  → fmtSize, pwStrength, genPassword
 *   ex/app.jsx    → extOf, fmtCountdown, dtLocal
 *
 * No approximations — logic is a direct translation to TypeScript.
 */

/** Format a byte count into a human-readable string (e.g. "1.4 MB"). */
export function fmtSize(bytes: number): string {
  if (bytes < 1024) return bytes + ' B';
  const u = ['KB', 'MB', 'GB'];
  let i = -1;
  let b = bytes;
  do { b /= 1024; i++; } while (b >= 1024 && i < u.length - 1);
  return b.toFixed(b < 10 ? 1 : 0) + ' ' + u[i];
}

/** Return the uppercased extension (≤ 4 chars) or "FILE" if none. */
export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name || '');
  return m ? m[1]!.slice(0, 4).toUpperCase() : 'FILE';
}

/**
 * Format a countdown in milliseconds.
 * - d > 0  → "3д 2ч 5м"  (uses Unicode day/hour/minute chars from ex)
 * - h > 0  → "1:02:05"
 * - else   → "2:05"
 */
export function fmtCountdown(ms: number): string {
  if (ms <= 0) return '0:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}д ${h}ч ${m}м`;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
  return `${m}:${String(ss).padStart(2, '0')}`;
}

/**
 * Convert a Unix timestamp (ms) to a datetime-local string
 * ("YYYY-MM-DDTHH:MM") in local time.
 */
export function dtLocal(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Character pool used by genPassword (same as ex/crypto.js). */
const PASSWORD_SETS = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%&*?';

/**
 * Generate a random password of `len` characters using
 * crypto.getRandomValues (replaces ex's randBytes helper).
 */
export function genPassword(len = 20): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < len; i++) {
    out += PASSWORD_SETS[bytes[i]! % PASSWORD_SETS.length];
  }
  return out;
}

export interface PwStrength {
  /** 0 = empty, 1 = very weak … 4 = excellent */
  score: 0 | 1 | 2 | 3 | 4;
  bits: number;
}

/**
 * Estimate password entropy and return a score 0–4.
 * Ported verbatim from ex/crypto.js pwStrength().
 */
export function pwStrength(pw: string): PwStrength {
  if (!pw) return { score: 0, bits: 0 };
  let pool = 0;
  if (/[a-z]/.test(pw)) pool += 26;
  if (/[A-Z]/.test(pw)) pool += 26;
  if (/[0-9]/.test(pw)) pool += 10;
  if (/[^a-zA-Z0-9]/.test(pw)) pool += 33;
  const bits = Math.round(pw.length * Math.log2(pool || 1));
  let score: 0 | 1 | 2 | 3 | 4 = 0;
  if (bits >= 28) score = 1;
  if (bits >= 50) score = 2;
  if (bits >= 72) score = 3;
  if (bits >= 100) score = 4;
  return { score, bits };
}
