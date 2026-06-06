'use client';

/**
 * DateTimePicker.tsx — themed date + time picker that replaces the native
 * <input type="datetime-local"> for the time-lock. Zero deps.
 *
 * Value format is the local `YYYY-MM-DDTHH:mm` string produced by dtLocal(),
 * so the surrounding seal logic (new Date(unlockStr)) keeps working unchanged.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Icons } from '@/app/icons';

interface Props {
  /** local `YYYY-MM-DDTHH:mm` */
  value: string;
  /** earliest selectable, same format */
  min?: string;
  /** BCP-47 locale for month / weekday names */
  locale: string;
  onChange: (value: string) => void;
}

const pad = (n: number) => String(n).padStart(2, '0');

function fmt(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

function parse(s: string): Date {
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? new Date() : d;
}

/** Integer key for a calendar day, ignoring the time-of-day. */
const dayKey = (d: Date) => d.getFullYear() * 10000 + d.getMonth() * 100 + d.getDate();

export function DateTimePicker({ value, min, locale, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const sel = useMemo(() => parse(value), [value]);
  const minDate = useMemo(() => (min ? parse(min) : null), [min]);
  const [view, setView] = useState(() => new Date(sel.getFullYear(), sel.getMonth(), 1));

  // Follow the selected month when the value jumps (e.g. a reset).
  const selY = sel.getFullYear();
  const selM = sel.getMonth();
  useEffect(() => {
    setView(new Date(selY, selM, 1));
  }, [selY, selM]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Monday-first short weekday names in the active locale.
  const weekdays = useMemo(() => {
    const monday = new Date(2024, 0, 1); // a Monday
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toLocaleDateString(locale, { weekday: 'short' });
    });
  }, [locale]);

  // 6 × 7 grid of days covering the view month (Monday-first).
  const days = useMemo(() => {
    const first = new Date(view.getFullYear(), view.getMonth(), 1);
    const offset = (first.getDay() + 6) % 7;
    const start = new Date(first);
    start.setDate(1 - offset);
    return Array.from({ length: 42 }, (_, i) => {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      return d;
    });
  }, [view]);

  const minKey = minDate ? dayKey(minDate) : -Infinity;
  const selKey = dayKey(sel);
  const todayKey = dayKey(new Date());

  const pickDay = (d: Date) => {
    const next = new Date(sel);
    next.setFullYear(d.getFullYear(), d.getMonth(), d.getDate());
    if (minDate && next.getTime() < minDate.getTime()) next.setTime(minDate.getTime());
    onChange(fmt(next));
  };

  const stepTime = (unit: 'h' | 'm', delta: number) => {
    const next = new Date(sel);
    if (unit === 'h') next.setHours(next.getHours() + delta);
    else next.setMinutes(next.getMinutes() + delta);
    if (minDate && next.getTime() < minDate.getTime()) return;
    onChange(fmt(next));
  };

  const monthLabel = view.toLocaleDateString(locale, { month: 'long', year: 'numeric' });
  const triggerLabel = sel.toLocaleString(locale, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <div className="dtp" ref={root}>
      <button
        type="button"
        className="tinput dtp-trigger"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
      >
        <span>{triggerLabel}</span>
        <Icons.calendar />
      </button>

      {open && (
        <div className="dtp-pop" role="dialog">
          <div className="dtp-cal">
            <div className="dtp-head">
              <button
                type="button"
                className="dtp-nav"
                aria-label="Previous month"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() - 1, 1))}
              >
                <Icons.chevronLeft />
              </button>
              <span className="dtp-month">{monthLabel}</span>
              <button
                type="button"
                className="dtp-nav"
                aria-label="Next month"
                onClick={() => setView((v) => new Date(v.getFullYear(), v.getMonth() + 1, 1))}
              >
                <Icons.chevronRight />
              </button>
            </div>

            <div className="dtp-week">
              {weekdays.map((w, i) => (
                <span key={i}>{w}</span>
              ))}
            </div>

            <div className="dtp-grid">
              {days.map((d, i) => {
                const k = dayKey(d);
                const cls =
                  'dtp-day' +
                  (d.getMonth() === view.getMonth() ? '' : ' out') +
                  (k === selKey ? ' sel' : '') +
                  (k === todayKey ? ' today' : '');
                return (
                  <button
                    key={i}
                    type="button"
                    className={cls}
                    disabled={k < minKey}
                    onClick={() => pickDay(d)}
                  >
                    {d.getDate()}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="dtp-side">
            <Icons.clock />
            <div className="dtp-time">
              <div className="dtp-stepper">
                <button type="button" aria-label="Hour up" onClick={() => stepTime('h', 1)}>
                  <Icons.chevronUp />
                </button>
                <span>{pad(sel.getHours())}</span>
                <button type="button" aria-label="Hour down" onClick={() => stepTime('h', -1)}>
                  <Icons.chevronDown />
                </button>
              </div>
              <span className="dtp-colon">:</span>
              <div className="dtp-stepper">
                <button type="button" aria-label="Minute up" onClick={() => stepTime('m', 5)}>
                  <Icons.chevronUp />
                </button>
                <span>{pad(sel.getMinutes())}</span>
                <button type="button" aria-label="Minute down" onClick={() => stepTime('m', -5)}>
                  <Icons.chevronDown />
                </button>
              </div>
            </div>
            <button type="button" className="dtp-done" onClick={() => setOpen(false)}>
              OK
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
