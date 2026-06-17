import { t } from './i18n';

/** Build the share link in the exact format the web app uses: `{server}/?f={id}#k={fragment}`. */
export function buildLink(serverUrl: string, id: string, fragment: string): string {
  return `${serverUrl.replace(/\/+$/, '')}/?f=${id}#k=${fragment}`;
}

export interface ParsedLink {
  server: string;
  id: string;
  fragment: string;
}

export function parseLink(input: string): ParsedLink {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    throw new Error(t().errBadLink);
  }
  const id = url.searchParams.get('f');
  const fragment = url.hash.startsWith('#k=') ? url.hash.slice(3) : '';
  if (!id || !fragment) {
    throw new Error(t().errLinkMissing);
  }
  return { server: url.origin, id, fragment };
}
