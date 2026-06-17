import * as p from '@clack/prompts';
import pc from 'picocolors';
import { type Config, type ServerEntry, normalizeUrl, saveConfig } from './config';
import { t } from './i18n';

/** Bail out cleanly on Ctrl-C / cancelled prompt. */
export function orCancel<T>(value: T | symbol): T {
  if (p.isCancel(value)) {
    p.cancel(t().cancelled);
    process.exit(1);
  }
  return value as T;
}

/** Resolve which server to use: --server flag (url or profile name), default, or interactive pick/add. */
export async function resolveServer(opts: { server?: string }, cfg: Config): Promise<ServerEntry> {
  const L = t();
  if (opts.server) {
    if (opts.server.includes('://')) {
      return { name: new URL(normalizeUrl(opts.server)).host, url: normalizeUrl(opts.server) };
    }
    const byName = cfg.servers.find((s) => s.name === opts.server);
    if (!byName) throw new Error(L.srvNoProfile(opts.server));
    return byName;
  }
  if (cfg.default) {
    const d = cfg.servers.find((s) => s.name === cfg.default);
    if (d) return d;
  }
  if (cfg.servers.length === 1) return cfg.servers[0];
  if (cfg.servers.length > 1) {
    const pick = orCancel(
      await p.select({
        message: L.srvWhich,
        options: cfg.servers.map((s) => ({ value: s.name, label: s.name, hint: s.url })),
      }),
    );
    return cfg.servers.find((s) => s.name === pick)!;
  }
  return addServerInteractive(cfg, true);
}

export async function addServerInteractive(cfg: Config, makeDefault = false): Promise<ServerEntry> {
  const L = t();
  const url = normalizeUrl(
    orCancel(
      await p.text({
        message: L.srvUrl,
        placeholder: 'https://share.example.com',
        validate: (v) => (v ? undefined : L.vRequired),
      }),
    ),
  );
  const host = new URL(url).hostname;
  const name = orCancel(await p.text({ message: L.srvName, placeholder: host, defaultValue: host })) || host;

  cfg.servers = cfg.servers.filter((s) => s.name !== name);
  cfg.servers.push({ name, url });
  if (makeDefault || !cfg.default) cfg.default = name;
  await saveConfig(cfg);
  return { name, url };
}

export function printServers(cfg: Config): void {
  const L = t();
  if (cfg.servers.length === 0) {
    console.log(pc.dim(L.srvNoServers));
    return;
  }
  for (const s of cfg.servers) {
    const star = s.name === cfg.default ? pc.green(L.preDefaultTag) : '';
    console.log(`${pc.bold(s.name)}${star}  ${pc.dim(s.url)}`);
  }
}
