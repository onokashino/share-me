import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { t, type Lang } from './i18n';

export interface ServerEntry {
  name: string;
  url: string;
}

export interface Config {
  servers: ServerEntry[];
  default?: string;
  presets?: Preset[];
  defaultPreset?: string;
  lang?: Lang;
}

export interface Preset {
  name: string;
  expires: string; // duration label, e.g. "7d"
  maxDownloads: number; // 0 = unlimited, 1 = single download / burn
  unlock?: string; // optional time-lock duration
  password?: boolean; // prompt for a password
}

export const BUILTIN_PRESETS: Preset[] = [
  { name: 'default', expires: '7d', maxDownloads: 0 },
  { name: 'oneshot', expires: '1d', maxDownloads: 1 },
  { name: 'burn', expires: '7d', maxDownloads: 1 },
  { name: 'long', expires: '30d', maxDownloads: 0 },
  { name: 'temp', expires: '1h', maxDownloads: 1 },
];

/** User presets first, then any built-in whose name isn't overridden. */
export function allPresets(cfg: Config): Preset[] {
  const user = cfg.presets ?? [];
  const taken = new Set(user.map((p) => p.name));
  return [...user, ...BUILTIN_PRESETS.filter((b) => !taken.has(b.name))];
}

export function findPreset(cfg: Config, name?: string): Preset | undefined {
  return name ? allPresets(cfg).find((p) => p.name === name) : undefined;
}

export function describePreset(p: Preset): string {
  const L = t();
  const dl = p.maxDownloads === 0 ? L.descUnlimited : p.maxDownloads === 1 ? L.descOne : L.descMany(p.maxDownloads);
  return [p.expires, dl, p.unlock ? L.descUnlock(p.unlock) : null, p.password ? L.limPassword : null]
    .filter(Boolean)
    .join(', ');
}

function configDir(): string {
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'share-me');
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'), 'share-me');
}

export function configPath(): string {
  return join(configDir(), 'config.json');
}

export async function loadConfig(): Promise<Config> {
  try {
    const cfg = JSON.parse(await readFile(configPath(), 'utf8')) as Config;
    if (!Array.isArray(cfg.servers)) cfg.servers = [];
    return cfg;
  } catch {
    return { servers: [] };
  }
}

export async function saveConfig(cfg: Config): Promise<void> {
  await mkdir(configDir(), { recursive: true });
  await writeFile(configPath(), JSON.stringify(cfg, null, 2) + '\n', 'utf8');
}

/** Add a scheme if missing (http for localhost, https otherwise) and trim trailing slashes. */
export function normalizeUrl(u: string): string {
  let s = u.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) {
    const isLocal = /^(localhost|127\.|0\.0\.0\.0|\[?::1)/i.test(s);
    s = (isLocal ? 'http://' : 'https://') + s;
  }
  return s;
}
