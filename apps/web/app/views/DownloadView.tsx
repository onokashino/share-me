'use client';

/**
 * DownloadView.tsx — Receiver state machine (Plan 3c, Task 4).
 *
 * Gate chain (mirrors ex/app.jsx Receiver, lines 512–774):
 *   error → loading → result → time-lock → burn-confirm → meta+password
 *
 * Deliberate model differences from ex (see Plan 3c):
 *  • No client-side brute-force lockout (dropped lockedFor/attempts).
 *    Wrong password → server 401 → pwErrBad, retryable.
 *  • burn ⇔ max_downloads === 1 (no separate burn flag in our API).
 *  • Time-lock from server unlock_at (RFC 3339 string).
 *  • File names/kind come from post-decrypt bundle decode; pre-decrypt
 *    best-effort summary via peekMeta (non-password drops only).
 *  • Session ID is stored in a ref and reused on retry so a resumed
 *    download doesn't burn a second slot.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Icons } from '@/app/icons';
import { useI18n } from '@/app/i18n/useI18n';
import { useToast } from '@/app/toast';
import { Thumb } from '@/app/components/Thumb';
import { PreviewLightbox } from '@/app/components/PreviewLightbox';
import { FormattedText } from '@/app/components/FormattedText';
import { openMeta, peekMeta, openDrop, newSession } from '@/app/lib/drop-service';
import { fmtSize, fmtCountdown } from '@/app/lib/format';
import { isPreviewable, saveFile } from '@/app/lib/preview';
import { downloadZip } from '@/app/lib/zip';

// ─── Types ────────────────────────────────────────────────────────────────────

type MetaResult = Awaited<ReturnType<typeof openMeta>>;
type MetaOk = Exclude<MetaResult, { error: string }>;

interface SummaryInfo {
  kind: 'files' | 'text';
  name: string;
  size: number;
}

interface ResultFile {
  name: string;
  type: string;
  blob: Blob;
}

type DropResult =
  | { kind: 'text'; files: ResultFile[]; text: string }
  | { kind: 'files'; files: ResultFile[]; text?: undefined };

// ─── Props ───────────────────────────────────────────────────────────────────

interface DownloadViewProps {
  id: string;
  rawKey: string | null;
  onSend: () => void;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function DownloadView({ id, rawKey, onSend }: DownloadViewProps) {
  const { L } = useI18n();
  const { push } = useToast();

  // fragment = rawKey (the #k= value, a base64url-encoded master key)
  const fragment = rawKey;

  // ── State ──────────────────────────────────────────────────────────────────
  const [meta, setMeta] = useState<MetaOk | null>(null);
  const [summary, setSummary] = useState<SummaryInfo | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Password gate
  const [pw, setPw] = useState('');
  const [pwErr, setPwErr] = useState('');
  const [showPw, setShowPw] = useState(false);

  // Decrypt progress
  const [busy, setBusy] = useState(false);
  const [dprog, setDprog] = useState(0);

  // Result
  const [result, setResult] = useState<DropResult | null>(null);
  const [txtCopied, setTxtCopied] = useState(false);
  const [zipping, setZipping] = useState(false);

  // Burn confirm gate
  const [confirmed, setConfirmed] = useState(false);

  // Preview lightbox
  const [preview, setPreview] = useState<ResultFile | null>(null);

  // Time-lock ticker
  const [now, setNow] = useState<number>(() => Date.now());

  // Session ID — reused on retry so a resumed download doesn't burn a slot
  const sessionRef = useRef<string | null>(null);

  // ── Load on mount ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    async function load() {
      const m = await openMeta(id);

      if (cancelled) return;

      if ('error' in m) {
        setErr('gone');
        return;
      }

      // Broken link: no key fragment and no server-side password
      if (!fragment && !m.has_password) {
        setErr('nokey');
        return;
      }

      setMeta(m);

      // Best-effort peekMeta for non-password drops
      if (!m.has_password && fragment) {
        peekMeta(id, fragment)
          .then((s) => {
            if (cancelled) return;
            if (!('error' in s) && !('needsPassword' in s)) {
              setSummary(s);
            }
          })
          .catch(() => {
            // best-effort — ignore errors
          });
      }
    }

    load().catch(() => {
      if (!cancelled) setErr('generic');
    });

    return () => {
      cancelled = true;
    };
  }, [id, fragment]);

  // ── Time-lock ticker ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!meta?.unlock_at) return;
    const unlockMs = new Date(meta.unlock_at).getTime();
    if (now >= unlockMs) return;

    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [meta, now]);

  // ── doUnseal ──────────────────────────────────────────────────────────────
  const doUnseal = async () => {
    if (!fragment) {
      setErr('nokey');
      return;
    }

    setBusy(true);
    setPwErr('');
    setDprog(0);

    // Reuse existing session or create one (don't burn a second slot on retry)
    const sessionId = (sessionRef.current ??= newSession());

    try {
      const r = await openDrop({
        id,
        fragment,
        password: meta?.has_password ? pw : undefined,
        sessionId,
        onProgress: setDprog,
      });

      if (r.needsPassword) {
        // Shouldn't reach here (we pass the password), but guard anyway
        setPwErr(L.pwErrNeed);
        return;
      }

      if (r.kind === 'text') {
        const text = r.text ?? new TextDecoder().decode(r.files[0]?.bytes ?? new Uint8Array());
        setResult({ kind: 'text', files: [], text });
      } else {
        const files: ResultFile[] = r.files.map((f) => ({
          name: f.name,
          type: f.type,
          blob: new Blob([f.bytes.buffer as ArrayBuffer], { type: f.type }),
        }));
        setResult({ kind: 'files', files });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : '';

      if (msg === 'unauthorized') {
        if (meta?.has_password) {
          setPwErr(L.pwErrBad);
        } else {
          setErr('badkey');
        }
      } else if (msg === 'gone') {
        setErr('exhausted');
      } else if (msg === 'locked') {
        // Time-lock raced — re-enter the gate by refreshing now
        setNow(Date.now());
      } else {
        setErr('generic');
      }
    } finally {
      setBusy(false);
    }
  };

  // ── Stable callbacks ──────────────────────────────────────────────────────

  const closePreview = useCallback(() => setPreview(null), []);

  const handleSaveFile = useCallback(
    (f: ResultFile) => {
      saveFile(f);
      push(L.toastSaved(f.name), { type: 'success' });
    },
    [push, L],
  );

  // ── Gate chain ────────────────────────────────────────────────────────────

  // 1. Error screen
  if (err) {
    const [title, desc] = (L.err as unknown as Record<string, [string, string]>)[err] ?? [
      'Error',
      'Something went wrong.',
    ];
    return (
      <div className="card fade-in">
        <div className="ready" style={{ textAlign: 'center' }}>
          <div
            className="ready-badge"
            style={{
              background: 'var(--danger)',
              margin: '8px auto 18px',
              color: '#fff',
              boxShadow: 'none',
            }}
          >
            <Icons.x sw={2.4} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{title}</h2>
          <p
            style={{
              color: 'var(--text-2)',
              fontSize: 14,
              margin: '0 auto 22px',
              maxWidth: 340,
            }}
          >
            {desc}
          </p>
          <button className="btn btn-primary" onClick={onSend} style={{ margin: '0 auto' }}>
            <Icons.upload /> {L.sendYourFile}
          </button>
        </div>
      </div>
    );
  }

  // 2. Loading
  if (!meta) {
    return (
      <div className="card fade-in">
        <div className="seal">
          <div className="seal-vault">
            <div className="seal-ring spin" />
            <div className="seal-core">
              <Icons.lock />
            </div>
          </div>
          <h2>{L.openingVault}</h2>
        </div>
      </div>
    );
  }

  // 3. Result
  if (result) {
    if (result.kind === 'text') {
      const copyTxt = () => {
        navigator.clipboard?.writeText(result.text!).catch(() => {});
        setTxtCopied(true);
        push(L.toastCopiedText, { type: 'success' });
        setTimeout(() => setTxtCopied(false), 1800);
      };

      return (
        <div className="card fade-in">
          <div className="ready">
            <div className="ready-head">
              <div className="ready-badge">
                <Icons.shield filled sw={0} />
              </div>
              <div>
                <h2>{L.decryptedTitle}</h2>
                <p>{L.decryptedMsgDesc}</p>
              </div>
            </div>
            <div className="msg-out">
              <div className="msg-out-head">
                <span>
                  <Icons.hash sw={2} /> {L.msgLabel}
                </span>
                <button className="copy-btn" onClick={copyTxt}>
                  {txtCopied ? (
                    <>
                      <Icons.check sw={3} /> {L.copiedText}
                    </>
                  ) : (
                    <>
                      <Icons.copy /> {L.copyText}
                    </>
                  )}
                </button>
              </div>
              <FormattedText text={result.text} />
            </div>
            <div className="trust">
              <Icons.shield filled sw={0} />
              <div>
                <b>{L.doneTitle}</b>
                {L.doneDesc}
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              <button className="btn btn-ghost btn-block" onClick={onSend}>
                <Icons.upload /> {L.sendYourFile}
              </button>
            </div>
          </div>
        </div>
      );
    }

    // Files result
    return (
      <div className="card fade-in">
        <div className="ready">
          <div className="ready-head">
            <div className="ready-badge">
              <Icons.shield filled sw={0} />
            </div>
            <div>
              <h2>{L.decryptedTitle}</h2>
              <p>{L.decryptedDescNo}</p>
            </div>
          </div>
          <div className="file-list" style={{ padding: '0 0 4px' }}>
            {result.files.map((f, i) => (
              <div className="file-row" key={i}>
                <Thumb file={f} />
                <div className="file-info">
                  <div className="file-name">{f.name}</div>
                  <div className="file-size">{fmtSize(f.blob.size)}</div>
                </div>
                <div className="file-row-actions">
                  {isPreviewable(f.type, f.name) && (
                    <button
                      className="icon-btn"
                      title={L.preview}
                      onClick={() => setPreview(f)}
                    >
                      <Icons.eye />
                    </button>
                  )}
                  <button className="copy-btn" onClick={() => handleSaveFile(f)}>
                    <Icons.download /> {L.download}
                  </button>
                </div>
              </div>
            ))}
          </div>
          <div className="trust">
            <Icons.shield filled sw={0} />
            <div>
              <b>{L.doneTitle}</b>
              {L.doneDesc}
            </div>
          </div>
          <div className="recv-bottom-actions">
            {result.files.length > 1 && (
              <button
                className="btn btn-primary btn-block"
                onClick={async () => {
                  setZipping(true);
                  try {
                    await downloadZip(
                      result.files.map((f) => ({ name: f.name, blob: f.blob })),
                    );
                    push(L.toastZipped, { type: 'success' });
                  } catch {
                    push(L.toastZipErr, { type: 'error' });
                  } finally {
                    setZipping(false);
                  }
                }}
                disabled={zipping}
              >
                <Icons.download /> {zipping ? L.zipping : L.downloadAll(result.files.length)}
              </button>
            )}
            <button className="btn btn-ghost btn-block" onClick={onSend}>
              <Icons.upload /> {L.sendYourFile}
            </button>
          </div>
        </div>

        {preview && (
          <PreviewLightbox
            file={preview}
            onClose={closePreview}
            onSave={handleSaveFile}
          />
        )}
      </div>
    );
  }

  // 4. Time-lock gate
  const unlockAtMs = meta.unlock_at ? new Date(meta.unlock_at).getTime() : null;
  if (unlockAtMs !== null && now < unlockAtMs) {
    return (
      <div className="card fade-in">
        <div className="ready" style={{ textAlign: 'center' }}>
          <div className="timelock-ico">
            <Icons.clock sw={1.6} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{L.timelockGateTitle}</h2>
          <p
            style={{
              color: 'var(--text-2)',
              fontSize: 14,
              margin: '0 auto 4px',
              maxWidth: 360,
              lineHeight: 1.55,
            }}
          >
            {L.timelockGateDesc}
          </p>
          <div className="countdown">{fmtCountdown(unlockAtMs - now)}</div>
          <div className="countdown-date">
            {L.timelockOpensAt(new Date(meta.unlock_at!).toLocaleString(L.locale))}
          </div>
          <div className="recv-meta" style={{ maxWidth: 320, margin: '20px auto 0' }}>
            <div className="rl">
              <span>{L.rlExpiry}</span>
              <span>{fmtSize(meta.size_cipher)}</span>
            </div>
            {meta.has_password && (
              <div className="rl">
                <span>{L.recvDescPw}</span>
                <span>
                  <Icons.lock />
                </span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // 5. Burn confirm gate
  if (meta.max_downloads === 1 && !confirmed) {
    return (
      <div className="card fade-in">
        <div className="ready" style={{ textAlign: 'center' }}>
          <div className="burn-warn-ico">
            <Icons.flame sw={1.6} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 22 }}>{L.burnConfirmTitle}</h2>
          <p
            style={{
              color: 'var(--text-2)',
              fontSize: 14,
              margin: '0 auto 6px',
              maxWidth: 360,
              lineHeight: 1.55,
            }}
          >
            {L.burnConfirmDesc}
          </p>
          <div className="recv-meta" style={{ maxWidth: 320, margin: '18px auto 22px' }}>
            {summary ? (
              summary.kind === 'text' ? (
                <div className="rl">
                  <span>{L.rlMsg}</span>
                  <span>{L.msgLabel}</span>
                </div>
              ) : (
                <div className="rl">
                  <span>{L.rlFiles}</span>
                  <span>
                    {summary.name} · {fmtSize(meta.size_cipher)}
                  </span>
                </div>
              )
            ) : (
              <div className="rl">
                <span>{L.rlExpiry}</span>
                <span>{fmtSize(meta.size_cipher)}</span>
              </div>
            )}
            <div className="rl">
              <span>{L.rlOpens}</span>
              <span style={{ color: 'var(--danger)' }}>{L.burnOnce}</span>
            </div>
          </div>
          <button
            className="btn btn-primary btn-block burn-btn"
            onClick={() => setConfirmed(true)}
          >
            <Icons.flame /> {L.burnConfirmBtn}
          </button>
          <button
            className="btn btn-ghost btn-block"
            style={{ marginTop: 10 }}
            onClick={onSend}
          >
            {L.cancel}
          </button>
        </div>
      </div>
    );
  }

  // 6. Meta + password gate (default)
  return (
    <div className="card fade-in">
      <div className="ready">
        <div className="ready-head">
          <div
            className="ready-badge"
            style={{
              background: 'var(--panel-2)',
              color: 'var(--brand)',
              boxShadow: '0 0 0 4px var(--glow)',
            }}
          >
            <Icons.lock />
          </div>
          <div>
            <h2>{L.recvTitle}</h2>
            <p>{meta.has_password ? L.recvDescPw : L.recvDescKey}</p>
          </div>
        </div>

        <div className="recv-meta">
          {/* Content row — kind + name (+ size) from peekMeta if available, else size only */}
          {summary ? (
            summary.kind === 'text' ? (
              <div className="rl">
                <span>{L.rlMsg}</span>
                <span>
                  {L.msgLabel} · {fmtSize(meta.size_cipher)}
                </span>
              </div>
            ) : (
              <div className="rl">
                <span>{L.rlFiles}</span>
                <span>
                  {summary.name} · {fmtSize(meta.size_cipher)}
                </span>
              </div>
            )
          ) : (
            <div className="rl">
              <span>{L.rlFiles}</span>
              <span>{fmtSize(meta.size_cipher)}</span>
            </div>
          )}

          {/* Expiry */}
          <div className="rl">
            <span>{L.rlExpiry}</span>
            <span>
              {meta.expires_at
                ? L.rlExpiryTo(new Date(meta.expires_at).toLocaleDateString(L.locale))
                : L.rlExpiryNever}
            </span>
          </div>

          {/* Downloads */}
          {meta.max_downloads !== null && (
            <div className="rl">
              <span>{L.rlDownloads}</span>
              <span>
                {meta.download_count}/{meta.max_downloads}
              </span>
            </div>
          )}
        </div>

        {/* Burn note */}
        {meta.max_downloads === 1 && (
          <div className="burn-note">
            <Icons.flame /> <span>{L.burnRecvNote}</span>
          </div>
        )}

        {/* Password input */}
        {meta.has_password && (
          <div className="pw-wrap">
            <label>{L.pwEnterLabel}</label>
            <div className="pw-field">
              <input
                className="pw-input"
                type={showPw ? 'text' : 'password'}
                value={pw}
                autoFocus
                onChange={(e) => {
                  setPw(e.target.value);
                  setPwErr('');
                }}
                onKeyDown={(e) => e.key === 'Enter' && doUnseal()}
                placeholder="••••••"
              />
              <button
                className="pw-icon-btn pw-icon-inset"
                type="button"
                onClick={() => setShowPw((v) => !v)}
                title={showPw ? L.pwHide : L.pwShow}
              >
                <Icons.eye />
              </button>
            </div>
            {pwErr && <div className="pw-err">{pwErr}</div>}
          </div>
        )}

        {/* Decrypt button */}
        <button
          className="btn btn-primary btn-block"
          onClick={doUnseal}
          disabled={busy || (meta.has_password && !pw)}
        >
          {busy ? (
            `${L.decrypting} ${Math.round(dprog * 100)}%`
          ) : (
            <>
              <Icons.key /> {L.decryptBtn}
            </>
          )}
        </button>

        {/* Progress bar */}
        {busy && (
          <div className="seal-bar" style={{ marginTop: 12 }}>
            <i style={{ width: dprog * 100 + '%' }} />
          </div>
        )}

        {/* Trust footnote */}
        <div className="trust">
          <Icons.eye />
          <div>{L.recvTrust}</div>
        </div>
      </div>
    </div>
  );
}
