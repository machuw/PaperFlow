import { describe, it, expect } from 'vitest';
import {
  formatChatTimestamp, formatNoteCardFooter,
  formatSessionHistoryRow, formatRelative,
} from '../../reader/lib/format';

const T = new Date('2026-04-24T12:30:45Z').getTime();

describe('format', () => {
  it('formatChatTimestamp en-US returns "10:32 AM" style', () => {
    const s = formatChatTimestamp(T, 'en-US');
    expect(s).toMatch(/AM|PM/);
  });
  it('formatChatTimestamp zh-CN returns "10:32" style', () => {
    expect(formatChatTimestamp(T, 'zh-CN')).toMatch(/\d{1,2}:\d{2}/);
  });
  it('formatNoteCardFooter en-US returns "Apr 24"', () => {
    expect(formatNoteCardFooter(T, 'en-US')).toContain('Apr');
  });
  it('formatNoteCardFooter zh-CN returns "4 月 24 日"', () => {
    expect(formatNoteCardFooter(T, 'zh-CN')).toMatch(/月/);
  });
  it('formatSessionHistoryRow zh-CN returns "2026-04-24 …"', () => {
    expect(formatSessionHistoryRow(T, 'zh-CN')).toMatch(/^2026-04-24/);
  });
  it('formatRelative under 60s returns "just now"', () => {
    expect(formatRelative(Date.now() - 5_000, 'en-US')).toMatch(/just now|seconds/i);
  });
  it('formatRelative invalid timestamp returns "—"', () => {
    expect(formatRelative(NaN, 'en-US')).toBe('—');
    expect(formatChatTimestamp(NaN, 'en-US')).toBe('—');
  });
});
