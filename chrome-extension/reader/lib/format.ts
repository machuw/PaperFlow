const FALLBACK = '—';

// Guards against NaN, Infinity, and non-positive epoch values before
// delegating to Intl — avoids runtime exceptions leaking to callers.
function safe<T>(ms: number, fn: () => T): T | string {
  if (!Number.isFinite(ms) || ms <= 0) return FALLBACK;
  try { return fn(); } catch { return FALLBACK; }
}

export function formatChatTimestamp(ms: number, locale: string): string {
  return safe(ms, () =>
    new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(ms)
  ) as string;
}

export function formatNoteCardFooter(ms: number, locale: string): string {
  return safe(ms, () =>
    new Intl.DateTimeFormat(locale, { month: 'short', day: 'numeric' }).format(ms)
  ) as string;
}

// Uses local wall-clock fields (not UTC) so the row reads as the user's local
// date/time regardless of locale — matches what they see in the OS clock.
export function formatSessionHistoryRow(ms: number, _locale: string): string {
  return safe(ms, () => {
    const d = new Date(ms);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${mi}`;
  }) as string;
}

export function formatRelative(ms: number, locale: string): string {
  return safe(ms, () => {
    const diff = (Date.now() - ms) / 1000;
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
    if (diff < 60) return rtf.format(-Math.round(diff), 'second');
    if (diff < 3600) return rtf.format(-Math.round(diff / 60), 'minute');
    if (diff < 86400) return rtf.format(-Math.round(diff / 3600), 'hour');
    return rtf.format(-Math.round(diff / 86400), 'day');
  }) as string;
}
