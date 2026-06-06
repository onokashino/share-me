import type { MetadataRoute } from 'next';
import { siteOrigin } from './seo';

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = await siteOrigin();
  // Single-page app; shared-drop links are private and intentionally unlisted.
  return [{ url: `${origin}/`, changeFrequency: 'monthly', priority: 1 }];
}
