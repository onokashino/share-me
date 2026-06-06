'use client';

/**
 * AppShell.tsx — root client shell: providers, routing, topbar, hero, footer.
 *
 * Routing strategy (mirrors ex/root.jsx):
 *  - Route state { f, k } lives in React local state (not useSearchParams).
 *  - On mount (useEffect only — never during render), read ?f from
 *    location.search and #k= from location.hash. This avoids any
 *    window/location access during SSR, preventing React 19 hydration errors.
 *  - popstate listener keeps state in sync for browser back/forward.
 *  - goReceiver(id, key) → history.pushState + setRoute.
 *  - goSender()         → history.pushState + setRoute.
 *  - The initial SSR render always shows the sender shell (no route yet);
 *    after hydration the useEffect resolves the route. This is intentional:
 *    ?f links are not deep-linked from SSR (the #k hash is never server-
 *    visible anyway), and the sender shell loads instantly.
 *  - page.tsx wraps this in <Suspense> — harmless with local-state routing.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { I18nProvider, useI18n, type Lang } from '@/app/i18n/useI18n';
import { ToastProvider } from '@/app/toast';
import { Shield, Icons } from '@/app/icons';
import { en } from '@/app/i18n/en';
import { ru } from '@/app/i18n/ru';
import { zh } from '@/app/i18n/zh';
import { UploadView } from '@/app/views/UploadView';
import { DownloadView } from '@/app/views/DownloadView';
import { HowItWorks } from '@/app/components/HowItWorks';
import { History } from '@/app/components/History';
import { DonateModal } from '@/app/components/DonateModal';
import { startTour } from '@/app/lib/tour';

/** Tor .onion mirror — env-gated, groundwork only (Tor support deferred). */
const TOR_URL = process.env.NEXT_PUBLIC_TOR_URL;

/** Source repository (AGPL §13). Forks can override via NEXT_PUBLIC_SOURCE_URL.
 *  `||` (not `??`) so an empty build-arg falls back to the canonical default. */
const SOURCE_URL =
  process.env.NEXT_PUBLIC_SOURCE_URL || 'https://github.com/onokashino/share-me';

/** Language segment options, label sourced from each dict's `label`. */
const LANGS: { code: Lang; label: string }[] = [
  { code: 'en', label: en.label },
  { code: 'ru', label: ru.label },
  { code: 'zh', label: zh.label },
];

// ─── Route helpers ────────────────────────────────────────────────────────────

interface Route {
  f: string | null;
  k: string | null;
}

function readRoute(): Route {
  const params = new URLSearchParams(location.search);
  const f = params.get('f');
  let k: string | null = null;
  if (location.hash) {
    const hp = new URLSearchParams(location.hash.slice(1));
    k = hp.get('k');
  }
  return { f, k };
}

// ─── Inner shell (uses i18n + toast from context above) ───────────────────────

function Shell() {
  const { L, lang, setLang } = useI18n();
  // Always-current L for deferred callbacks: the first-visit tour fires 900ms
  // after mount, by which point the provider has hydrated the detected/persisted
  // language — capturing L in the run-once effect would tour in the pre-hydration
  // default (ru) for a first-time en/zh visitor.
  const LRef = useRef(L);
  LRef.current = L;
  const [route, setRoute] = useState<Route>({ f: null, k: null });
  const [howto, setHowto] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [donate, setDonate] = useState(false);

  // Resolve route after mount (client-only — never during SSR render)
  useEffect(() => {
    setRoute(readRoute());

    function onPopState() {
      setRoute(readRoute());
    }
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  // First-visit onboarding tour (sender home only). The `route` state resolves
  // after mount (starts null), so we read the URL directly here instead of
  // `isReceiver`: a non-null ?f means a receiver link → skip the tour. The 900ms
  // delay lets UploadView render the .mode-tabs / .dropzone targets first.
  // Effects run client-side only, so localStorage/location are safe.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('f')) return;
    if (localStorage.getItem('sm_tour_seen')) return;
    const t = setTimeout(() => {
      startTour(LRef.current);
      localStorage.setItem('sm_tour_seen', '1');
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goReceiver = useCallback((id: string, key: string) => {
    const url = '?f=' + id + (key ? '#k=' + key : '');
    history.pushState({}, '', url);
    setRoute({ f: id, k: key });
  }, []);

  const goSender = useCallback(() => {
    history.pushState({}, '', location.pathname);
    setRoute({ f: null, k: null });
  }, []);

  const isReceiver = !!route.f;

  return (
    <div className="app">
      <header className="topbar">
        <div
          className="brand"
          onClick={goSender}
          style={{ cursor: 'pointer' }}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              goSender();
            }
          }}
          aria-label="share·me — go to sender"
        >
          <span className="mark">
            <Shield filled sw={0} aria-hidden="true" />
          </span>
          <span>
            share<b>·</b>me
          </span>
        </div>
        <nav className="topnav">
          <span
            className="chip"
            onClick={() => setHowto(true)}
            style={{ cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                setHowto(true);
              }
            }}
            aria-label={L.badge}
          >
            <span className="dot" /> {L.badge}
          </span>
          {TOR_URL && (
            <a
              className="chip chip-tor"
              href={TOR_URL}
              target="_blank"
              rel="noopener noreferrer"
              title={L.torTitle}
            >
              <Icons.globe /> <span className="tor-label">{L.torLabel}</span>
            </a>
          )}
          <button
            className="chip chip-icon"
            onClick={() => setHistOpen(true)}
            title={L.histTitle}
            aria-label={L.histTitle}
          >
            <Icons.clock />
          </button>
          <a
            className="chip chip-icon"
            href={SOURCE_URL}
            target="_blank"
            rel="noopener noreferrer"
            title="Source on GitHub"
            aria-label="Source on GitHub"
          >
            <Icons.github />
          </a>
          <div className="lang-seg" role="group" aria-label="Language">
            {LANGS.map(({ code, label }) => (
              <button
                key={code}
                className={lang === code ? 'on' : ''}
                onClick={() => setLang(code)}
                title={code}
              >
                {label}
              </button>
            ))}
          </div>
        </nav>
      </header>

      <main className="stage">
        {!isReceiver && (
          <div className="headline fade-in" key={lang}>
            <span className="eyebrow">
              <span className="pulse" aria-hidden="true" />
              {L.eyebrow}
            </span>
            <h1>
              {L.h1a}
              <br />
              <span className="accent">{L.h1b}</span>
            </h1>
            <p>{L.sub}</p>
          </div>
        )}

        {isReceiver ? (
          <DownloadView id={route.f!} rawKey={route.k} onSend={goSender} />
        ) : (
          <UploadView onOpenReceiver={goReceiver} />
        )}
      </main>

      <footer className="footer">
        {L.footer}{' '}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setHowto(true);
          }}
        >
          {L.footerLink}
        </a>
        {' · '}
        <a
          className="footer-donate"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setDonate(true);
          }}
        >
          {L.donateLink}
        </a>
      </footer>

      {howto && (
        <HowItWorks
          onClose={() => setHowto(false)}
          onReplayTour={() => {
            setHowto(false);
            setTimeout(() => startTour(L), 350);
          }}
        />
      )}
      {histOpen && (
        <History onClose={() => setHistOpen(false)} onOpen={goReceiver} />
      )}
      {donate && <DonateModal onClose={() => setDonate(false)} />}
    </div>
  );
}

// ─── AppShell: wraps providers around Shell ───────────────────────────────────

export function AppShell({ initialLang }: { initialLang: Lang }) {
  return (
    <I18nProvider initialLang={initialLang}>
      <ToastProvider>
        <Shell />
      </ToastProvider>
    </I18nProvider>
  );
}
