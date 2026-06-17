import * as p from '@clack/prompts';
import pc from 'picocolors';
import { allPresets, describePreset, findPreset, BUILTIN_PRESETS, type Config, type Preset } from './config';
import { orCancel } from './ui';
import { parseDuration } from './util';
import { t } from './i18n';

export interface UpSettingFlags {
  expires?: string;
  maxDownloads?: string;
  burn?: boolean;
  unlock?: string;
  password?: boolean;
  preset?: string;
}

export interface ResolvedSettings {
  expiresInSecs: number;
  maxDownloads: number;
  unlockInSecs: number | null;
  password: boolean;
}

/** Resolve upload settings from a preset (--preset / interactive pick / default) with flag overrides. */
export async function resolveSettings(opts: UpSettingFlags, cfg: Config, interactive: boolean): Promise<ResolvedSettings> {
  const hasFlag =
    opts.expires !== undefined ||
    opts.maxDownloads !== undefined ||
    !!opts.burn ||
    opts.unlock !== undefined ||
    !!opts.password;

  let preset: Preset;
  if (opts.preset) {
    const found = findPreset(cfg, opts.preset);
    if (!found) throw new Error(t().setNoPreset(opts.preset));
    preset = found;
  } else if (interactive && !hasFlag) {
    preset = await pickSettings(cfg);
  } else {
    preset = findPreset(cfg, cfg.defaultPreset) ?? BUILTIN_PRESETS[0];
  }

  const expires = opts.expires ?? preset.expires;
  const maxDownloads = opts.burn
    ? 1
    : opts.maxDownloads !== undefined
      ? Math.max(0, parseInt(opts.maxDownloads, 10) || 0)
      : preset.maxDownloads;
  const unlock = opts.unlock ?? preset.unlock;

  return {
    expiresInSecs: parseDuration(expires),
    maxDownloads,
    unlockInSecs: unlock ? parseDuration(unlock) : null,
    password: !!opts.password || !!preset.password,
  };
}

export async function pickSettings(cfg: Config): Promise<Preset> {
  const L = t();
  const presets = allPresets(cfg);
  const options = [
    ...presets.map((pr) => ({
      value: pr.name,
      label: pr.name + (pr.name === cfg.defaultPreset ? pc.green(L.preDefaultTag) : ''),
      hint: describePreset(pr),
    })),
    { value: '__custom__', label: L.setCustom, hint: L.setCustomHint },
  ];
  const pick = orCancel(await p.select({ message: L.setSettings, options, initialValue: cfg.defaultPreset ?? 'default' }));
  if (pick === '__custom__') return customSettings();
  return presets.find((pr) => pr.name === pick)!;
}

/** Prompt for each setting and return them as an unnamed preset. */
export async function customSettings(): Promise<Preset> {
  const L = t();
  const exp = orCancel(
    await p.select({
      message: L.setLifetime,
      initialValue: '7d',
      options: [
        { value: '1h', label: L.setHour1 },
        { value: '1d', label: L.setDay1 },
        { value: '7d', label: L.setDay7 },
        { value: '30d', label: L.setDay30 },
        { value: '__c__', label: L.setCustomDots },
      ],
    }),
  );
  const expires = exp === '__c__' ? orCancel(await p.text({ message: L.setLifetimeCustom, validate: validDuration })) : exp;

  const dl = orCancel(
    await p.select({
      message: L.setDownloads,
      initialValue: 'u',
      options: [
        { value: 'u', label: L.setUnlimited },
        { value: 'b', label: L.setBurn },
        { value: 'c', label: L.setCustomLimit },
      ],
    }),
  );
  const maxDownloads =
    dl === 'b'
      ? 1
      : dl === 'c'
        ? parseInt(orCancel(await p.text({ message: L.setMaxDownloads, validate: validPositiveInt })), 10)
        : 0;

  const locked = orCancel(await p.confirm({ message: L.setTimeLockQ, initialValue: false }));
  const unlock = locked ? orCancel(await p.text({ message: L.setUnlockAfter, validate: validDuration })) : undefined;

  const password = orCancel(await p.confirm({ message: L.setPasswordQ, initialValue: false }));

  return { name: 'custom', expires, maxDownloads, unlock, password };
}

export function validDuration(v: string): string | undefined {
  return /^\d+\s*(s|m|h|d|w)?$/i.test(v.trim()) ? undefined : t().vDuration;
}
export function validPositiveInt(v: string): string | undefined {
  return /^\d+$/.test(v.trim()) && parseInt(v, 10) > 0 ? undefined : t().vPositiveInt;
}
