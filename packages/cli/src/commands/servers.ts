import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, saveConfig, normalizeUrl, type Config } from '../config';
import { addServerInteractive, orCancel, printServers } from '../ui';
import { t } from '../i18n';

export async function runServers(action?: string, name?: string, url?: string): Promise<void> {
  const L = t();
  const cfg = await loadConfig();

  if (action === 'add') {
    if (!name || !url) {
      console.error(pc.red(L.srvUsageAdd));
      process.exit(1);
    }
    cfg.servers = cfg.servers.filter((s) => s.name !== name);
    cfg.servers.push({ name, url: normalizeUrl(url) });
    if (!cfg.default) cfg.default = name;
    await saveConfig(cfg);
    console.log(pc.green(L.srvAdded(name, normalizeUrl(url))));
    return;
  }
  if (action === 'default' || action === 'use') {
    if (!name || !cfg.servers.find((s) => s.name === name)) {
      console.error(pc.red(L.srvNoNamed(name ?? '')));
      process.exit(1);
    }
    cfg.default = name;
    await saveConfig(cfg);
    console.log(pc.green(L.srvDefaultSet(name)));
    return;
  }
  if (action === 'rm' || action === 'remove') {
    if (!name) {
      console.error(pc.red(L.srvUsageRm));
      process.exit(1);
    }
    cfg.servers = cfg.servers.filter((s) => s.name !== name);
    if (cfg.default === name) cfg.default = cfg.servers[0]?.name;
    await saveConfig(cfg);
    console.log(pc.green(L.srvRemoved(name)));
    return;
  }
  if (action === 'list' || action === 'ls') {
    printServers(cfg);
    return;
  }
  await serversInteractive(cfg);
}

async function serversInteractive(cfg: Config): Promise<void> {
  const L = t();
  p.intro(pc.cyan(pc.bold('share·me')) + pc.dim(L.tagServers));
  for (;;) {
    const list =
      cfg.servers.length === 0
        ? pc.dim('  —')
        : cfg.servers
            .map((s) => `  ${s.name === cfg.default ? pc.green('●') : pc.dim('○')} ${pc.bold(s.name)} ${pc.dim(s.url)}`)
            .join('\n');
    p.note(list, L.menuServers);

    const choice = orCancel(
      await p.select({
        message: L.srvMenuQ,
        options: [
          { value: 'add', label: L.srvAdd },
          { value: 'default', label: L.srvSetDefault },
          { value: 'rm', label: L.srvRemove },
          { value: 'done', label: L.srvDone },
        ],
      }),
    );

    if (choice === 'done') break;
    if (choice === 'add') {
      await addServerInteractive(cfg);
      continue;
    }
    if (cfg.servers.length === 0) continue;
    const pick = orCancel(
      await p.select({
        message: choice === 'default' ? L.preMakeDefaultWhich : L.preRemoveWhich,
        options: cfg.servers.map((s) => ({ value: s.name, label: s.name, hint: s.url })),
      }),
    );
    if (choice === 'default') {
      cfg.default = pick;
    } else {
      cfg.servers = cfg.servers.filter((s) => s.name !== pick);
      if (cfg.default === pick) cfg.default = cfg.servers[0]?.name;
    }
    await saveConfig(cfg);
  }
  p.outro(pc.green(L.done));
}
