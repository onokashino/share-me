'use client';

/**
 * qrcode.tsx — SSR-safe QR code helper + <QrImage> component.
 *
 * qrDataUrl dynamically imports qrcode-generator so it is never
 * executed on the server (Next.js SSR).  The <QrImage> component
 * resolves the data URL in useEffect, rendering nothing until
 * the promise resolves — safe for the server.
 */

import { useState, useEffect } from 'react';

/**
 * Returns a data: URL (PNG canvas) for the given text.
 * Cell size 4, margin 0 — matches ex/app.jsx QR usage.
 */
export async function qrDataUrl(
  text: string,
  cell = 4,
  margin = 0,
): Promise<string> {
  // Dynamic import — keeps qrcode-generator out of the SSR bundle.
  // The ESM build (Turbopack picks it via the `module` field) exposes the
  // factory as a *named* `qrcode` export; the CJS build exposes it as the
  // default export, or as the module itself. Probe all three so the QR
  // renders regardless of how the bundler resolved the package.
  type QrFactory = (n: number, level: 'L' | 'M' | 'Q' | 'H') => {
    addData(d: string): void;
    make(): void;
    createDataURL(cell?: number, margin?: number): string;
  };
  const mod = (await import('qrcode-generator')) as unknown as Record<string, unknown>;
  const QR = (mod.qrcode ?? mod.default ?? mod) as QrFactory;
  const qr = QR(0, 'M');
  qr.addData(text);
  qr.make();
  return qr.createDataURL(cell, margin);
}

/**
 * <QrImage text="…" />
 *
 * Renders a 100 % × 100 % pixelated <img> inside a .qr tile.
 * Resolves the data URL on the client only; renders an empty
 * .qr placeholder during SSR / before the promise settles.
 */
export function QrImage({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // cell 6 keeps the QR crisp at the larger (140px) tile.
    qrDataUrl(text, 6).then((url) => {
      if (!cancelled) setSrc(url);
    });
    return () => { cancelled = true; };
  }, [text]);

  return (
    <div className="qr">
      {src && (
        <img
          src={src}
          alt="QR code"
          style={{ imageRendering: 'pixelated', width: '100%', height: '100%', display: 'block' }}
        />
      )}
    </div>
  );
}
