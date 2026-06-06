'use client';

/**
 * PreviewLightbox.tsx — fullscreen preview for image / PDF blobs.
 *
 * Ported from ex/app.jsx PreviewLightbox (lines 58–84).
 *
 * - Mounts with body overflow = 'hidden'; restores on unmount.
 * - Escape key closes.
 * - Clicking the backdrop closes; clicking the bar / image / iframe does not.
 * - Object URL is created on mount and revoked on unmount.
 */

import { useEffect, useState } from 'react';
import { Icons } from '../icons';
import { useI18n } from '../i18n/useI18n';
import { isImage } from '../lib/preview';

interface LightboxFile {
  name: string;
  type: string;
  blob: Blob;
}

interface PreviewLightboxProps {
  file: LightboxFile;
  onClose: () => void;
  onSave: (file: LightboxFile) => void;
}

export function PreviewLightbox({ file, onClose, onSave }: PreviewLightboxProps) {
  const { L } = useI18n();
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    const u = URL.createObjectURL(file.blob);
    setUrl(u);

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
      URL.revokeObjectURL(u);
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
      document.body.style.paddingRight = '';
    };
  }, [file, onClose]);

  return (
    <div className="lb-backdrop" onClick={onClose}>
      {/* Bar — clicks here don't close the backdrop */}
      <div className="lb-bar" onClick={(e) => e.stopPropagation()}>
        <span className="lb-name">{file.name}</span>
        <div className="lb-actions">
          <button className="copy-btn" onClick={() => onSave(file)}>
            <Icons.download />
            {L.download}
          </button>
          <button
            className="modal-x"
            onClick={onClose}
            aria-label="close"
            style={{ position: 'static' }}
          >
            <Icons.x sw={2} />
          </button>
        </div>
      </div>

      {/* Stage — clicking the stage closes; clicking the content does not */}
      <div className="lb-stage" onClick={onClose}>
        {url && (
          isImage(file.type)
            ? (
              <img
                className="lb-img"
                src={url}
                alt={file.name}
                onClick={(e) => e.stopPropagation()}
              />
            )
            : (
              <iframe
                className="lb-frame"
                src={url}
                title={file.name}
                onClick={(e) => e.stopPropagation()}
              />
            )
        )}
      </div>
    </div>
  );
}
