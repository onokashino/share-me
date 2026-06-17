/** Parse a duration like "30s", "10m", "2h", "7d", "4w" (bare number = seconds). */
export function parseDuration(input: string): number {
  const m = /^(\d+)\s*(s|m|h|d|w)?$/i.exec(input.trim());
  if (!m) throw new Error(`invalid duration: ${input}`);
  const n = parseInt(m[1], 10);
  const mult: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400, w: 604800 };
  return n * mult[(m[2] ?? 's').toLowerCase()];
}

/** Compact a seconds count back to a label like "7d". */
export function humanSecs(s: number): string {
  if (s % 604800 === 0) return `${s / 604800}w`;
  if (s % 86400 === 0) return `${s / 86400}d`;
  if (s % 3600 === 0) return `${s / 3600}h`;
  if (s % 60 === 0) return `${s / 60}m`;
  return `${s}s`;
}

const MIME: Record<string, string> = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv',
  html: 'text/html', xml: 'application/xml', pdf: 'application/pdf', zip: 'application/zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', mp4: 'video/mp4', mp3: 'audio/mpeg',
};

export function mimeFromName(name: string): string {
  return MIME[name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function humanSize(n: number): string {
  const u = ['B', 'KiB', 'MiB', 'GiB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${i === 0 ? v : v.toFixed(1)} ${u[i]}`;
}
