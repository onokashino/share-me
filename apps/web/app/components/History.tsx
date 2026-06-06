'use client';

/**
 * History.tsx — "My links" panel (sender's device only).
 *
 * Ported from ex/app.jsx History (lines 861–940), wired to OUR history.ts
 * service (listHistory / revoke / removeHistory / buildLink) instead of ex's
 * SM.* globals.
 *
 * Differences from ex (intentional):
 *  • Icons use our filled/sw convention, not ex's `fill`.
 *  • The "· <date>" last-opened suffix (ex line 918) is DROPPED — the server
 *    tracks no per-download timestamp, so we only ever show "Opened N×".
 *
 * - role="dialog" aria-modal="true"; backdrop click closes, inner click stops.
 * - Escape closes; body scroll-locked while mounted.
 * - listHistory() runs on open (and after revoke/remove) — items==null = loading.
 */

import { useCallback, useEffect, useState } from 'react';
import { Icons } from '../icons';
import { useI18n } from '../i18n/useI18n';
import { useToast } from '../toast';
import {
  listHistory,
  revoke,
  removeHistory,
  buildLink,
  type HistoryItem,
} from '../lib/history';

interface HistoryProps {
  onClose: () => void;
  onOpen: (id: string, key: string) => void;
}

export function History({ onClose, onOpen }: HistoryProps) {
  const { L } = useI18n();
  const { push } = useToast();
  const [items, setItems] = useState<HistoryItem[] | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(() => {
    listHistory().then(setItems);
  }, []);

  useEffect(() => {
    load();
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
  }, [load, onClose]);

  const copy = (e: HistoryItem) => {
    navigator.clipboard?.writeText(buildLink(e.id, e.key)).catch(() => {});
    setCopiedId(e.id);
    setTimeout(() => setCopiedId(null), 1600);
    push(L.toastCopied, { type: 'success' });
  };

  const doRevoke = async (e: HistoryItem) => {
    await revoke(e.id);
    load();
  };

  const remove = (e: HistoryItem) => {
    removeHistory(e.id);
    load();
  };

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

        <div className="modal-hero" style={{ paddingBottom: 18 }}>
          <div className="modal-badge">
            <Icons.clock />
          </div>
          <h2>{L.histTitle}</h2>
          <p>{L.histSubtitle}</p>
        </div>

        <div className="modal-body">
          {items == null ? (
            <div
              style={{ textAlign: 'center', padding: '30px 0', color: 'var(--text-3)' }}
            >
              …
            </div>
          ) : items.length === 0 ? (
            <div className="hist-empty">
              <Icons.files sw={1.4} />
              <div>{L.histEmpty}</div>
            </div>
          ) : (
            <div className="hist-list">
              {items.map((e) => {
                const active = e.status === 'active';
                return (
                  <div className={'hist-row st-' + e.status} key={e.id}>
                    <div className="hist-ico">
                      {e.kind === 'text' ? (
                        <Icons.hash sw={2} />
                      ) : e.burn ? (
                        <Icons.flame />
                      ) : (
                        <Icons.files />
                      )}
                    </div>
                    <div className="hist-info">
                      <div className="hist-name">
                        {e.kind === 'text'
                          ? L.msgLabel
                          : e.names[0] +
                            (e.fileCount > 1 ? ` +${e.fileCount - 1}` : '')}
                      </div>
                      <div className="hist-sub">
                        <span className={'hist-badge b-' + e.status}>
                          {L.histStatus[e.status]}
                        </span>
                        {e.usePw && (
                          <span className="hist-tag">
                            <Icons.lock /> {L.metaPw}
                          </span>
                        )}
                        {e.burn && (
                          <span className="hist-tag">
                            <Icons.flame /> {L.histBurn}
                          </span>
                        )}
                        <span className="hist-date">
                          {new Date(e.createdAt).toLocaleString(L.locale, {
                            dateStyle: 'short',
                            timeStyle: 'short',
                          })}
                        </span>
                      </div>
                      <div className="hist-opens">
                        {e.downloads > 0 ? (
                          <span className="opened">
                            <Icons.eye /> {L.histOpened(e.downloads)}
                          </span>
                        ) : (
                          <span className="not-opened">{L.histNotOpened}</span>
                        )}
                      </div>
                    </div>
                    <div className="hist-actions">
                      {active && (
                        <button
                          className="icon-btn"
                          title={L.copy}
                          onClick={() => copy(e)}
                        >
                          {copiedId === e.id ? (
                            <Icons.check sw={3} />
                          ) : (
                            <Icons.copy />
                          )}
                        </button>
                      )}
                      {active && (
                        <button
                          className="icon-btn"
                          title={L.openAsReceiver}
                          onClick={() => {
                            onClose();
                            onOpen(e.id, e.key);
                          }}
                        >
                          <Icons.eye />
                        </button>
                      )}
                      {active ? (
                        <button
                          className="icon-btn danger"
                          title={L.revokeNow}
                          onClick={() => doRevoke(e)}
                        >
                          <Icons.trash />
                        </button>
                      ) : (
                        <button
                          className="icon-btn"
                          title={L.histRemove}
                          onClick={() => remove(e)}
                        >
                          <Icons.x />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-foot">
          <button className="btn btn-primary" onClick={onClose}>
            <Icons.check sw={2.4} /> {L.howto.close}
          </button>
        </div>
      </div>
    </div>
  );
}
