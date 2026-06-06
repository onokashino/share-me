'use client';

/**
 * Thumb.tsx — file-type thumbnail for a decrypted blob.
 *
 * Ported from ex/app.jsx Thumb (lines 42–55).
 *
 * - image  → object-URL <img> inside .file-ico.file-ico-img  (revoked on unmount)
 * - PDF    → .file-ico.file-ico-pdf showing "PDF"
 * - other  → .file-ico showing the uppercase extension (e.g. "DOCX")
 */

import { useEffect, useState } from 'react';
import { extOf } from '../lib/format';
import { isImage, isPdf } from '../lib/preview';

interface ThumbFile {
  name: string;
  type: string;
  blob: Blob;
}

interface ThumbProps {
  file: ThumbFile;
}

export function Thumb({ file }: ThumbProps) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!isImage(file.type)) return;
    const u = URL.createObjectURL(file.blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  if (isImage(file.type) && url) {
    return (
      <div className="file-ico file-ico-img">
        <img src={url} alt="" />
      </div>
    );
  }

  if (isPdf(file.type, file.name)) {
    return <div className="file-ico file-ico-pdf">PDF</div>;
  }

  return <div className="file-ico">{extOf(file.name)}</div>;
}
