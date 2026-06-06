/**
 * zip.ts — client-only ZIP download helper.
 *
 * Dynamically imports jszip so it is never included in the server bundle.
 * Caller is responsible for showing a toast on error.
 */

/**
 * Bundle the given files into a ZIP and trigger a browser download.
 *
 * @param files    Array of { name, blob } entries to include in the ZIP.
 * @param filename The downloaded filename (default: "share-me.zip").
 * @throws         On any jszip failure so the caller can toast the error.
 */
export async function downloadZip(
  files: { name: string; blob: Blob }[],
  filename = 'share-me.zip',
): Promise<void> {
  const JSZip = (await import('jszip')).default;
  const zip = new JSZip();

  for (const { name, blob } of files) {
    zip.file(name, blob);
  }

  const zipBlob = await zip.generateAsync({ type: 'blob' });

  const url = URL.createObjectURL(zipBlob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Revoke after a short delay to allow the download to start
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
