import JSZip from 'jszip';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

/** Recursively archive a directory into a single zip (DEFLATE), as bytes. */
export async function zipDir(dir: string): Promise<Uint8Array> {
  const zip = new JSZip();

  async function walk(d: string): Promise<void> {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const full = join(d, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const rel = relative(dir, full).split(/[\\/]+/).join('/');
        zip.file(rel, await readFile(full));
      }
    }
  }

  await walk(dir);
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
