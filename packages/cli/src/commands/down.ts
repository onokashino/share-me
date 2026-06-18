import { writeFile, rename, unlink } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { finished } from 'node:stream/promises';
import { basename, extname } from 'node:path';
import { randomUUID } from 'node:crypto';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import {
  decryptFileStream,
  decodeBundleStream,
  type BundleStreamFile,
  deriveKeys,
  parseHeader,
  pbkdf2,
  computeDownloadAuth,
  fromBase64Url,
  toBase64Url,
  KdfType,
} from '@share-me/crypto';
import { deriveArgon2 } from '../crypto-node';
import { getHeader, downloadBlobStream } from '../api';
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

/** Streams exactly one bundle file's bytes to the supplied sink. */
type Pipe = (onChunk: (c: Uint8Array) => Promise<void> | void) => Promise<void>;

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
    const ciphertextStream = await downloadBlobStream(server, id, bearer, randomUUID());

    step(L.dnDecrypting);
    const { plaintextStream } = await decryptFileStream({ header, ciphertextStream, fragment, password, deriveArgon2 });

    // The header is authenticated at this point; stop the spinner before we
    // stream the plaintext out (and possibly prompt for save targets).
    stopSpinner(interactive ? L.dnDecrypted : undefined);

    const { written, textNotSaved } = await deliver(plaintextStream, interactive, opts);

    if (interactive) {
      if (written.length) p.outro(pc.green(L.saved) + written.map((s) => pc.bold(s)).join(', '));
      else if (textNotSaved) p.outro(pc.dim(L.dnShownNotSaved));
      else p.outro(pc.green(L.done));
    } else if (written.length) {
      process.stderr.write(pc.green(`${L.saved}${written.join(', ')}`) + '\n');
    }
  } catch (e) {
    const msg = (e as Error).message;
    if (interactive) p.cancel(pc.red(msg));
    else process.stderr.write(pc.red(msg) + '\n');
    process.exit(1);
  }
}

/** Decode the plaintext bundle stream and route each file to its destination. */
async function deliver(
  plaintextStream: ReadableStream<Uint8Array>,
  interactive: boolean,
  opts: DownOpts,
): Promise<{ written: string[]; textNotSaved: boolean }> {
  const written: string[] = [];
  let textNotSaved = false;
  await decodeBundleStream(plaintextStream, async (file, pipe) => {
    if (file.kind === 'text') {
      const bytes = await drain(pipe);
      const saved = await deliverText(bytes, interactive, opts);
      if (saved) written.push(saved);
      else if (interactive) textNotSaved = true;
    } else {
      const saved = await deliverFile(file, pipe, interactive, opts);
      if (saved) written.push(saved);
    }
  });
  return { written, textNotSaved };
}

async function deliverText(bytes: Uint8Array, interactive: boolean, opts: DownOpts): Promise<string | null> {
  const L = t();
  if (!interactive) {
    if (opts.out) {
      await writeFile(opts.out, bytes);
      return opts.out;
    }
    const text = new TextDecoder().decode(bytes);
    process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    return null;
  }
  const text = new TextDecoder().decode(bytes);
  p.note(text.length ? text : pc.dim('(empty)'), `${L.dnMessage} · ${humanSize(bytes.length)}`);

  const save = orCancel(await p.confirm({ message: L.dnSaveQ, initialValue: false }));
  if (!save) return null;
  const base = orCancel(
    await p.text({ message: L.dnFileName, defaultValue: 'message', placeholder: 'message', validate: validateBaseName }),
  );
  const ext = orCancel(await p.text({ message: L.dnFormat, defaultValue: 'txt', placeholder: 'txt', validate: validateExt }));
  const outPath = joinNameExt(base, ext);
  await writeFile(outPath, bytes);
  return outPath;
}

async function deliverFile(
  file: BundleStreamFile,
  pipe: Pipe,
  interactive: boolean,
  opts: DownOpts,
): Promise<string | null> {
  const L = t();
  if (!interactive && opts.out) {
    // --out names a single destination: the first file goes there, extras are
    // drained so the stream stays aligned (matches the previous behaviour).
    if (file.index === 0) {
      await streamToFile(pipe, opts.out);
      return opts.out;
    }
    await pipe(() => {});
    return null;
  }

  let target: string;
  if (interactive) {
    const ext = extname(file.name);
    const defBase = basename(file.name, ext);
    const input = orCancel(
      await p.text({ message: L.dnSaveAs(file.name, ext), defaultValue: defBase, placeholder: defBase, validate: validateBaseName }),
    );
    target = stripExt(input, ext) + ext;
  } else {
    target = file.name;
  }
  await streamToFile(pipe, target);
  return target;
}

/** Collect a (small) streamed file fully into memory, e.g. a shared text message. */
async function drain(pipe: Pipe): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  await pipe((c) => {
    chunks.push(c);
  });
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

/**
 * Stream a file to disk via a temp file, renaming to `finalPath` only after the
 * stream closes cleanly, so a truncated or tampered stream (which errors before
 * the final segment) never leaves a half-written file under the real name.
 */
async function streamToFile(pipe: Pipe, finalPath: string): Promise<void> {
  const tmp = `${finalPath}.shme-part-${randomUUID()}`;
  const ws = createWriteStream(tmp);
  try {
    await pipe(
      (c) =>
        new Promise<void>((resolve, reject) => {
          ws.write(c, (err) => (err ? reject(err) : resolve()));
        }),
    );
    ws.end();
    await finished(ws);
    await rename(tmp, finalPath);
  } catch (e) {
    ws.destroy();
    await unlink(tmp).catch(() => {});
    throw e;
  }
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
