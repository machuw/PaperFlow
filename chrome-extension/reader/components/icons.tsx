import { CSSProperties, SVGProps, ReactNode } from 'react';

interface IconProps {
  size?: number;
  stroke?: number;
  fill?: string;
  style?: CSSProperties;
  className?: string;
  d?: string;
  children?: ReactNode;
}

function Icon({ d, size = 16, stroke = 1.5, fill = 'none', style, children, ...rest }: IconProps & Omit<SVGProps<SVGSVGElement>, 'fill' | 'stroke' | 'strokeWidth'>) {
  return (
    <svg
      width={size} height={size} viewBox="0 0 16 16"
      fill={fill} stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0, ...style }}
      {...rest}
    >
      {d ? <path d={d} /> : children}
    </svg>
  );
}

type IconComponent = (p: Omit<IconProps, 'd' | 'children'>) => ReactNode;

// Subset of prototype icons actually used in Phase 2. More icons can be added
// as later Plans introduce new UI. Do not add icons speculatively.
export const I = {
  Sidebar:   (p) => <Icon {...p}><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></Icon>,
  Library:   (p) => <Icon {...p}><rect x="2.5" y="2.5" width="3" height="11" rx="0.5"/><rect x="6.5" y="2.5" width="3" height="11" rx="0.5"/><path d="M9.5 4.5l2.4-0.7 2.6 9.1-2.4 0.7z"/></Icon>,
  Command:   (p) => <Icon {...p}><path d="M5 5h6v6H5zM5 5a1.5 1.5 0 1 1 0-3M11 5a1.5 1.5 0 1 0 0-3M5 11a1.5 1.5 0 1 0 0 3M11 11a1.5 1.5 0 1 1 0 3"/></Icon>,
  Settings:  (p) => <Icon {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></Icon>,
  Sparkle:   (p) => <Icon {...p}><path d="M8 2.5l1.3 3.2L12.5 7l-3.2 1.3L8 11.5l-1.3-3.2L3.5 7l3.2-1.3z"/><path d="M12 11.5l0.5 1 1 0.5-1 0.5-0.5 1-0.5-1-1-0.5 1-0.5z"/></Icon>,
  Book:      (p) => <Icon {...p}><path d="M2.5 3.5a1 1 0 0 1 1-1H8v11H3.5a1 1 0 0 1-1-1zM13.5 3.5a1 1 0 0 0-1-1H8v11h4.5a1 1 0 0 0 1-1z"/></Icon>,
  Grid:      (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.5"/></Icon>,
  Layers:    (p) => <Icon {...p}><path d="M8 2.5L2 5.5l6 3 6-3zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></Icon>,
  Moon:      (p) => <Icon {...p}><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z"/></Icon>,
  Sun:       (p) => <Icon {...p}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></Icon>,
  Search:    (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></Icon>,
  Close:     (p) => <Icon {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></Icon>,
  Quote:     (p) => <Icon {...p}><path d="M3 6.5c0-2 1-3 2.5-3M3 6.5v3h2.5v-3zM9 6.5c0-2 1-3 2.5-3M9 6.5v3h2.5v-3z"/></Icon>,
  Translate: (p) => <Icon {...p}><path d="M2.5 4h5M5 2.5v1.5M3 4c0 2.5 2 5 4 5"/><path d="M7 9c-1.5 0-2.5-1-2.5-1"/><path d="M8.5 13.5l3-7 3 7M9.5 11.5h4"/></Icon>,
  Highlight: (p) => <Icon {...p}><path d="M10 2.5l3.5 3.5-6.5 6.5-3 0.5 0.5-3z"/><path d="M2.5 14h5"/></Icon>,
  Chat:      (p) => <Icon {...p}><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-0a1.5 1.5 0 0 1-1.5-1.5z"/></Icon>,
  Memory:    (p) => <Icon {...p}><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/><circle cx="8" cy="8" r="2.5"/></Icon>,
  Edit:      (p) => <Icon {...p}><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></Icon>,
  Trash:     (p) => <Icon {...p}><path d="M3 4.5h10M6 4.5V3h4v1.5M5.5 4.5v8a.5.5 0 0 0 .5.5h4a.5.5 0 0 0 .5-.5v-8"/></Icon>,
  Clock:     (p) => <Icon {...p}><circle cx="8" cy="8" r="5.5"/><path d="M8 5v3.5l2 2"/></Icon>,
  Check:     (p) => <Icon {...p}><path d="M3 8.5l3 3 7-7"/></Icon>,
  Plus:      (p) => <Icon {...p}><path d="M8 3v10M3 8h10"/></Icon>,
  Refresh:   (p) => <Icon {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2h-2"/></Icon>,
  ArrowRight:(p) => <Icon {...p}><path d="M3 8h10M9 4l4 4-4 4"/></Icon>,
  ArrowUp:   (p) => <Icon {...p}><path d="M8 13V3M4 7l4-4 4 4"/></Icon>,
  Stop:      (p) => <Icon {...p} fill="currentColor"><rect x="4" y="4" width="8" height="8" rx="1" stroke="none"/></Icon>,
  Link:      (p) => <Icon {...p}><path d="M7 9l-2 2a2 2 0 1 1-2.8-2.8l2-2M9 7l2-2a2 2 0 1 1 2.8 2.8l-2 2M6 10l4-4"/></Icon>,
  Copy:      (p) => <Icon {...p}><rect x="4.5" y="4.5" width="8" height="9" rx="1"/><path d="M3.5 11V3.5a1 1 0 0 1 1-1H11"/></Icon>,
  Hash:      (p) => <Icon {...p}><path d="M6 2.5l-1 11M11 2.5l-1 11M2.5 6h11M2.5 10h11"/></Icon>,
  LogOut:    (p) => <Icon {...p}><path d="M6.5 14H3.5a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1h3"/><path d="M11 11l3-3-3-3"/><path d="M14 8H6.5"/></Icon>,
  CreditCard:(p) => <Icon {...p}><rect x="1.5" y="3.5" width="13" height="9" rx="1"/><path d="M1.5 6.5h13"/></Icon>,
  SwitchAccount: (p) => <Icon {...p}><path d="M11 1.5l2.5 2.5L11 6.5"/><path d="M2.5 7V5.5A2 2 0 0 1 4.5 3.5h9"/><path d="M5 14.5l-2.5-2.5L5 9.5"/><path d="M13.5 9v1.5a2 2 0 0 1-2 2h-9"/></Icon>,
  Globe:     (p) => <Icon {...p}><circle cx="8" cy="8" r="6"/><path d="M2 8h12M8 2a9 9 0 0 1 0 12M8 2a9 9 0 0 0 0 12"/></Icon>,
  Folder:       (p) => <Icon {...p}><path d="M2 5a1 1 0 011-1h4l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V5z" /></Icon>,
  ChevronDown:  (p) => <Icon {...p}><path d="M3.5 6L8 10.5L12.5 6" /></Icon>,
  More:         (p) => <Icon {...p} fill="currentColor"><circle cx="3" cy="8" r="1.1" stroke="none"/><circle cx="8" cy="8" r="1.1" stroke="none"/><circle cx="13" cy="8" r="1.1" stroke="none"/></Icon>,
  User:         (p) => <Icon {...p}><circle cx="8" cy="5.5" r="2.5"/><path d="M3 14c0-2.5 2.2-4.5 5-4.5s5 2 5 4.5"/></Icon>,
} satisfies Record<string, IconComponent>;

export type IconName = keyof typeof I;
