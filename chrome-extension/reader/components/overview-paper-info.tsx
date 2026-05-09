import { type ReactNode, type CSSProperties } from 'react';
import type { Paper, OverviewMeta } from '../types';
import { t } from '../lib/i18n';

type FieldKind = 'text' | 'numeric' | 'link';

interface Field {
  label: string;
  value: ReactNode;
  kind: FieldKind;
}

interface Props { paper: Paper; meta: OverviewMeta | null; locale: string; }

export function OverviewPaperInfo({ paper, meta, locale }: Props) {
  const venue = meta?.venue ?? paper.venue ?? null;

  const fields: Field[] = [];
  if (venue) {
    fields.push({
      label: t('overview.field.publishedAt') || '发表于',
      value: venue,
      kind: 'text',
    });
  }
  if (paper.authors.length) {
    fields.push({
      label: t('overview.field.authors') || '作者',
      value: formatAuthors(paper.authors, locale),
      kind: 'text',
    });
  }
  if (typeof meta?.citations === 'number') {
    fields.push({
      label: t('overview.field.citations') || '引用次数',
      value: meta.citations.toLocaleString(),
      kind: 'numeric',
    });
  }
  if (meta?.field) {
    fields.push({
      label: t('overview.field.field') || '研究领域',
      value: meta.field,
      kind: 'text',
    });
  }
  if (meta?.codeUrl) {
    fields.push({
      label: t('overview.field.codeUrl') || '开放代码',
      value: (
        <a
          href={meta.codeUrl}
          target="_blank"
          rel="noreferrer"
          style={linkStyle}
        >
          {hostnameOf(meta.codeUrl) ?? 'GitHub'} ↗
        </a>
      ),
      kind: 'link',
    });
  }
  if (fields.length === 0) return null;

  return (
    <section>
      <h3 style={headingStyle}>{t('overview.info.title') || '论文信息'}</h3>
      <dl style={dlStyle}>
        {fields.map((f, i) => (
          <Row key={i} field={f} />
        ))}
      </dl>
    </section>
  );
}

function Row({ field }: { field: Field }) {
  return (
    <>
      <dt style={dtStyle} title={field.label}>{field.label}</dt>
      <dd style={ddStyle(field.kind)}>{field.value ?? '—'}</dd>
    </>
  );
}

function formatAuthors(authors: string[], _locale: string): string {
  if (authors.length === 0) return '—';
  if (authors.length === 1) return authors[0];
  if (authors.length <= 3) return authors.join(', ');
  // "Peiju Liu et al. (4 authors)" / "Peiju Liu 等 4 位"
  // Keep current i18n shape consistent across labels — let the UI convey count
  // with a parenthesized number rather than a separate field.
  const first = authors[0];
  // Detect Chinese context heuristically by checking the i18n catalog mode is
  // implied by t() result on a known key. Cheaper: accept current copy style
  // ("等 N 位") when no Latin-only text. Tradeoff: keeps existing fallback shape.
  const cjk = /[一-鿿]/.test(first) || /[一-鿿]/.test(authors[1] ?? '');
  return cjk ? `${first} 等 ${authors.length} 位` : `${first} et al. (${authors.length})`;
}

function hostnameOf(url: string): string | null {
  try {
    const u = new URL(url);
    // Strip leading "www." for cleaner display.
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

const headingStyle: CSSProperties = {
  margin: '0 0 10px',
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  fontWeight: 500,
  color: 'var(--ink)',
  letterSpacing: '0.01em',
};

const dlStyle: CSSProperties = {
  margin: 0,
  display: 'grid',
  gridTemplateColumns: 'minmax(64px, max-content) 1fr',
  columnGap: 16,
  rowGap: 6,
  alignItems: 'baseline',
};

const dtStyle: CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-sans)',
  fontSize: 11,
  fontWeight: 400,
  color: 'var(--ink-faded)',
  letterSpacing: '0.02em',
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  textTransform: 'none',
};

const ddStyle = (kind: FieldKind): CSSProperties => ({
  margin: 0,
  fontFamily: kind === 'numeric' ? 'var(--font-mono)' : 'var(--font-serif)',
  fontSize: kind === 'numeric' ? 12 : 13,
  fontWeight: 400,
  color: 'var(--ink)',
  fontVariantNumeric: kind === 'numeric' ? 'tabular-nums' : 'normal',
  lineHeight: 1.5,
  wordBreak: 'break-word',
});

const linkStyle: CSSProperties = {
  color: 'var(--walnut)',
  textDecoration: 'none',
  fontFamily: 'var(--font-sans)',
  fontSize: 12,
  borderBottom: '0.5px dotted var(--walnut)',
};
