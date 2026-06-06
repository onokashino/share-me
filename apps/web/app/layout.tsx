import type { Metadata, Viewport } from 'next';
import { spaceGrotesk, jetbrainsMono, jetbrainsMonoCyr, manropeCyr } from './fonts';
import { resolveServerLang } from './i18n/server';
import { SEO, siteOrigin } from './seo';
import './globals.css';

export async function generateMetadata(): Promise<Metadata> {
  const [lang, origin] = await Promise.all([resolveServerLang(), siteOrigin()]);
  const seo = SEO[lang];
  return {
    metadataBase: new URL(origin),
    title: seo.title,
    description: seo.description,
    keywords: seo.keywords,
    applicationName: 'share·me',
    authors: [{ name: 'share·me' }],
    creator: 'share·me',
    category: 'security',
    alternates: { canonical: '/' },
    formatDetection: { telephone: false, email: false, address: false },
    icons: {
      icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
      shortcut: '/icon.svg',
      apple: '/icon.svg',
    },
    manifest: '/manifest.webmanifest',
    openGraph: {
      type: 'website',
      siteName: 'share·me',
      title: seo.title,
      description: seo.description,
      url: '/',
      locale: seo.ogLocale,
    },
    twitter: {
      card: 'summary_large_image',
      title: seo.title,
      description: seo.description,
    },
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true, 'max-image-preview': 'large' },
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#0b0d12',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Resolve the language server-side (cookie → Accept-Language → 'en') so both
  // <html lang> and the first paint are already correct — no RU→chosen flash.
  const lang = await resolveServerLang();
  return (
    <html
      lang={lang === 'zh' ? 'zh-Hant' : lang}
      className={`dark ${spaceGrotesk.variable} ${jetbrainsMono.variable} ${jetbrainsMonoCyr.variable} ${manropeCyr.variable}`}
    >
      <body>
        {/* Atmospheric background layers */}
        <div className="bg-field">
          <div className="bg-grid" />
          <div className="bg-grain" />
        </div>
        {children}
      </body>
    </html>
  );
}
