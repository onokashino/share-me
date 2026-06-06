'use client';

/**
 * UploadView.tsx — Sender component tree.
 *
 * Reproduces ex/app.jsx Sender (lines 104–507) faithfully as a React 19 TSX
 * client component. Four stages: idle | config | sealing | ready.
 *
 * Props: { onOpenReceiver(id, fragment) }
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useI18n } from '@/app/i18n/useI18n';
import { useToast } from '@/app/toast';
import {
  Lock,
  Shield,
  Upload,
  Download,
  Copy,
  Check,
  X,
  Clock,
  Key,
  Eye,
  Hash,
  Bolt,
  Infinity,
  Files,
  Trash,
  Send,
  Flame,
  Calendar,
} from '@/app/icons';
import { FormattedText } from '@/app/components/FormattedText';
import { DateTimePicker } from '@/app/components/DateTimePicker';
import { QrImage } from '@/app/lib/qrcode';
import { sealFiles, sealText } from '@/app/lib/drop-service';
import { revokeUpload } from '@/app/lib/actions';
import { recordDrop } from '@/app/lib/history';
import {
  fmtSize,
  extOf,
  dtLocal,
  genPassword,
  pwStrength,
} from '@/app/lib/format';

// ─── local helpers ────────────────────────────────────────────────────────────

/** Max characters for the text pane. Larger content should be sent as a file. */
const TEXT_MAX = 10_000;

/** Bold wrapper used by L.dzSub(Bold). */
function Bold({ children }: { children: ReactNode }) {
  return <b>{children}</b>;
}

/** Build the absolute share link from the sealed result. */
function buildLink(id: string, fragment: string): string {
  const base =
    typeof location !== 'undefined'
      ? location.origin + location.pathname
      : '';
  return `${base}?f=${id}#k=${fragment}`;
}

/** Expiry label → approximate future timestamp in ms (for UI meta display). */
function expiryToMs(expiry: '1h' | '1d' | '7d' | '30d'): number {
  const map: Record<string, number> = {
    '1h': 3600e3,
    '1d': 86400e3,
    '7d': 7 * 86400e3,
    '30d': 30 * 86400e3,
  };
  return Date.now() + (map[expiry] ?? 0);
}

// ─── sealed result enriched with local metadata ──────────────────────────────

interface SealedMeta {
  id: string;
  fragment: string;
  link: string;
  fingerprint: string;
  kdf: 'argon2id' | 'pbkdf2' | 'none';
  /** true if a password was used */
  usePw: boolean;
  /** 'text' or 'files' */
  kind: 'text' | 'files';
  /** number of files (1 for text) */
  fileCount: number;
  /** total plaintext size in bytes */
  totalSize: number;
  /** expiry timestamp ms (0 = none) */
  expiresAt: number;
  /** timelock timestamp ms (0 = none) */
  unlockAt: number;
}

// ─── component ───────────────────────────────────────────────────────────────

export interface UploadViewProps {
  onOpenReceiver: (id: string, fragment: string) => void;
}

export function UploadView({ onOpenReceiver }: UploadViewProps) {
  const { L } = useI18n();
  const { push } = useToast();

  // stage machine
  const [stage, setStage] = useState<'idle' | 'config' | 'sealing' | 'ready'>('idle');
  const [mode, setMode] = useState<'files' | 'text'>('files');
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [preview, setPreview] = useState(false);
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Animate the card height when switching Files ↔ Text: the two panes differ in
  // height and the card is centered, so a hard swap makes the whole card jump.
  // The ref callback (re)attaches a ResizeObserver each time the idle card mounts,
  // measuring the active pane's natural height so the wrapper can transition to it.
  const modeRO = useRef<ResizeObserver | null>(null);
  const [modeBodyH, setModeBodyH] = useState<number>();
  const measureMode = useCallback((node: HTMLDivElement | null) => {
    modeRO.current?.disconnect();
    if (node && typeof ResizeObserver !== 'undefined') {
      modeRO.current = new ResizeObserver(() => setModeBodyH(node.offsetHeight));
      modeRO.current.observe(node);
    }
  }, []);

  // options
  const [usePw, setUsePw] = useState(false);
  const [pw, setPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [expiry, setExpiry] = useState<'1h' | '1d' | '7d' | '30d'>('7d');
  const [maxDl, setMaxDl] = useState(0);
  const [burn, setBurn] = useState(false);
  const [timelock, setTimelock] = useState(false);
  const [unlockStr, setUnlockStr] = useState(() => dtLocal(Date.now() + 3600e3));

  // sealing progress
  const [stepIdx, setStepIdx] = useState(0);
  const [progress, setProgress] = useState(0);

  // ready state
  const [sealed, setSealed] = useState<SealedMeta | null>(null);
  const [copied, setCopied] = useState(false);
  const [revoked, setRevoked] = useState(false);
  const [kdfWarn, setKdfWarn] = useState(false);

  // ── file helpers ────────────────────────────────────────────────────────────

  const addFiles = useCallback((list: FileList | File[] | null) => {
    const arr = Array.from(list || []);
    if (!arr.length) return;
    setFiles((prev) => [...prev, ...arr]);
    setStage('config');
  }, []);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDrag(false);
    addFiles(e.dataTransfer.files);
  };

  const removeFile = (i: number) => {
    setFiles((prev) => {
      const next = prev.filter((_, k) => k !== i);
      if (!next.length) setStage('idle');
      return next;
    });
  };

  // paste listener while idle + files mode
  useEffect(() => {
    if (stage !== 'idle' || mode !== 'files') return;
    const onPaste = (e: ClipboardEvent) => {
      const dt = e.clipboardData;
      if (!dt) return;
      let arr: File[] = Array.from(dt.files || []);
      if (!arr.length && dt.items) {
        arr = Array.from(dt.items)
          .filter((it) => it.kind === 'file')
          .map((it) => it.getAsFile())
          .filter((f): f is File => f !== null);
      }
      if (arr.length) {
        e.preventDefault();
        addFiles(arr);
        push(L.toastPasted(arr.length), { type: 'success' });
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [stage, mode, addFiles, L, push]);

  // ── seal ─────────────────────────────────────────────────────────────────────

  const doSeal = () => {
    if (usePw && pw.length < 4) return;
    setStage('sealing');
    setStepIdx(0);
    setProgress(0);

    const t0 = Date.now();
    const MIN = 1400; // min animation duration ms

    let raf: number | undefined;

    // For text mode: animate manually (no real progress events)
    if (mode === 'text') {
      const tick = () => {
        const e = Math.min(1, (Date.now() - t0) / MIN);
        setProgress(e);
        setStepIdx(e < 0.4 ? 0 : e < 0.95 ? 1 : 2);
        if (e < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    const unlockAt = timelock ? new Date(unlockStr).getTime() : 0;
    const opts = {
      password: usePw ? pw : undefined,
      expiry,
      maxDownloads: maxDl,
      burn,
      unlockAt: unlockAt && unlockAt > Date.now() ? unlockAt : undefined,
      onProgress:
        mode === 'text'
          ? (_p: number) => {} // driven by rAF above for text
          : (p: number) => {
              setProgress(p);
              setStepIdx(p < 0.04 ? 0 : p < 0.97 ? 1 : 2);
            },
    };

    const totalSize = files.reduce((s, f) => s + f.size, 0);
    const job =
      mode === 'text'
        ? sealText(text, opts)
        : sealFiles(files, opts);

    job
      .then((res) => {
        const wait = Math.max(0, MIN - (Date.now() - t0));
        setTimeout(() => {
          if (raf !== undefined) cancelAnimationFrame(raf);
          setStepIdx(3);
          setProgress(1);

          const isKdfWarn = res.kdf !== 'none' && res.kdf !== 'argon2id';
          if (isKdfWarn) {
            setKdfWarn(true);
            push(L.kdfFallbackWarn, { type: 'info' });
          }

          // Build the absolute link from current origin
          const link = buildLink(res.id, res.fragment);

          const sealedMeta: SealedMeta = {
            id: res.id,
            fragment: res.fragment,
            link,
            fingerprint: res.fingerprint,
            kdf: res.kdf,
            usePw,
            kind: mode,
            fileCount: mode === 'text' ? 1 : files.length,
            totalSize: mode === 'text' ? new TextEncoder().encode(text).length : totalSize,
            expiresAt: expiryToMs(expiry),
            unlockAt: unlockAt && unlockAt > Date.now() ? unlockAt : 0,
          };

          setSealed(sealedMeta);
          setStage('ready');

          // Record this drop in the device-local "My links" history.
          // `burn` here means single-download: the burn toggle, or a maxDl of 1
          // (both make the server set max_downloads === 1 — see drop-service._seal).
          recordDrop({
            id: res.id,
            key: res.fragment,
            kind: mode,
            names: mode === 'text' ? [] : files.map((f) => f.name),
            fileCount: mode === 'text' ? 0 : files.length,
            burn: burn || maxDl === 1,
            usePw,
          });
        }, wait);
      })
      .catch(() => {
        if (raf !== undefined) cancelAnimationFrame(raf);
        setStage('config');
        push(L.toastSealErr, { type: 'error' });
      });
  };

  // ── reset ─────────────────────────────────────────────────────────────────────

  const reset = () => {
    setFiles([]);
    setText('');
    setStage('idle');
    setSealed(null);
    setUsePw(false);
    setPw('');
    setShowPw(false);
    setExpiry('7d');
    setMaxDl(0);
    setBurn(false);
    setTimelock(false);
    setUnlockStr(dtLocal(Date.now() + 3600e3));
    setCopied(false);
    setRevoked(false);
    setKdfWarn(false);
  };

  // ── ready helpers ────────────────────────────────────────────────────────────

  const link = sealed ? sealed.link : '';

  const copy = () => {
    navigator.clipboard?.writeText(link).catch(() => {});
    setCopied(true);
    push(L.toastCopied, { type: 'success' });
    setTimeout(() => setCopied(false), 1800);
  };

  const share = async () => {
    if (typeof navigator !== 'undefined' && navigator.share) {
      try {
        await navigator.share({ title: 'share·me', text: L.shareText, url: link });
      } catch {
        // user cancelled or share failed — ignore
      }
    } else {
      navigator.clipboard?.writeText(link).catch(() => {});
      push(L.toastShareFallback, { type: 'info' });
    }
  };

  const totalSize = files.reduce((s, f) => s + f.size, 0);

  // ════════════════════════════════════════════════════════════════════════════
  // IDLE
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'idle') {
    return (
      <div className="card fade-in">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden-input"
          onChange={(e) => addFiles(e.target.files)}
        />
        <div className="mode-tabs">
          <button
            className={mode === 'files' ? 'on' : ''}
            onClick={() => setMode('files')}
          >
            <Files /> {L.tabFiles}
          </button>
          <button
            className={mode === 'text' ? 'on' : ''}
            onClick={() => setMode('text')}
          >
            <Hash /> {L.tabText}
          </button>
        </div>

        <div className="mode-body" style={{ height: modeBodyH }}>
          <div ref={measureMode}>
            {mode === 'files' ? (
              <div
                className={'dropzone' + (drag ? ' drag' : '')}
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={onDrop}
                onClick={() => inputRef.current?.click()}
              >
                <div className="dz-inner">
                  <div className="dz-ico"><Upload /></div>
                  <div className="dz-title">{L.dzTitle}</div>
                  <div className="dz-sub">{L.dzSub(Bold)}</div>
                  <div className="dz-paste">{L.dzPaste}</div>
                  <div className="dz-meta">
                    <span><Shield filled sw={0} /> {L.dzMeta1}</span>
                    <span><Key /> {L.dzMeta2}</span>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-pane">
                {preview && text.trim() ? (
                  <div className="text-preview">
                    <FormattedText text={text} />
                  </div>
                ) : (
                  <textarea
                    className="text-area"
                    value={text}
                    autoFocus={!preview}
                    maxLength={TEXT_MAX}
                    placeholder={L.textPlaceholder}
                    onChange={(e) => setText(e.target.value)}
                  />
                )}
                <div className="text-foot">
                  <button
                    className="fmt-toggle-btn"
                    type="button"
                    onClick={() => setPreview((v) => !v)}
                    disabled={!text.trim()}
                    title={preview ? L.editBtn : L.previewBtn}
                  >
                    <Eye sw={2} />
                    {preview ? L.editBtn : L.previewBtn}
                  </button>
                  <span
                    className={
                      'text-count' +
                      ([...text].length >= TEXT_MAX * 0.9 ? ' warn' : '')
                    }
                  >
                    {[...text].length.toLocaleString(L.locale)} /{' '}
                    {TEXT_MAX.toLocaleString(L.locale)}
                  </span>
                  <button
                    className="btn btn-primary"
                    disabled={!text.trim()}
                    onClick={() => setStage('config')}
                  >
                    <Lock /> {L.textContinue}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // CONFIG
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'config') {
    const st = pw.length > 0 ? pwStrength(pw) : null;

    return (
      <div className="card fade-in">
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden-input"
          onChange={(e) => addFiles(e.target.files)}
        />

        <div className="file-list">
          {mode === 'text' ? (
            <div className="file-row">
              <div className="file-ico"><Hash sw={2} /></div>
              <div className="file-info">
                <div className="file-name">{L.msgLabel}</div>
                <div className="file-size">{L.msgChars([...text].length)}</div>
              </div>
              <button
                className="file-x"
                onClick={() => setStage('idle')}
                aria-label="edit"
              >
                <X />
              </button>
            </div>
          ) : (
            <>
              {files.map((f, i) => (
                <div className="file-row" key={i + f.name}>
                  <div className="file-ico">{extOf(f.name)}</div>
                  <div className="file-info">
                    <div className="file-name">{f.name}</div>
                    <div className="file-size">{fmtSize(f.size)}</div>
                  </div>
                  <button
                    className="file-x"
                    onClick={() => removeFile(i)}
                    aria-label="x"
                  >
                    <X />
                  </button>
                </div>
              ))}
              <button
                className="chip"
                style={{ alignSelf: 'flex-start', margin: '4px 0 0 2px' }}
                onClick={() => inputRef.current?.click()}
              >
                <Upload /> {L.addMore}
              </button>
            </>
          )}
        </div>

        <div className="opts">
          {/* Password toggle */}
          <div className="opt-row">
            <div className="opt-ico"><Lock /></div>
            <div className="opt-text">
              <div className="opt-label">{L.pwLabel}</div>
              <div className="opt-desc">{usePw ? L.pwDescOn : L.pwDescOff}</div>
            </div>
            <div className="opt-control">
              <div
                className={'switch' + (usePw ? ' on' : '')}
                onClick={() => setUsePw((v) => !v)}
                role="switch"
                aria-checked={usePw}
              />
            </div>
          </div>

          {usePw && (
            <div className="opt-row pw-row" style={{ paddingTop: 4 }}>
              <div className="opt-ico"><Key /></div>
              <div className="opt-text">
                <div className="pw-field">
                  <input
                    className="tinput"
                    style={{ width: '100%' }}
                    type={showPw ? 'text' : 'password'}
                    value={pw}
                    placeholder={L.pwPlaceholder}
                    onChange={(e) => setPw(e.target.value)}
                  />
                  <button
                    className="pw-icon-btn"
                    type="button"
                    title={showPw ? L.pwHide : L.pwShow}
                    onClick={() => setShowPw((v) => !v)}
                  >
                    <Eye />
                  </button>
                  <button
                    className="pw-icon-btn"
                    type="button"
                    title={L.pwGen}
                    onClick={() => { setPw(genPassword(20)); setShowPw(true); }}
                  >
                    <Bolt />
                  </button>
                </div>

                {pw.length > 0 && st !== null && (
                  <div className="pw-strength">
                    <div className="pw-bars">
                      {([0, 1, 2, 3] as const).map((i) => (
                        <span
                          key={i}
                          className={'pw-bar' + (i < st.score ? ' on s' + st.score : '')}
                        />
                      ))}
                    </div>
                    <span className="pw-strength-label">
                      {pw.length < 4
                        ? L.pwMin
                        : L.pwStrengthLabels[st.score] + ' · ' + st.bits + ' bit'}
                    </span>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Expiry */}
          <div className="opt-row">
            <div className="opt-ico"><Clock /></div>
            <div className="opt-text">
              <div className="opt-label">{L.expiryLabel}</div>
              <div className="opt-desc">{L.expiryDesc}</div>
            </div>
            <div className="opt-control">
              <div className="seg">
                {(['1h', '1d', '7d', '30d'] as const).map((v) => (
                  <button
                    key={v}
                    className={expiry === v ? 'on' : ''}
                    onClick={() => setExpiry(v)}
                  >
                    {v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Download limit */}
          <div className="opt-row">
            <div className="opt-ico"><Download /></div>
            <div className="opt-text">
              <div className="opt-label">{L.maxLabel}</div>
              <div className="opt-desc">
                {burn ? L.maxDescBurn : maxDl ? L.maxDescOn(maxDl) : L.maxDescOff}
              </div>
            </div>
            <div className="opt-control">
              <div className={'seg' + (burn ? ' seg-disabled' : '')}>
                {([1, 5, 10, 0] as const).map((v) => (
                  <button
                    key={v}
                    className={(!burn && maxDl === v) || (burn && v === 1) ? 'on' : ''}
                    disabled={burn}
                    onClick={() => setMaxDl(v)}
                  >
                    {v === 0 ? '∞' : v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Burn after read */}
          <div className="opt-row">
            <div className="opt-ico"><Flame /></div>
            <div className="opt-text">
              <div className="opt-label">{L.burnLabel}</div>
              <div className="opt-desc">{burn ? L.burnDescOn : L.burnDescOff}</div>
            </div>
            <div className="opt-control">
              <div
                className={'switch' + (burn ? ' on' : '')}
                onClick={() => setBurn((v) => !v)}
                role="switch"
                aria-checked={burn}
              />
            </div>
          </div>

          {/* Time-lock */}
          <div className="opt-row">
            <div className="opt-ico"><Clock /></div>
            <div className="opt-text">
              <div className="opt-label">{L.timelockLabel}</div>
              <div className="opt-desc">{timelock ? L.timelockDescOn : L.timelockDescOff}</div>
            </div>
            <div className="opt-control">
              <div
                className={'switch' + (timelock ? ' on' : '')}
                onClick={() => setTimelock((v) => !v)}
                role="switch"
                aria-checked={timelock}
              />
            </div>
          </div>

          {timelock && (
            <div className="opt-row" style={{ paddingTop: 4 }}>
              <div className="opt-ico"><Calendar /></div>
              <div className="opt-text">
                <DateTimePicker
                  value={unlockStr}
                  min={dtLocal(Date.now() + 60e3)}
                  locale={L.locale}
                  onChange={setUnlockStr}
                />
                <div className="opt-desc" style={{ marginTop: 6 }}>
                  {L.timelockHint(new Date(unlockStr).toLocaleString(L.locale))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div style={{ padding: '0 18px 18px' }}>
          <button
            className="btn btn-primary btn-block"
            onClick={doSeal}
            disabled={usePw && pw.length < 4}
          >
            <Shield filled sw={0} /> {L.sealBtn}
          </button>

          <div className="trust">
            <Lock />
            <div>
              <b>
                {mode === 'text'
                  ? L.msgLabel + ' · ' + L.msgChars([...text].length) + '.'
                  : L.trustFiles(files.length, fmtSize(totalSize))}
              </b>
              {L.trustFilesRest}
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // SEALING
  // ════════════════════════════════════════════════════════════════════════════
  if (stage === 'sealing') {
    return (
      <div className="card fade-in">
        <div className="seal">
          <div className="seal-vault">
            <div className="seal-ring spin" />
            <div className="seal-ring spin r2" />
            <div className="seal-core"><Lock /></div>
          </div>
          <h2>{L.sealingTitle}</h2>
          <div className="seal-steps">
            {L.steps.map((s, i) => (
              <div
                key={i}
                className={
                  'seal-step' +
                  (stepIdx > i ? ' done' : stepIdx === i ? ' active' : '')
                }
              >
                <span className="sdot">
                  {stepIdx > i && <Check sw={3} />}
                </span>
                {s}
              </div>
            ))}
          </div>
          <div className="seal-bar">
            <i style={{ width: Math.round(progress * 100) + '%' }} />
          </div>
          <div className="seal-pct">{Math.round(progress * 100)}%</div>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // READY — revoked screen
  // ════════════════════════════════════════════════════════════════════════════
  if (revoked) {
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
            <Trash sw={2} />
          </div>
          <h2 style={{ margin: '0 0 8px', fontSize: 20 }}>{L.revokedTitle}</h2>
          <p
            style={{
              color: 'var(--text-2)',
              fontSize: 14,
              margin: '0 auto 22px',
              maxWidth: 340,
            }}
          >
            {L.revokedDesc}
          </p>
          <button
            className="btn btn-primary"
            onClick={reset}
            style={{ margin: '0 auto' }}
          >
            <Upload /> {L.newFile}
          </button>
        </div>
      </div>
    );
  }

  // ════════════════════════════════════════════════════════════════════════════
  // READY — success screen
  // ════════════════════════════════════════════════════════════════════════════
  if (!sealed) return null;

  return (
    <div className="card fade-in">
      <div className="ready">
        <div className="ready-head">
          <div className="ready-badge"><Check sw={2.6} /></div>
          <div>
            <h2>{L.readyTitle}</h2>
            <p>{sealed.usePw ? L.readyDescPw : L.readyDescKey}</p>
          </div>
        </div>

        {/* Link box */}
        <div className="link-box">
          <div className="link-url">
            {link.split('#')[0]}
            {link.includes('#') && (
              <span className="frag">#{link.split('#')[1]!.slice(0, 10)}…</span>
            )}
          </div>
          <button className="copy-btn" onClick={copy}>
            {copied ? (
              <><Check sw={3} /> {L.copied}</>
            ) : (
              <><Copy /> {L.copy}</>
            )}
          </button>
        </div>

        {/* Share grid */}
        <div className="share-grid">
          <div className="share-meta">
            {/* file/text count */}
            <div className="meta-line">
              <Files />
              {sealed.kind === 'text' ? (
                <><b>1</b> {L.metaMsg}</>
              ) : (
                <><b>{sealed.fileCount}</b> {L.metaFilesUnit(sealed.fileCount)} · {fmtSize(sealed.totalSize)}</>
              )}
            </div>

            {/* key fingerprint */}
            <div className="meta-line">
              <Hash />
              {L.metaKey}{' '}
              <b style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>
                {sealed.fingerprint.slice(0, 11)}
              </b>
            </div>

            {/* expiry */}
            <div className={'meta-line' + (sealed.expiresAt ? ' warn' : '')}>
              <Clock />
              {sealed.expiresAt
                ? L.metaExpires(L.expiresIn(sealed.expiresAt))
                : L.metaExpiresNever}
            </div>

            {/* timelock */}
            {sealed.unlockAt ? (
              <div className="meta-line warn">
                <Clock />
                {L.metaUnlock(new Date(sealed.unlockAt).toLocaleString(L.locale))}
              </div>
            ) : null}

            {/* burn / limit / pw */}
            <div className="meta-line">
              {burn || maxDl ? <Flame /> : <Infinity />}
              {burn
                ? L.metaBurn
                : maxDl
                ? L.metaMaxDl(maxDl)
                : L.metaNoLimit}
              {sealed.usePw && (
                <> · <Lock /> {L.metaPw}</>
              )}
            </div>
          </div>

          {/* QR */}
          <div>
            <QrImage text={link} />
            <div className="qr-cap">{L.qrCap}</div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="ready-actions">
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={share}>
            <Send /> {L.shareBtn}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => onOpenReceiver(sealed.id, sealed.fragment)}
            title={L.openAsReceiver}
          >
            <Eye /> {L.openShort}
          </button>
          <button className="btn btn-ghost" onClick={reset} title={L.newFile}>
            <Upload />
          </button>
        </div>

        {/* Revoke */}
        <button
          className="revoke-link"
          onClick={async () => {
            await revokeUpload(sealed.id);
            setRevoked(true);
          }}
        >
          <Trash /> {L.revokeNow}
        </button>

        {/* Trust footnote */}
        <div className="trust">
          <Shield filled sw={0} />
          <div>
            <b>{L.trustZkTitle}</b>
            {sealed.usePw ? L.trustZkPw : L.trustZkKey}
          </div>
        </div>
      </div>
    </div>
  );
}
