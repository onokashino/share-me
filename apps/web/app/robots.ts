import type { MetadataRoute } from 'next';
import { siteOrigin } from './seo';

export default async function robots(): Promise<MetadataRoute.Robots> {
  const origin = await siteOrigin();
  return {
    // The whole app is a single public landing page. Shared-drop links carry
    // their key in the URL fragment (never sent to a server / crawler), so there
    // is nothing private to disallow.
    rules: { userAgent: '*', allow: '/' },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
