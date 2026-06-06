import localFont from 'next/font/local';

// The bundled Space Grotesk / JetBrains Mono woff2 are Latin-only subsets, so
// Cyrillic text fell through to a system font. `adjustFontFallback` is disabled
// on the Latin faces because its metric-tuned Arial fallback is unrestricted and
// would otherwise capture Cyrillic before the dedicated Cyrillic faces below.

export const spaceGrotesk = localFont({
  src: [
    { path: './fonts/SpaceGrotesk-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/SpaceGrotesk-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/SpaceGrotesk-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-space-grotesk',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
});

export const jetbrainsMono = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
});

// Cyrillic-only companions, layered after the Latin faces in the font stacks.
// JetBrains Mono Cyrillic keeps the mono look identical for Russian; Manrope is
// a clean geometric face for display Cyrillic (Space Grotesk has no Cyrillic).
export const jetbrainsMonoCyr = localFont({
  src: [
    { path: './fonts/JetBrainsMono-Cyrillic-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/JetBrainsMono-Cyrillic-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-jbm-cyr',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});

export const manropeCyr = localFont({
  src: [
    { path: './fonts/Manrope-Cyrillic-Regular.woff2', weight: '400', style: 'normal' },
    { path: './fonts/Manrope-Cyrillic-Medium.woff2', weight: '500', style: 'normal' },
    { path: './fonts/Manrope-Cyrillic-Bold.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-manrope-cyr',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
});
