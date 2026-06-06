import { headers } from 'next/headers';
import type { Lang } from './i18n/useI18n';

export interface SeoStrings {
  title: string;
  description: string;
  keywords: string[];
  ogLocale: string;
}

/**
 * Localized SEO copy. Server-only (this module imports next/headers via
 * siteOrigin and is only consumed by server components / metadata routes).
 */
export const SEO: Record<Lang, SeoStrings> = {
  en: {
    title: 'share·me — encrypted file & text sharing',
    description:
      'Send files and text with end-to-end encryption. The decryption key lives only in the link — the server never sees your data. No accounts, no tracking, self-hostable. AES-256, zero-knowledge.',
    keywords: [
      'encrypted file sharing',
      'end-to-end encryption',
      'secure file transfer',
      'private file sharing',
      'zero-knowledge',
      'self-hosted file sharing',
      'AES-256',
      'anonymous file sharing',
      'send encrypted files',
      'share·me',
    ],
    ogLocale: 'en_US',
  },
  ru: {
    title: 'share·me — шифрованная передача файлов и текста',
    description:
      'Отправляйте файлы и текст со сквозным шифрованием. Ключ расшифровки находится только в ссылке — сервер не видит ваши данные. Без аккаунтов и трекинга, можно развернуть у себя. AES-256, zero-knowledge.',
    keywords: [
      'шифрование файлов',
      'сквозное шифрование',
      'безопасная передача файлов',
      'приватная передача файлов',
      'zero-knowledge',
      'self-hosted',
      'AES-256',
      'анонимная отправка файлов',
      'зашифрованные ссылки',
      'share·me',
    ],
    ogLocale: 'ru_RU',
  },
  zh: {
    title: 'share·me — 端對端加密的檔案與文字分享',
    description:
      '以端對端加密傳送檔案與文字。解密金鑰只存在於連結中 — 伺服器永遠看不到你的資料。無需帳號、不追蹤、可自行架設。AES-256、零知識。',
    keywords: [
      '加密檔案分享',
      '端對端加密',
      '安全檔案傳輸',
      '私密檔案分享',
      '零知識',
      '自架',
      'AES-256',
      '匿名檔案分享',
      'share·me',
    ],
    ogLocale: 'zh_TW',
  },
};

/**
 * Absolute origin of this deployment, for canonical / OG / sitemap URLs.
 * Prefers an explicit NEXT_PUBLIC_SITE_URL; otherwise derives it from the
 * request Host (works for any self-host domain without rebuilding the image).
 */
export async function siteOrigin(): Promise<string> {
  const env = process.env.NEXT_PUBLIC_SITE_URL;
  if (env) return env.replace(/\/+$/, '');
  const h = await headers();
  const host = h.get('host') ?? 'localhost';
  const proto =
    h.get('x-forwarded-proto')?.split(',')[0]?.trim() ??
    (host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https');
  return `${proto}://${host}`;
}
