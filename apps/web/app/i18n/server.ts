import { cookies, headers } from 'next/headers';
import type { Lang } from './useI18n';

function isLang(s: string | undefined | null): s is Lang {
  return s === 'ru' || s === 'en' || s === 'zh';
}

/**
 * Resolve the UI language on the SERVER so the first HTML is already in the
 * right language — no RU→chosen flash after hydration. Order:
 *   1. the `sm_lang` cookie  (explicit prior choice; written by setLang)
 *   2. the Accept-Language header  (browser preference order — auto-detect)
 *   3. default 'en'
 *
 * Uses next/headers, so it is server-only by construction.
 */
export async function resolveServerLang(): Promise<Lang> {
  const cookie = (await cookies()).get('sm_lang')?.value;
  if (isLang(cookie)) return cookie;

  const accept = (await headers()).get('accept-language') ?? '';
  for (const part of accept.split(',')) {
    const tag = part.split(';')[0]?.trim().slice(0, 2).toLowerCase();
    if (isLang(tag)) return tag;
  }
  return 'en';
}
