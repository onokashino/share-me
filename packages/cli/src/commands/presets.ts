import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, saveConfig, allPresets, describePreset, type Config } from '../config';
import { customSettings } from '../settings';
import { orCancel } from '../ui';
import { t } from '../i18n';

export async function runPresets(action?: string, name?: string): Promise<void> {
  const L = t();
  const cfg = await loadConfig();

  if (action === 'list' || action === 'ls') {
    printPresets(cfg);
    return;
  }
  if (action === 'default' || action === 'use') {
    if (!name || !allPresets(cfg).find((pr) => pr.name === name)) {
      console.error(pc.red(L.preNoPreset(name ?? '')));
      process.exit(1);
    }
    cfg.defaultPreset = name;
    await saveConfig(cfg);
    console.log(pc.green(L.preDefaultSet(name)));
    return;
  }
  if (action === 'rm' || action === 'remove') {
    if (!name) {
      console.error(pc.red(L.preUsageRm));
      process.exit(1);
    }
    cfg.presets = (cfg.presets ?? []).filter((pr) => pr.name !== name);
    if (cfg.defaultPreset === name) cfg.defaultPreset = undefined;
    await saveConfig(cfg);
    console.log(pc.green(L.preRemoved(name)));
    return;
  }
  if (action === 'add') {
    await addPreset(cfg, name);
    return;
  }
  await presetsInteractive(cfg);
}

function printPresets(cfg: Config): void {
  const L = t();
  for (const pr of allPresets(cfg)) {
    const isUser = (cfg.presets ?? []).some((x) => x.name === pr.name);
    const star = pr.name === cfg.defaultPreset ? pc.green(L.preDefaultTag) : '';
    const tag = isUser ? '' : pc.dim(L.preBuiltin);
    console.log(`${pc.bold(pr.name)}${star}${tag}  ${pc.dim(describePreset(pr))}`);
  }
}

async function addPreset(cfg: Config, name?: string): Promise<void> {
  const L = t();
  const nm = name ?? orCancel(await p.text({ message: L.preName, placeholder: 'work', validate: (v) => (v ? undefined : L.vRequired) }));
  const preset = { ...(await customSettings()), name: nm };
  cfg.presets = [...(cfg.presets ?? []).filter((x) => x.name !== nm), preset];
  if (!cfg.defaultPreset) cfg.defaultPreset = nm;
  await saveConfig(cfg);
  console.log(pc.green(L.preSaved(pc.bold(nm), describePreset(preset))));
}

async function presetsInteractive(cfg: Config): Promise<void> {
  const L = t();
  p.intro(pc.cyan(pc.bold('share·me')) + pc.dim(L.tagPresets));
  for (;;) {
    const list = allPresets(cfg)
      .map((pr) => `  ${pr.name === cfg.defaultPreset ? pc.green('●') : pc.dim('○')} ${pc.bold(pr.name)} ${pc.dim(describePreset(pr))}`)
      .join('\n');
    p.note(list, L.menuPresets);

    const choice = orCancel(
      await p.select({
        message: L.preMenuQ,
        options: [
          { value: 'add', label: L.preAdd },
          { value: 'default', label: L.preSetDefault },
          { value: 'rm', label: L.preRemove },
          { value: 'done', label: L.preDone },
        ],
      }),
    );

    if (choice === 'done') break;
    if (choice === 'add') {
      await addPreset(cfg);
      continue;
    }
    if (choice === 'rm') {
      const user = cfg.presets ?? [];
      if (user.length === 0) {
        p.note(pc.dim(L.preNoCustom), L.menuPresets);
        continue;
      }
      const pick = orCancel(
        await p.select({ message: L.preRemoveWhich, options: user.map((pr) => ({ value: pr.name, label: pr.name, hint: describePreset(pr) })) }),
      );
      cfg.presets = user.filter((pr) => pr.name !== pick);
      if (cfg.defaultPreset === pick) cfg.defaultPreset = undefined;
      await saveConfig(cfg);
    } else {
      const pick = orCancel(
        await p.select({ message: L.preMakeDefaultWhich, options: allPresets(cfg).map((pr) => ({ value: pr.name, label: pr.name, hint: describePreset(pr) })) }),
      );
      cfg.defaultPreset = pick;
      await saveConfig(cfg);
    }
  }
  p.outro(pc.green(L.done));
}
