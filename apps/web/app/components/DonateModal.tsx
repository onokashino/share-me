'use client';

/**
 * DonateModal.tsx — "Support share·me": crypto tip addresses, each with a copy
 * button and a QR generated locally in the browser (QrImage). No third-party
 * requests, so the app stays zero-external-request / Tor-friendly.
 */

import { useEffect } from 'react';
import { useI18n } from '@/app/i18n/useI18n';
import { useToast } from '@/app/toast';
import { Icons } from '@/app/icons';
import { QrImage } from '@/app/lib/qrcode';

const COINS: { name: string; tag: string; addr: string }[] = [
  { name: 'Bitcoin', tag: 'BTC', addr: 'bc1qd3js4ay2zgu8hr4e043w8639qpvkagm6pxwvfm' },
  { name: 'Ethereum', tag: 'ETH · BSC (EVM)', addr: '0x7539f90b93d0a11923A704ECF6395BD16dEF9664' },
  { name: 'Tron', tag: 'TRX', addr: 'TKDoDgpwdrQCrZ9sFuKCbJSQiWu89jv4hR' },
  { name: 'Solana', tag: 'SOL', addr: '6btvbP2gniCyAaMeNMcqxK4Td6ovsEBAMo52RVtH3Wv9' },
];

export function DonateModal({ onClose }: { onClose: () => void }) {
  const { L } = useI18n();
  const { push } = useToast();

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

  const copy = (addr: string) => {
    navigator.clipboard?.writeText(addr).catch(() => {});
    push(L.donate.copied, { type: 'success' });
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <button className="modal-x" onClick={onClose} aria-label="close">
          <Icons.x sw={2} />
        </button>

        <div className="modal-hero">
          <div className="modal-badge"><Icons.bolt /></div>
          <h2>{L.donate.title}</h2>
          <p>{L.donate.subtitle}</p>
        </div>

        <div className="modal-body">
          <div className="donate-list">
            {COINS.map((c) => (
              <div className="donate-row" key={c.addr + c.tag}>
                <div className="donate-qr">
                  <QrImage text={c.addr} />
                </div>
                <div className="donate-info">
                  <div className="donate-coin">
                    {c.name} <span>{c.tag}</span>
                  </div>
                  <code className="donate-addr">{c.addr}</code>
                  <button
                    className="btn btn-ghost donate-copy"
                    onClick={() => copy(c.addr)}
                  >
                    <Icons.copy /> {L.donate.copy}
                  </button>
                </div>
              </div>
            ))}
          </div>
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
