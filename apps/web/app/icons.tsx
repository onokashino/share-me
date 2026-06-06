/**
 * icons.tsx — Shared SVG icon set, ported faithfully from ex/icons.jsx.
 *
 * All icons are stroke-based, 24px grid, currentColor.
 * Each component accepts optional `sw` (strokeWidth, default 1.8) and
 * `fill` (boolean — switches to filled/currentColor mode).
 * Extra props are forwarded to the <svg> element.
 */

import type { SVGProps } from 'react';

// Omit SVG's `fill` attribute to avoid type conflict with our boolean `filled` prop
type IconProps = Omit<SVGProps<SVGSVGElement>, 'fill'> & {
  sw?: number;
  filled?: boolean;
};

function Icon({
  d,
  filled,
  size = 24,
  sw = 1.8,
  children,
  ...p
}: IconProps & { d?: string; size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke={filled ? 'none' : 'currentColor'}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      {...p}
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

export function Lock(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.4" />
      <path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" />
      <circle cx="12" cy="15" r="1.3" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function Shield(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 3l7 3v5c0 4.4-3 8-7 10-4-2-7-5.6-7-10V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </Icon>
  );
}

export function Upload(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 16V5" />
      <path d="M7.5 9.5L12 5l4.5 4.5" />
      <path d="M5 17v1.5A2.5 2.5 0 0 0 7.5 21h9a2.5 2.5 0 0 0 2.5-2.5V17" />
    </Icon>
  );
}

export function Download(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M12 5v11" />
      <path d="M7.5 11.5L12 16l4.5-4.5" />
      <path d="M5 19h14" />
    </Icon>
  );
}

export function Copy(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="9" y="9" width="11" height="11" rx="2.2" />
      <path d="M5 15V6a2 2 0 0 1 2-2h9" />
    </Icon>
  );
}

export function Check(p: IconProps) {
  return <Icon d="M5 12.5l4.5 4.5L19 7" {...p} />;
}

export function X(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function Clock(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  );
}

export function Calendar(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
      <path d="M3.5 9.5h17M8 3.5v3M16 3.5v3" />
    </Icon>
  );
}

export function ChevronLeft(p: IconProps) {
  return <Icon {...p} d="M14.5 6l-6 6 6 6" />;
}
export function ChevronRight(p: IconProps) {
  return <Icon {...p} d="M9.5 6l6 6-6 6" />;
}
export function ChevronUp(p: IconProps) {
  return <Icon {...p} d="M6 14.5l6-6 6 6" />;
}
export function ChevronDown(p: IconProps) {
  return <Icon {...p} d="M6 9.5l6 6 6-6" />;
}

export function Key(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="8" cy="8" r="3.5" />
      <path d="M10.5 10.5L20 20" />
      <path d="M16.5 16.5l2-2M14.5 14.5l2.5-2.5" />
    </Icon>
  );
}

export function Eye(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.6" />
    </Icon>
  );
}

export function Hash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M9 4L7 20M17 4l-2 16M4 9h16M3 15h16" />
    </Icon>
  );
}

export function Sun(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2 12h2M20 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
    </Icon>
  );
}

export function Moon(p: IconProps) {
  return <Icon d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" {...p} />;
}

export function Bolt(p: IconProps) {
  return <Icon d="M13 3L5 13h6l-1 8 8-10h-6l1-8z" {...p} />;
}

export function Globe(p: IconProps) {
  return (
    <Icon {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.5 2.4 2.5 14.6 0 17M12 3.5c-2.5 2.4-2.5 14.6 0 17" />
    </Icon>
  );
}

export function Infinity(p: IconProps) {
  return (
    <Icon
      d="M7 9c-2 0-3.2 1.4-3.2 3s1.2 3 3.2 3c2.8 0 3-6 5-6 2 0 3.2 1.4 3.2 3s-1.2 3-3.2 3c-2.8 0-3-6-5-6z"
      {...p}
    />
  );
}

export function Files(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M13 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9l-6-6z" />
      <path d="M13 3v6h6" />
    </Icon>
  );
}

export function Trash(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M5 7h14M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2M7 7l.8 12a1.5 1.5 0 0 0 1.5 1.4h5.4a1.5 1.5 0 0 0 1.5-1.4L18 7" />
    </Icon>
  );
}

export function Send(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M20 4L3.5 11.2a.5.5 0 0 0 .05.94L10 14m10-10l-6.8 16.2a.5.5 0 0 1-.93.02L10 14m10-10L10 14" />
    </Icon>
  );
}

export function Flame(p: IconProps) {
  return (
    <Icon
      d="M12 3c.5 3-2.5 4.2-2.5 7a2.5 2.5 0 0 0 5 0c0-1-.5-1.8-.5-1.8s2.5 1.3 2.5 4.3a4.5 4.5 0 0 1-9 0c0-4 4.5-5.5 4.5-9.5z"
      {...p}
    />
  );
}

export function ArrowLeft(p: IconProps) {
  return (
    <Icon {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  );
}

export function Qr(p: IconProps) {
  return (
    <Icon {...p}>
      <rect x="4" y="4" width="6" height="6" rx="1" />
      <rect x="14" y="4" width="6" height="6" rx="1" />
      <rect x="4" y="14" width="6" height="6" rx="1" />
      <path d="M14 14h2v2M20 14v6M16 18v2h4" />
    </Icon>
  );
}

export function Github(p: IconProps) {
  return (
    <Icon
      {...p}
      filled
      sw={0}
      d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12z"
    />
  );
}

/** Named collection mirroring window.SMIcons from ex/icons.jsx */
export const Icons = {
  lock: Lock,
  shield: Shield,
  upload: Upload,
  download: Download,
  copy: Copy,
  check: Check,
  x: X,
  clock: Clock,
  key: Key,
  eye: Eye,
  hash: Hash,
  sun: Sun,
  moon: Moon,
  bolt: Bolt,
  globe: Globe,
  infinity: Infinity,
  files: Files,
  trash: Trash,
  send: Send,
  flame: Flame,
  arrowLeft: ArrowLeft,
  qr: Qr,
  github: Github,
  calendar: Calendar,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  chevronUp: ChevronUp,
  chevronDown: ChevronDown,
} as const;

export type IconName = keyof typeof Icons;
