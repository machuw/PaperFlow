import type { Paper, OverviewMeta } from '../types';
import type { OverviewState } from '../lib/overview';
import { OverviewContributions } from './overview-contributions';
import { OverviewOutline } from './overview-outline';
import { OverviewKeywords } from './overview-keywords';
import { OverviewPaperInfo } from './overview-paper-info';

interface Props {
  paper: Paper;
  meta: OverviewMeta | null;
  model: string;
  locale: string;
  contributionsState: OverviewState;
  keywordsState: OverviewState;
  onRetryContributions?: () => void;
  onRetryKeywords?: () => void;
}
export function OverviewView(p: Props) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, padding: 16, overflow: 'auto', height: '100%' }}>
      <OverviewContributions state={p.contributionsState} model={p.model} paper={p.paper} onRetry={p.onRetryContributions} />
      <OverviewKeywords state={p.keywordsState} model={p.model} paper={p.paper} locale={p.locale} onRetry={p.onRetryKeywords} />
      <OverviewOutline paper={p.paper} />
      <OverviewPaperInfo paper={p.paper} meta={p.meta} locale={p.locale} />
    </div>
  );
}
