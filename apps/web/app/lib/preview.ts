/**
 * preview.ts — file-type helpers and save-file utility.
 *
 * Ported from ex/app.jsx lines 37–39 (isImage/isPdf/isPreviewable)
 * and the saveFile pattern at lines 561–568.
 *
 * saveFile is UI-agnostic: it triggers the browser download and
 * returns — the view layer is responsible for any toast.
 */

/** True when the MIME type is any image/. */
export function isImage(type: string): boolean {
  return /^image\//.test(type || '');
}

/** True when the MIME type is application/pdf, or the filename ends in .pdf. */
export function isPdf(type: string, name: string): boolean {
  return type === 'application/pdf' || /\.pdf$/i.test(name || '');
}

/** True when the file can be previewed in the lightbox (image or PDF). */
export function isPreviewable(type: string, name: string): boolean {
  return isImage(type) || isPdf(type, name);
}

/**
 * Trigger a browser download for a blob file.
 * Creates an object URL, clicks a temporary <a download>, then revokes
 * the URL after ~4 s to allow the download to start.
 *
 * The view layer is responsible for showing a success/error toast.
 */
export function saveFile(file: { name: string; blob: Blob }): void {
  const url = URL.createObjectURL(file.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
