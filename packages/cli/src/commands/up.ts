import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import * as p from '@clack/prompts';
import pc from 'picocolors';
import { encryptFile, encodeBundle } from '@share-me/crypto';
import { loadConfig } from '../config';
import { resolveServer, orCancel } from '../ui';
import { resolveSettings, type UpSettingFlags } from '../settings';
import { DEFAULT_ARGON_PARAMS, deriveArgon2, computeDlAuthHashHex, base64Std } from '../crypto-node';
import { createUpload, putBlob } from '../api';
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

export async function runUp(file: string | undefined, opts: UpOpts): Promise<void> {
  const L = t();
  p.intro(pc.cyan(pc.bold('share·me')) + pc.dim(L.tagUp));
  try {
    const interactive = !opts.yes && !!process.stdout.isTTY && !!process.stdin.isTTY;
    const cfg = await loadConfig();

    // ── Build the payload bundle (text / file / folder) ──
    let bundle: Uint8Array;
    let metaName: string;
    let metaType: string;
    if (opts.text !== undefined) {
      const bytes = new TextEncoder().encode(opts.text);
      bundle = encodeBundle([{ name: 'message.txt', type: 'text/plain', bytes }], 'text');
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
        bundle = encodeBundle([{ name, type: 'application/zip', bytes: zipped }], 'files');
        metaName = name;
        metaType = 'application/x-share-me-bundle';
      } else {
        const name = opts.out ?? basename(file);
        const bytes = new Uint8Array(await readFile(file));
        bundle = encodeBundle([{ name, type: mimeFromName(name), bytes }], 'files');
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

    // ── Encrypt + upload ──
    const s = p.spinner();
    s.start(L.upEncrypting);
    const enc = await encryptFile({
      plaintext: bundle,
      meta: { name: metaName, type: metaType, size: bundle.length },
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

    s.message(L.upUploading(humanSize(enc.ciphertext.length)));
    await putBlob(server.url, created.id, created.upload_token, enc.ciphertext);
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
