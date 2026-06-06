/**
 * tour.ts — onboarding tour via driver.js (bundled, zero external requests).
 *
 * Ported faithfully from ex/root.jsx `startTour` (lines 36–57). The ex version
 * read `window.driver.js` (a UMD global loaded from a CDN <script>); here the
 * library is imported and bundled — Tor-ready, no remote anything.
 *
 * CSP note (strict nonce CSP in apps/web/proxy.ts): driver.js v1.4.0 does NOT
 * inject any runtime <style> element. Its visual styling comes entirely from
 * the bundled `driver.css` (imported below) plus our `.sm-tour` skin in
 * components.css. The only inline CSS it emits is `style=""` attributes on the
 * overlay SVG / popover (positioning), which the CSP already permits via
 * `style-src-attr 'unsafe-inline'`. So it works under `style-src 'self'` with
 * no policy change. (Verified live with Playwright — zero CSP violations.)
 */

import { driver, type DriveStep } from 'driver.js';
import 'driver.js/dist/driver.css';
import type { Dict } from '@/app/i18n/dict';

/**
 * Start the product tour for the given locale dictionary.
 *
 * Steps are built from `L.tour.steps` and filtered to elements actually present
 * in the DOM, so targets that may not exist (e.g. `.chip-tor`, which only
 * renders when NEXT_PUBLIC_TOR_URL is set) are skipped gracefully. If no target
 * is present, the tour is a no-op.
 */
export function startTour(L: Dict): void {
  const steps: DriveStep[] = L.tour.steps
    .filter((s) => document.querySelector(s.el))
    .map((s) => ({
      element: s.el,
      popover: {
        title: s.title,
        description: s.desc,
        side: s.side,
        align: s.align ?? 'center',
      },
    }));

  if (!steps.length) return;

  const d = driver({
    showProgress: true,
    overlayColor: 'rgba(10,12,16,0.72)',
    stagePadding: 6,
    stageRadius: 14,
    popoverClass: 'sm-tour',
    nextBtnText: L.tour.next,
    prevBtnText: L.tour.prev,
    doneBtnText: L.tour.done,
    progressText: '{{current}} / {{total}}',
    steps,
  });
  d.drive();
}
