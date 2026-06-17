import { writeFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  decryptFile,
  decodeBundle,
  deriveKeys,
  parseHeader,
  pbkdf2,
  computeDownloadAuth,
  fromBase64Url,
  toBase64Url,
  KdfType,
} from '@share-me/crypto';
import { deriveArgon2 } from '../crypto-node';
import { getHeader, downloadBlob } from '../api';
import { parseLink } from '../link';
import { orCancel } from '../ui';
import { humanSize } from '../util';
import { t } from '../i18n';

export interface DownOpts {
  out?: string;
  password?: string;
  print?: boolean;
  yes?: boolean;
}

interface Decoded {
  kind: 'files' | 'text';
  files: Array<{ name: string; type: string; bytes: Uint8Array }>;
}

export async function runDown(link: string, opts: DownOpts): Promise<void> {
  const L = t();
  const interactive =
    !opts.out && !opts.print && !opts.yes && !!process.stdout.isTTY && !!process.stdin.isTTY;

  if (interactive) p.intro(pc.cyan(pc.bold('share·me')) + pc.dim(L.tagDown));

  let sp: ReturnType<typeof p.spinner> | null = null;
  let spinning = false;
  const step = (m: string) => {
    if (!interactive) {
      process.stderr.write(pc.dim(`· ${m}\n`));
      return;
    }
    if (!sp) sp = p.spinner();
    if (!spinning) {
      sp.start(m);
      spinning = true;
    } else {
      sp.message(m);
    }
  };
  const stopSpinner = (m?: string) => {
    if (sp && spinning) {
      sp.stop(m);
      spinning = false;
    }
  };

  try {
    const { server, id, fragment } = parseLink(link);

    step(L.dnFetchingHeader);
    const header = await getHeader(server, id);
    const parsed = parseHeader(header);

    let password = opts.password ?? process.env.SHARE_ME_PASSWORD;
    if (parsed.kdfType !== KdfType.None && !password) {
      if (!interactive) {
        stopSpinner();
        throw new Error(L.dnPwFlagNeeded);
      }
      stopSpinner();
      password = orCancel(await p.password({ message: L.dnPwPrompt, validate: (v) => (v ? undefined : L.vRequired) }));
    }

    step(L.dnDeriving);
    let kp: Uint8Array | undefined;
    if (parsed.kdfType === KdfType.Argon2id) {
      const dv = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length);
      kp = await deriveArgon2(password!, parsed.salt, {
        m: dv.getUint32(0, false),
        t: dv.getUint32(4, false),
        pp: dv.getUint32(8, false),
      });
    } else if (parsed.kdfType === KdfType.Pbkdf2) {
      const dv = new DataView(parsed.params.buffer, parsed.params.byteOffset, parsed.params.length);
      kp = await pbkdf2(password!, parsed.salt, dv.getUint32(0, false));
    }
    const master = fromBase64Url(fragment);
    const keys = await deriveKeys(master, parsed.salt, kp);
    const bearer = toBase64Url((await computeDownloadAuth(keys.authKey)).token);

    step(L.dnDownloading);
    const ciphertext = await downloadBlob(server, id, bearer, randomUUID());

    step(L.dnDecrypting);
    const { plaintext } = await decryptFile({ header, ciphertext, fragment, password, deriveArgon2 });
    const decoded = decodeBundle(plaintext) as Decoded;
    stopSpinner(L.dnDecrypted);

    if (interactive) await outputInteractive(decoded);
    else await outputDirect(decoded, opts);
  } catch (e) {
    const msg = (e as Error).message;
    if (interactive) p.cancel(pc.red(msg));
    else process.stderr.write(pc.red(msg) + '\n');
    process.exit(1);
  }
}

async function outputInteractive(decoded: Decoded): Promise<void> {
  const L = t();
  if (decoded.kind === 'text') {
    const f = decoded.files[0];
    const text = new TextDecoder().decode(f.bytes);
    p.note(text.length ? text : pc.dim('(empty)'), `${L.dnMessage} · ${humanSize(f.bytes.length)}`);

    const save = orCancel(await p.confirm({ message: L.dnSaveQ, initialValue: false }));
    if (!save) {
      p.outro(pc.dim(L.dnShownNotSaved));
      return;
    }
    const base = orCancel(
      await p.text({ message: L.dnFileName, defaultValue: 'message', placeholder: 'message', validate: validateBaseName }),
    );
    const ext = orCancel(await p.text({ message: L.dnFormat, defaultValue: 'txt', placeholder: 'txt', validate: validateExt }));
    const outPath = joinNameExt(base, ext);
    await writeFile(outPath, f.bytes);
    p.outro(pc.green(L.saved) + pc.bold(outPath));
    return;
  }

  const saved: string[] = [];
  for (const f of decoded.files) {
    const ext = extname(f.name);
    const defBase = basename(f.name, ext);
    const input = orCancel(
      await p.text({ message: L.dnSaveAs(f.name, ext), defaultValue: defBase, placeholder: defBase, validate: validateBaseName }),
    );
    const outPath = stripExt(input, ext) + ext;
    await writeFile(outPath, f.bytes);
    saved.push(outPath);
  }
  p.outro(pc.green(L.saved) + saved.map((s) => pc.bold(s)).join(', '));
}

async function outputDirect(decoded: Decoded, opts: DownOpts): Promise<void> {
  const L = t();
  if (opts.out) {
    await writeFile(opts.out, decoded.files[0].bytes);
    process.stderr.write(pc.green(`${L.saved}${opts.out}`) + '\n');
    return;
  }
  if (decoded.kind === 'text') {
    const text = new TextDecoder().decode(decoded.files[0].bytes);
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    return;
  }
  const saved: string[] = [];
  for (const f of decoded.files) {
    await writeFile(f.name, f.bytes);
    saved.push(f.name);
  }
  process.stderr.write(pc.green(`${L.saved}${saved.join(', ')}`) + '\n');
}

function validateBaseName(v: string): string | undefined {
  const L = t();
  if (!v || !v.trim()) return L.vRequired;
  if (/[<>"|?*]/.test(v)) return L.vInvalidChar;
  if (/[ .]$/.test(v)) return L.vNoTrailing;
  return undefined;
}

function validateExt(v: string): string | undefined {
  if (!v) return undefined;
  if (!/^\.?[A-Za-z0-9]{1,12}$/.test(v)) return t().vExtChars;
  return undefined;
}

function joinNameExt(base: string, ext: string): string {
  const e = ext.replace(/^\.+/, '');
  return e ? `${base}.${e}` : base;
}

function stripExt(name: string, ext: string): string {
  if (ext && name.toLowerCase().endsWith(ext.toLowerCase())) return name.slice(0, -ext.length);
  return name;
}
