import { Suspense } from 'react';
import { connection } from 'next/server';
import { AppShell } from './AppShell';
import { resolveServerLang } from './i18n/server';

// connection() forces dynamic rendering so that the per-request nonce from
// proxy.ts is available when Next.js generates the HTML — without this the
// page is statically pre-rendered at build time and Next.js cannot attach the
// nonce to its injected <script> tags, causing CSP violations that block React
// hydration entirely.
export default async function Page() {
  await connection();
  // Server-resolved initial language → the shell renders directly in the right
  // language, with no post-hydration RU→chosen flash.
  const lang = await resolveServerLang();
  return (
    <Suspense>
      <AppShell initialLang={lang} />
    </Suspense>
  );
}
