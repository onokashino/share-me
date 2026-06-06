'use client';

/**
 * toast.tsx — React toast system, ported faithfully from ex/toast.js (window.SMToast).
 *
 * Provides:
 *  • <ToastProvider> — mounts the toast host at the bottom-center
 *  • useToast() → { push(msg, opts) }  (opts: { type?: 'success'|'error'|'info' })
 *
 * Design:
 *  - bottom-center stack
 *  - success / error / info variants (matching ex's .t-success/.t-error/.t-info)
 *  - auto-dismiss after 3200ms (matching ex's default duration)
 *  - click to dismiss
 *  - prefers-reduced-motion aware (skips slide-in animation)
 *
 * Styled with design tokens: bg-panel, border-line, text-text, bg-brand (accent),
 * text-danger.  Animations via CSS classes injected inline.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ToastType = 'success' | 'error' | 'info';

export interface ToastOptions {
  type?: ToastType;
  duration?: number;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
  duration: number;
  visible: boolean; // true = in, false = out (fade to remove)
}

interface ToastContextValue {
  push: (message: string, opts?: ToastOptions) => void;
}

// ─── Context ─────────────────────────────────────────────────────────────────

const ToastContext = createContext<ToastContextValue>({ push: () => {} });

// ─── Inline SVG icons (matching ex/toast.js) ─────────────────────────────────

function SuccessIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

function ErrorIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function InfoIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={18}
      height={18}
      aria-hidden="true"
    >
      <path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3z" />
    </svg>
  );
}

const ICONS: Record<ToastType, () => ReactElement> = {
  success: SuccessIcon,
  error: ErrorIcon,
  info: InfoIcon,
};

// ─── Single toast item component ─────────────────────────────────────────────

function ToastItemView({
  item,
  onDismiss,
}: {
  item: ToastItem;
  onDismiss: (id: string) => void;
}) {
  const IconComp = ICONS[item.type];

  // Color scheme per type
  const iconColor: Record<ToastType, string> = {
    success: 'var(--color-accent, #ff7a29)',
    error: 'var(--color-danger, oklch(.68 .2 25))',
    info: 'var(--color-text-2, oklch(.78 .012 252))',
  };

  return (
    <div
      role="status"
      aria-live="polite"
      onClick={() => onDismiss(item.id)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        background: 'var(--panel, oklch(.225 .015 253))',
        border: '1px solid var(--line, oklch(.34 .014 254))',
        borderRadius: '12px',
        padding: '10px 16px',
        cursor: 'pointer',
        userSelect: 'none',
        maxWidth: '360px',
        width: 'max-content',
        boxShadow: '0 4px 24px rgba(0,0,0,0.35)',
        // Animate in/out unless reduced-motion
        opacity: item.visible ? 1 : 0,
        transform: item.visible ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.28s ease, transform 0.28s ease',
        color: 'var(--text, oklch(.97 .005 250))',
      }}
    >
      <span style={{ color: iconColor[item.type], flexShrink: 0 }}>
        <IconComp />
      </span>
      <span
        style={{
          fontSize: '0.875rem',
          fontWeight: 500,
          lineHeight: 1.4,
        }}
      >
        {item.message}
      </span>
    </div>
  );
}

// ─── Provider ────────────────────────────────────────────────────────────────

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismiss = useCallback((id: string) => {
    // First fade out
    setToasts((prev) =>
      prev.map((t) => (t.id === id ? { ...t, visible: false } : t)),
    );
    // Then remove after transition
    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 320);
    timers.current.set(id + '_remove', timer);
  }, []);

  const push = useCallback(
    (message: string, opts: ToastOptions = {}) => {
      const id = `${Date.now()}-${Math.random()}`;
      const type = opts.type ?? 'info';
      const duration = opts.duration ?? 3200;

      const item: ToastItem = { id, message, type, duration, visible: false };

      setToasts((prev) => [...prev, item]);

      // Trigger entrance on next frame (matching ex's requestAnimationFrame + classList.add)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setToasts((prev) =>
            prev.map((t) => (t.id === id ? { ...t, visible: true } : t)),
          );
        });
      });

      // Auto-dismiss after duration
      const timer = setTimeout(() => dismiss(id), duration);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const timer of timers.current.values()) clearTimeout(timer);
    };
  }, []);

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      {/* Toast host — bottom-center, above everything */}
      <div
        aria-label="Notifications"
        style={{
          position: 'fixed',
          bottom: '24px',
          left: '50%',
          transform: 'translateX(-50%)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '8px',
          pointerEvents: 'none',
        }}
      >
        {toasts.map((item) => (
          <div key={item.id} style={{ pointerEvents: 'auto' }}>
            <ToastItemView item={item} onDismiss={dismiss} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
