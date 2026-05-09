import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { LibraryRowView } from '../../../reader/components/library-row';

const baseRow = {
  urlHash: 'a', title: 't', authors: [], role: '', judgment: '',
  addedAt: 0, lastRead: 0, pages: 0, annotations: 0, hasMemory: false,
  libraryId: null, topicIds: [],
};

describe('Optimistic UI — chip lifecycle', () => {
  it('chip shows opacity 0.7 while assignment is in flight', async () => {
    let resolveAssign!: () => void;
    const onAssign = vi.fn(() => new Promise<void>(r => { resolveAssign = r; }));
    render(<LibraryRowView
      row={baseRow}
      isCurrent={false}
      libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]}
      topics={[]}
      onAssignLibrary={onAssign as any}
      onToggleTopic={() => {}}
      onUnassignTopic={() => {}}
    />);
    fireEvent.click(screen.getByLabelText('Set library'));
    fireEvent.click(await screen.findByText(/Q4/));  // Q4 button inside popover
    const chip = await screen.findByLabelText('Library: Q4');
    expect(chip).toHaveStyle('opacity: 0.7');
    resolveAssign();
    await waitFor(() => expect(chip).toHaveStyle('opacity: 1'));
  });

  it('chip shakes on lock failure then reverts to prev state', async () => {
    const onAssign = vi.fn().mockRejectedValue(new Error('lock failed'));
    render(<LibraryRowView
      row={baseRow}
      isCurrent={false}
      libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]}
      topics={[]}
      onAssignLibrary={onAssign}
      onToggleTopic={() => {}}
      onUnassignTopic={() => {}}
    />);
    // Open popover with real timers so findByText polling works
    fireEvent.click(screen.getByLabelText('Set library'));
    const q4btn = await screen.findByText(/Q4/);
    // Switch to fake timers before the click that triggers the async failure
    vi.useFakeTimers();
    fireEvent.click(q4btn);
    // Allow the rejected promise to settle (microtask)
    await act(async () => { await Promise.resolve(); });
    const chip = screen.getByLabelText('Library: Q4');
    expect(chip.className).toContain('shake-x');
    // Tick past the shake (320ms) + fade (200ms)
    await act(async () => { vi.advanceTimersByTime(600); });
    // After failure timeout, chip reverts — "Set library" CTA appears again
    expect(screen.getByLabelText('Set library')).toBeInTheDocument();
    vi.useRealTimers();
  });
});
