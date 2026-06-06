/**
 * dict.ts — Shared type interface for the i18n dictionary.
 * All three locale modules (en, ru, zh) must implement this interface.
 *
 * Ported faithfully from ex/i18n.jsx (window.SMI18N).
 * String-only keys are `string`; dynamic keys are function types.
 * JSX-returning functions use `(B: (p: { children: React.ReactNode }) => React.ReactNode) => React.ReactNode`.
 */

import type { ReactNode } from 'react';

type BoldComp = (props: { children: ReactNode }) => ReactNode;

export interface TourStep {
  el: string;
  title: string;
  desc: string;
  side: 'top' | 'bottom' | 'left' | 'right';
  align?: 'start' | 'end';
}

export interface HowtoStep {
  t: string;
  d: string;
}

export interface HowtoCase {
  t: string;
  d: string;
}

export interface HistStatus {
  active: string;
  expired: string;
  exhausted: string;
  revoked: string;
  gone: string;
}

export interface ErrStrings {
  notfound: [string, string];
  expired: [string, string];
  exhausted: [string, string];
  nokey: [string, string];
  badkey: [string, string];
  gone: [string, string];
  generic: [string, string];
}

export interface Tour {
  next: string;
  prev: string;
  done: string;
  replay: string;
  steps: TourStep[];
}

export interface Howto {
  title: string;
  subtitle: string;
  stepsTitle: string;
  steps: HowtoStep[];
  factsTitle: string;
  facts: string[];
  casesTitle: string;
  cases: HowtoCase[];
  close: string;
}

export interface Donate {
  title: string;
  subtitle: string;
  copy: string;
  copied: string;
}

export interface Dict {
  code: string;
  label: string;
  locale: string;

  badge: string;
  tabFiles: string;
  tabText: string;
  textPlaceholder: string;
  textContinue: string;
  msgLabel: string;
  msgChars: (n: number) => string;
  metaMsg: string;
  decryptedMsgDesc: string;
  copyText: string;
  copiedText: string;
  badge2: string;
  torLabel: string;
  torTitle: string;
  pwShow: string;
  pwHide: string;
  pwGen: string;
  pwStrengthLabels: [string, string, string, string, string];
  maxDescBurn: string;
  burnLabel: string;
  burnDescOn: string;
  burnDescOff: string;
  metaBurn: string;
  revokeNow: string;
  revokedTitle: string;
  revokedDesc: string;
  pwErrLeft: (n: number) => string;
  lockedMsg: (s: number) => string;
  lockedBtn: (s: number) => string;
  burnConfirmTitle: string;
  burnConfirmDesc: string;
  burnConfirmBtn: string;
  burnOnce: string;
  rlOpens: string;
  cancel: string;
  burnRecvNote: string;
  timelockLabel: string;
  timelockDescOff: string;
  timelockDescOn: string;
  timelockHint: (d: string) => string;
  metaUnlock: (d: string) => string;
  timelockGateTitle: string;
  timelockGateDesc: string;
  timelockOpensAt: (d: string) => string;
  preview: string;
  histTitle: string;
  histSubtitle: string;
  histEmpty: string;
  histBurn: string;
  histRemove: string;
  histStatus: HistStatus;
  histOpened: (n: number) => string;
  histNotOpened: string;
  toastCopied: string;
  toastCopiedText: string;
  toastPasted: (n: number) => string;
  toastSealErr: string;
  toastSaved: (name: string) => string;
  toastZipped: string;
  toastZipErr: string;
  toastShareFallback: string;
  shareText: string;
  shareBtn: string;
  openShort: string;
  dzPaste: string;
  downloadAll: (n: number) => string;
  zipping: string;
  tour: Tour;
  howto: Howto;
  eyebrow: string;
  h1a: string;
  h1b: string;
  sub: string;
  footer: string;
  footerLink: string;
  donateLink: string;
  sourceLink: string;
  donate: Donate;
  dzTitle: string;
  dzSub: (B: BoldComp) => ReactNode;
  dzMeta1: string;
  dzMeta2: string;
  addMore: string;
  pwLabel: string;
  pwDescOn: string;
  pwDescOff: string;
  pwPlaceholder: string;
  pwMin: string;
  expiryLabel: string;
  expiryDesc: string;
  maxLabel: string;
  maxDescOn: (n: number) => string;
  maxDescOff: string;
  sealBtn: string;
  trustFiles: (n: number, sz: string) => string;
  trustFilesRest: string;
  sealingTitle: string;
  steps: [string, string, string];
  readyTitle: string;
  readyDescPw: string;
  readyDescKey: string;
  copy: string;
  copied: string;
  metaFilesUnit: (n: number) => string;
  metaKey: string;
  metaExpiresNever: string;
  metaExpires: (t: string) => string;
  metaNoLimit: string;
  metaMaxDl: (n: number) => string;
  metaPw: string;
  qrCap: string;
  openAsReceiver: string;
  newFile: string;
  trustZkTitle: string;
  trustZkPw: string;
  trustZkKey: string;
  err: ErrStrings;
  sendYourFile: string;
  openingVault: string;
  decryptedTitle: string;
  decryptedDescRem: (n: number) => string;
  decryptedDescNo: string;
  download: string;
  doneTitle: string;
  doneDesc: string;
  recvTitle: string;
  recvDescPw: string;
  recvDescKey: string;
  rlFiles: string;
  rlMsg: string;
  rlNames: string;
  rlExpiry: string;
  rlExpiryTo: (d: string) => string;
  rlExpiryNever: string;
  rlDownloads: string;
  pwEnterLabel: string;
  pwErrBad: string;
  pwErrNeed: string;
  decryptBtn: string;
  decrypting: string;
  recvTrust: string;
  expiresIn: (ms: number) => string;
  /** Shown when sealing fell back to PBKDF2 instead of Argon2id WASM. */
  kdfFallbackWarn: string;
  /** Text format viewer: show raw bytes */
  fmtRaw: string;
  /** Text format viewer: show formatted render */
  fmtRich: string;
  /** Reveal masked secret value */
  reveal: string;
  /** Hide revealed secret value */
  hide: string;
  /** Preview formatted text (sender toggle) */
  previewBtn: string;
  /** Edit raw text (sender toggle) */
  editBtn: string;
}
