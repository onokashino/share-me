import { NextRequest, NextResponse } from 'next/server';

export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';

  const cspHeader = [
    "default-src 'self'",
    // 'nonce-...' allows Next 16's injected RSC-streaming scripts.
    // 'wasm-unsafe-eval' is required by the Argon2 WASM worker.
    // Do NOT add 'strict-dynamic' — it suppresses 'self' and breaks same-origin
    // script/worker loading.
    `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'${isDev ? " 'unsafe-eval'" : ''}`,
    // Workers inherit the page CSP; worker-src 'self' allows same-origin workers
    // (e.g. /_next/static/…/argon2.worker.js).
    "worker-src 'self'",
    "style-src 'self'",
    // Inline style attributes are used by some runtime CSS-in-JS patterns.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self'",
    "img-src 'self' blob: data:",
    // The PDF preview renders a same-origin blob: URL in an <iframe> (the blob
    // is force-typed application/pdf, so it can't be interpreted as HTML).
    // 'self' does NOT cover the blob: scheme for frames, so it must be explicit.
    "frame-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');

  const requestHeaders = new Headers(request.headers);
  // x-nonce is forwarded to Server Components so they can read it via headers()
  // if they need to pass it to <Script nonce={...}>.
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', cspHeader);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set('Content-Security-Policy', cspHeader);

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths EXCEPT:
     * - _next/static  (static files — nonce is irrelevant; CSP already set for
     *                  the page that loaded them)
     * - _next/image   (image optimisation endpoint)
     * - favicon.ico
     * Also skip prefetch requests so we don't double-render.
     */
    {
      source: '/((?!_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
