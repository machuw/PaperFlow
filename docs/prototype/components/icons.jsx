// Tiny hand-tuned icon set — 16px stroke
const Icon = ({ d, size = 16, stroke = 1.5, fill = 'none', children, ...rest }) => (
  <svg
    width={size} height={size} viewBox="0 0 16 16"
    fill={fill} stroke="currentColor" strokeWidth={stroke}
    strokeLinecap="round" strokeLinejoin="round"
    style={{ flexShrink: 0, ...rest.style }}
    {...rest}
  >
    {d ? <path d={d} /> : children}
  </svg>
);

const I = {
  Outline:      (p) => <Icon {...p}><path d="M2.5 4h4M2.5 8h5M2.5 12h3"/><path d="M10 4h3.5M10 8h3.5M10 12h3.5"/></Icon>,
  Thumbnails:   (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4" height="5" rx="0.5"/><rect x="9.5" y="2.5" width="4" height="5" rx="0.5"/><rect x="2.5" y="8.5" width="4" height="5" rx="0.5"/><rect x="9.5" y="8.5" width="4" height="5" rx="0.5"/></Icon>,
  Notes:        (p) => <Icon {...p}><path d="M3 3l10 0v8l-3 3H3z"/><path d="M10 14v-3h3"/></Icon>,
  Sparkle:      (p) => <Icon {...p}><path d="M8 2.5l1.3 3.2L12.5 7l-3.2 1.3L8 11.5l-1.3-3.2L3.5 7l3.2-1.3z"/><path d="M12 11.5l0.5 1 1 0.5-1 0.5-0.5 1-0.5-1-1-0.5 1-0.5z"/></Icon>,
  Chat:         (p) => <Icon {...p}><path d="M2.5 4a1.5 1.5 0 0 1 1.5-1.5h8a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7l-3 3v-3h-0a1.5 1.5 0 0 1-1.5-1.5z"/></Icon>,
  Memory:       (p) => <Icon {...p}><path d="M8 2v2M8 12v2M2 8h2M12 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4"/><circle cx="8" cy="8" r="2.5"/></Icon>,
  Library:      (p) => <Icon {...p}><rect x="2.5" y="2.5" width="3" height="11" rx="0.5"/><rect x="6.5" y="2.5" width="3" height="11" rx="0.5"/><path d="M10.5 4.5l2.4-0.7 2.6 9.1-2.4 0.7z" transform="translate(-1 0)"/></Icon>,
  Settings:     (p) => <Icon {...p}><circle cx="8" cy="8" r="2"/><path d="M8 1.5v2M8 12.5v2M14.5 8h-2M3.5 8h-2M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4M12.6 12.6l-1.4-1.4M4.8 4.8L3.4 3.4"/></Icon>,
  Search:       (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3"/></Icon>,
  Close:        (p) => <Icon {...p}><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></Icon>,
  Check:        (p) => <Icon {...p}><path d="M3 8.5l3 3 7-7"/></Icon>,
  Plus:         (p) => <Icon {...p}><path d="M8 3v10M3 8h10"/></Icon>,
  ChevDown:     (p) => <Icon {...p}><path d="M3.5 6l4.5 4 4.5-4"/></Icon>,
  ChevRight:    (p) => <Icon {...p}><path d="M6 3.5l4 4.5-4 4.5"/></Icon>,
  ChevLeft:     (p) => <Icon {...p}><path d="M10 3.5l-4 4.5 4 4.5"/></Icon>,
  ArrowRight:   (p) => <Icon {...p}><path d="M3 8h10M9 4l4 4-4 4"/></Icon>,
  ArrowUp:      (p) => <Icon {...p}><path d="M8 13V3M4 7l4-4 4 4"/></Icon>,
  Translate:    (p) => <Icon {...p}><path d="M2.5 4h5M5 2.5v1.5M3 4c0 2.5 2 5 4 5"/><path d="M7 9c-1.5 0-2.5-1-2.5-1"/><path d="M8.5 13.5l3-7 3 7M9.5 11.5h4"/></Icon>,
  Highlight:    (p) => <Icon {...p}><path d="M10 2.5l3.5 3.5-6.5 6.5-3 0.5 0.5-3z"/><path d="M2.5 14h5"/></Icon>,
  Quote:        (p) => <Icon {...p}><path d="M3 6.5c0-2 1-3 2.5-3M3 6.5v3h2.5v-3zM9 6.5c0-2 1-3 2.5-3M9 6.5v3h2.5v-3z"/></Icon>,
  Book:         (p) => <Icon {...p}><path d="M2.5 3.5a1 1 0 0 1 1-1H8v11H3.5a1 1 0 0 1-1-1zM13.5 3.5a1 1 0 0 0-1-1H8v11h4.5a1 1 0 0 0 1-1z"/></Icon>,
  Pin:          (p) => <Icon {...p}><path d="M10 2l4 4-1.5 1.5-1 0-3 3 0.5 2-1 1-4.5-4.5 1-1 2 0.5 3-3 0-1z"/></Icon>,
  Link:         (p) => <Icon {...p}><path d="M7 9l-2 2a2 2 0 1 1-2.8-2.8l2-2M9 7l2-2a2 2 0 1 1 2.8 2.8l-2 2M6 10l4-4"/></Icon>,
  Grid:         (p) => <Icon {...p}><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="0.5"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="0.5"/><rect x="9" y="9" width="4.5" height="4.5" rx="0.5"/></Icon>,
  Layers:       (p) => <Icon {...p}><path d="M8 2.5L2 5.5l6 3 6-3zM2 8.5l6 3 6-3M2 11.5l6 3 6-3"/></Icon>,
  Command:      (p) => <Icon {...p}><path d="M5 5h6v6H5zM5 5a1.5 1.5 0 1 1 0-3M11 5a1.5 1.5 0 1 0 0-3M5 11a1.5 1.5 0 1 0 0 3M11 11a1.5 1.5 0 1 1 0 3"/></Icon>,
  Send:         (p) => <Icon {...p}><path d="M2.5 8l11-5.5-3 11-3-4.5z"/><path d="M7.5 9l3-3.5"/></Icon>,
  Refresh:      (p) => <Icon {...p}><path d="M13 8a5 5 0 1 1-1.5-3.5M13 3v2h-2"/></Icon>,
  More:         (p) => <Icon {...p}><circle cx="4" cy="8" r="1"/><circle cx="8" cy="8" r="1"/><circle cx="12" cy="8" r="1"/></Icon>,
  ZoomIn:       (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3M7 5v4M5 7h4"/></Icon>,
  ZoomOut:      (p) => <Icon {...p}><circle cx="7" cy="7" r="4.5"/><path d="M10.5 10.5l3 3M5 7h4"/></Icon>,
  Eye:          (p) => <Icon {...p}><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z"/><circle cx="8" cy="8" r="1.75"/></Icon>,
  EyeOff:       (p) => <Icon {...p}><path d="M3 3l10 10M5.5 5.2C3.2 6.5 1.5 8 1.5 8s2.5 4.5 6.5 4.5c1.1 0 2-.25 2.85-.6M7 4c.3-.05.65-.05 1-.05 4 0 6.5 4 6.5 4S13.7 9.2 12.5 10.2"/></Icon>,
  Spark:        (p) => <Icon {...p}><path d="M8 1.5v4M8 10.5v4M1.5 8h4M10.5 8h4"/></Icon>,
  Dot:          (p) => <Icon {...p}><circle cx="8" cy="8" r="1.25" fill="currentColor" stroke="none"/></Icon>,
  Tag:          (p) => <Icon {...p}><path d="M7.5 2.5h-5v5l7 7 5-5-7-7z"/><circle cx="5" cy="5" r="0.75" fill="currentColor" stroke="none"/></Icon>,
  Moon:         (p) => <Icon {...p}><path d="M12.5 9.5A5 5 0 1 1 6.5 3.5a4 4 0 0 0 6 6z"/></Icon>,
  Sun:          (p) => <Icon {...p}><circle cx="8" cy="8" r="2.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.5 3.5l1.1 1.1M11.4 11.4l1.1 1.1M3.5 12.5l1.1-1.1M11.4 4.6l1.1-1.1"/></Icon>,
  Edit:         (p) => <Icon {...p}><path d="M10.5 2.5l3 3-8 8h-3v-3z"/></Icon>,
  Copy:         (p) => <Icon {...p}><rect x="4.5" y="4.5" width="8" height="9" rx="1"/><path d="M3.5 11V3.5a1 1 0 0 1 1-1H11"/></Icon>,
  Bookmark:     (p) => <Icon {...p}><path d="M4 2.5h8v11l-4-3-4 3z"/></Icon>,
  Sidebar:      (p) => <Icon {...p}><rect x="2" y="3" width="12" height="10" rx="1"/><path d="M6 3v10"/></Icon>,
};

window.I = I;
