import * as p from '@clack/prompts';
import pc from 'picocolors';
import { loadConfig, saveConfig } from '../config';
import { orCancel } from '../ui';
import { t, setLanguage, getLanguage, normalizeLang, LANGS, type Lang } from '../i18n';

export async function runLang(arg?: string): Promise<void> {
  const cfg = await loadConfig();
  let lang = normalizeLang(arg);
  if (!lang) {
    const pick = orCancel(
      await p.select({
        message: t().langPrompt,
        initialValue: getLanguage(),
        options: LANGS.map((l) => ({ value: l, label: t().langNames[l] })),
      }),
    );
    lang = pick as Lang;
  }
  setLanguage(lang);
  cfg.lang = lang;
  await saveConfig(cfg);
  console.log(pc.green(t().langSet(t().langNames[lang])));
}
