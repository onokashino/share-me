import { stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { Readable } from 'node:stream';
import { basename } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { encryptFileStream, encodeBundleStream, type BundleStreamEntry } from '@share-me/crypto';
import { loadConfig } from '../config';
import { resolveServer, orCancel } from '../ui';
import { resolveSettings, type UpSettingFlags } from '../settings';
import { DEFAULT_ARGON_PARAMS, deriveArgon2, computeDlAuthHashHex, base64Std } from '../crypto-node';
import { createUpload, putBlobStream } from '../api';
import { buildLink } from '../link';
import { zipDir } from '../archive';
import { mimeFromName, humanSecs, humanSize } from '../util';
import { t } from '../i18n';

export interface UpOpts extends UpSettingFlags {
  server?: string;
  text?: string;
  out?: string;
  zip?: boolean;
  yes?: boolean;
}

/** A ReadableStream that emits the given bytes once (for in-memory payloads). */
function oneChunk(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(c) {
      if (bytes.length) c.enqueue(bytes);
      c.close();
    },
  });
}

/** A web ReadableStream that reads a file from disk in chunks. */
function fileStream(path: string): ReadableStream<Uint8Array> {
  return Readable.toWeb(createReadStream(path)) as unknown as ReadableStream<Uint8Array>;
}

export async function runUp(file: string | undefined, opts: UpOpts): Promise<void> {
  const L = t();
  p.intro(pc.cyan(pc.bold('share·me')) + pc.dim(L.tagUp));
  try {
    const interactive = !opts.yes && !!process.stdout.isTTY && !!process.stdin.isTTY;
    const cfg = await loadConfig();

    // ── Build the payload bundle entries (text / file / folder) ──
    let entries: BundleStreamEntry[];
    let kind: 'files' | 'text';
    let metaName: string;
    let metaType: string;
    if (opts.text !== undefined) {
      const bytes = new TextEncoder().encode(opts.text);
      entries = [{ name: 'message.txt', type: 'text/plain', size: bytes.length, stream: () => oneChunk(bytes) }];
      kind = 'text';
      metaName = 'message.txt';
      metaType = 'text/plain';
    } else if (file) {
      const info = await stat(file).catch(() => null);
      if (!info) {
        p.cancel(L.upNoSuchPath(file));
        process.exit(1);
      }
      if (info.isDirectory()) {
        const doZip =
          opts.zip ||
          (interactive ? orCancel(await p.confirm({ message: L.upFolderZipQ(basename(file)), initialValue: true })) : true);
        if (!doZip) {
          p.cancel(L.upFolderNeedsZip);
          process.exit(1);
        }
        const sp = p.spinner();
        sp.start(L.upArchiving);
        const zipped = await zipDir(file);
        sp.stop(L.upArchived(humanSize(zipped.length)));
        const name = (opts.out ?? basename(file)) + '.zip';
        entries = [{ name, type: 'application/zip', size: zipped.length, stream: () => oneChunk(zipped) }];
        kind = 'files';
        metaName = name;
        metaType = 'application/x-share-me-bundle';
      } else {
        const name = opts.out ?? basename(file);
        entries = [{ name, type: mimeFromName(name), size: info.size, stream: () => fileStream(file) }];
        kind = 'files';
        metaName = name;
        metaType = 'application/x-share-me-bundle';
      }
    } else {
      p.cancel(L.upNoPayload);
      process.exit(1);
    }

    // ── Server + settings (preset / interactive / flags) ──
    const server = await resolveServer(opts, cfg);
    const settings = await resolveSettings(opts, cfg, interactive);

    // ── Password ──
    let password: string | undefined;
    if (settings.password) {
      password =
        process.env.SHARE_ME_PASSWORD ??
        (interactive
          ? orCancel(await p.password({ message: L.upPasswordPrompt, validate: (v) => (v ? undefined : L.vRequired) }))
          : undefined);
      if (!password) {
        p.cancel(L.upPasswordRequired);
        process.exit(1);
      }
    }

    // ── Encrypt + upload (streamed end to end) ──
    const s = p.spinner();
    s.start(L.upEncrypting);
    const { totalLength, stream: payload } = encodeBundleStream(entries, kind);
    const enc = await encryptFileStream({
      source: payload,
      totalLength,
      meta: { name: metaName, type: metaType, size: totalLength },
      password,
      passwordKdf: password ? { type: 'argon2id', argon: DEFAULT_ARGON_PARAMS, deriveArgon2 } : undefined,
    });
    const dlAuthHashHex = await computeDlAuthHashHex(enc.downloadAuth.token);

    s.message(L.upCreating);
    const created = await createUpload(server.url, {
      header: base64Std(enc.header),
      download_auth_hash: dlAuthHashHex,
      max_downloads: settings.maxDownloads > 0 ? settings.maxDownloads : null,
      expires_in_secs: settings.expiresInSecs,
      unlock_in_secs: settings.unlockInSecs,
    });

    s.message(L.upUploading(humanSize(totalLength)));
    await putBlobStream(server.url, created.id, created.upload_token, enc.ciphertextStream);
    s.stop(L.upUploaded);

    const link = buildLink(server.url, created.id, enc.fragment);
    const limits = [
      L.limExpiresIn(humanSecs(settings.expiresInSecs)),
      settings.maxDownloads > 0 ? L.limDownloads(settings.maxDownloads) : L.limUnlimited,
      settings.unlockInSecs ? L.limUnlocksIn(humanSecs(settings.unlockInSecs)) : null,
      password ? L.limPassword : null,
    ]
      .filter(Boolean)
      .join(', ');

    p.note(pc.bold(link) + '\n\n' + pc.dim(L.upOwnerHint) + '\n' + created.owner_token, L.upShareLink);
    p.outro(pc.green(L.done) + pc.dim(` · ${limits}`));
  } catch (e) {
    p.cancel(pc.red((e as Error).message));
    process.exit(1);
  }
}
