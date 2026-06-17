import { Command } from 'commander';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { runUp } from './commands/up';
import { runDown } from './commands/down';
import { runServers } from './commands/servers';
import { runPresets } from './commands/presets';
import { runLang } from './commands/lang';
import { loadConfig } from './config';
import { t, setLanguage, normalizeLang } from './i18n';
import { orCancel } from './ui';

/** Pick the language from --lang, then config, then env, then English. */
async function applyLanguage(flagLang?: string): Promise<void> {
  const cfg = await loadConfig();
  const env = process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG;
  setLanguage(normalizeLang(flagLang) ?? cfg.lang ?? normalizeLang(env) ?? 'en');
}

const program = new Command();

program
  .name('share-me')
  .description('End-to-end-encrypted file & text sharing, from the console')
  .version('0.0.0')
  .option('--lang <code>', 'interface language: en | ru | zh')
  .hook('preAction', async () => {
    await applyLanguage(program.opts().lang as string | undefined);
  });

program
  .command('up')
  .description('Encrypt and upload a file, folder, or text, then print a share link')
  .argument('[path]', 'file or folder to upload (omit when using --text)')
  .option('-s, --server <name|url>', 'server profile name or full URL')
  .option('-t, --text <text>', 'share a text message instead of a file')
  .option('-P, --preset <name>', 'use a saved or built-in settings preset')
  .option('-p, --password', 'protect with a password (prompted)')
  .option('-e, --expires <dur>', 'lifetime, e.g. 1h 7d 30d')
  .option('-m, --max-downloads <n>', 'download limit (0 = unlimited)')
  .option('--burn', 'burn after reading (max-downloads = 1)')
  .option('--unlock <dur>', 'time-lock: not downloadable until now + dur')
  .option('--zip', 'archive a folder into a zip without asking')
  .option('-o, --out <name>', 'file/archive name shown to the recipient')
  .option('-y, --yes', 'skip interactive prompts (use preset/flags/defaults)')
  .action((path, opts) => runUp(path, opts));

program
  .command('down')
  .description('Download and decrypt a share link (text is shown; files prompt for a name)')
  .argument('<link>', 'the full share link (with #k=...)')
  .option('-o, --out <path>', 'write to this exact path, no prompts')
  .option('--print', 'print text to stdout and do not prompt to save')
  .option('-y, --yes', 'non-interactive: print text, save files under their original names')
  .option('-p, --password <password>', 'password (or set SHARE_ME_PASSWORD)')
  .action((link, opts) => runDown(link, opts));

program
  .command('servers')
  .alias('config')
  .description('Manage server profiles (list | add | default | rm)')
  .argument('[action]', 'list | add | default | rm')
  .argument('[name]', 'profile name')
  .argument('[url]', 'server URL (for add)')
  .action((action, name, url) => runServers(action, name, url));

program
  .command('presets')
  .alias('preset')
  .description('Manage settings presets (list | add | default | rm)')
  .argument('[action]', 'list | add | default | rm')
  .argument('[name]', 'preset name')
  .action((action, name) => runPresets(action, name));

program
  .command('lang')
  .alias('language')
  .description('Set the interface language (en | ru | zh)')
  .argument('[code]', 'en | ru | zh')
  .action((code) => runLang(code));

async function interactiveMenu(): Promise<void> {
  await applyLanguage();
  const L = t();
  p.intro(pc.cyan(pc.bold('share·me')));
  const choice = orCancel(
    await p.select({
      message: L.menuQ,
      options: [
        { value: 'up', label: L.menuUp },
        { value: 'down', label: L.menuDown },
        { value: 'servers', label: L.menuServers },
        { value: 'presets', label: L.menuPresets },
        { value: 'lang', label: L.langPrompt },
      ],
    }),
  );
  if (choice === 'up') {
    const path = orCancel(await p.text({ message: L.menuFilePath, placeholder: './secret.zip' }));
    if (path) {
      await runUp(path, {});
    } else {
      const text = orCancel(await p.text({ message: L.menuText }));
      await runUp(undefined, { text });
    }
  } else if (choice === 'down') {
    const link = orCancel(await p.text({ message: L.menuLink, placeholder: 'https://…/?f=…#k=…' }));
    await runDown(link, {});
  } else if (choice === 'presets') {
    await runPresets();
  } else if (choice === 'lang') {
    await runLang();
  } else {
    await runServers();
  }
}

if (process.argv.length <= 2) {
  void interactiveMenu();
} else {
  program.parseAsync(process.argv);
}
