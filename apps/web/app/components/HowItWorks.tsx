'use client';

/**
 * HowItWorks.tsx — "How share·me works" modal.
 *
 * Ported faithfully from ex/app.jsx HowItWorks (lines 782–854).
 *
 * - role="dialog" aria-modal="true"; backdrop click closes, inner click stops.
 * - Escape closes; body scroll-locked while mounted (restored on cleanup).
 * - Step / case icons come from our Icons namespace (filled/sw convention,
 *   NOT ex's `fill` attribute).
 * - "Replay tour" ghost button renders ONLY when `onReplayTour` is provided
 *   (the tour is wired in Plan 3d Unit 4); otherwise an empty <span/> keeps the
 *   footer's space-between layout intact.
 * - All copy comes from L.howto (= H) and L.tour.replay.
 */

import { useEffect } from 'react';
import { Icons } from '../icons';
import { useI18n } from '../i18n/useI18n';

interface HowItWorksProps {
  onClose: () => void;
  onReplayTour?: () => void;
}

export function HowItWorks({ onClose, onReplayTour }: HowItWorksProps) {
  const { L } = useI18n();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const sbw = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (sbw > 0) {
      document.body.style.paddingRight = `${sbw}px`;
    }
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [onClose]);

  const H = L.howto;
  const stepIcons = [Icons.upload, Icons.key, Icons.send, Icons.flame];
  const caseIcons = [Icons.lock, Icons.files, Icons.hash, Icons.bolt];

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <button className="modal-x" onClick={onClose} aria-label="close">
          <Icons.x sw={2} />
        </button>

        <div className="modal-hero">
          <div className="modal-badge">
            <Icons.shield filled sw={0} />
          </div>
          <h2>{H.title}</h2>
          <p>{H.subtitle}</p>
        </div>

        <div className="modal-body">
          <div className="modal-section-label">{H.stepsTitle}</div>
          <ol className="howto-steps">
            {H.steps.map((s, i) => {
              const Ic = stepIcons[i] || Icons.check;
              return (
                <li className="howto-step" key={i}>
                  <span className="howto-num">{i + 1}</span>
                  <span className="howto-step-ico">
                    <Ic />
                  </span>
                  <div>
                    <div className="howto-step-t">{s.t}</div>
                    <div className="howto-step-d">{s.d}</div>
                  </div>
                </li>
              );
            })}
          </ol>

          <div className="modal-section-label">{H.factsTitle}</div>
          <ul className="howto-facts">
            {H.facts.map((f, i) => (
              <li key={i}>
                <span className="fact-tick">
                  <Icons.check sw={3} />
                </span>
                {f}
              </li>
            ))}
          </ul>

          <div className="modal-section-label">{H.casesTitle}</div>
          <div className="howto-cases">
            {H.cases.map((c, i) => {
              const Ic = caseIcons[i] || Icons.lock;
              return (
                <div className="howto-case" key={i}>
                  <span className="howto-case-ico">
                    <Ic />
                  </span>
                  <div className="howto-case-t">{c.t}</div>
                  <div className="howto-case-d">{c.d}</div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="modal-foot" style={{ justifyContent: 'space-between' }}>
          {onReplayTour ? (
            <button className="btn btn-ghost" onClick={onReplayTour}>
              <Icons.bolt /> {L.tour.replay}
            </button>
          ) : (
            <span />
          )}
          <button className="btn btn-primary" onClick={onClose}>
            <Icons.check sw={2.4} /> {H.close}
          </button>
        </div>
      </div>
    </div>
  );
}
