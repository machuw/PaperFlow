import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { LibraryPopover, TopicPopover } from '../../../reader/components/library-popover';

describe('LibraryPopover (single-select)', () => {
  it('renders existing libraries + None + Create option when typed text doesnt match', () => {
    render(<LibraryPopover
      libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]}
      currentId="l1"
      onAssign={() => {}}
      onCreate={() => {}}
      onClose={() => {}}
    />);
    expect(screen.getByText('— None —')).toBeInTheDocument();
    expect(screen.getByText('Q4')).toBeInTheDocument();
  });

  it('typing a non-matching name reveals + Create row', () => {
    render(<LibraryPopover libraries={[{ id: 'l1', name: 'Q4', createdAt: 0 }]} currentId={null} onAssign={() => {}} onCreate={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText(/Filter or create/), { target: { value: 'NewLib' } });
    expect(screen.getByText(/Create "NewLib"/)).toBeInTheDocument();
  });

  it('clicking — None — fires onAssign(null) and closes', () => {
    const onAssign = vi.fn();
    const onClose = vi.fn();
    render(<LibraryPopover libraries={[]} currentId="l1" onAssign={onAssign} onCreate={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByText('— None —'));
    expect(onAssign).toHaveBeenCalledWith(null);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('TopicPopover (multi-select)', () => {
  it('renders checkboxes for each topic with checked state from selectedIds', () => {
    render(<TopicPopover
      topics={[{ id: 't1', name: 'VLA', createdAt: 0 }, { id: 't2', name: 'Robotics', createdAt: 0 }]}
      selectedIds={['t1']}
      onToggle={() => {}}
      onCreate={() => {}}
      onClose={() => {}}
    />);
    expect((screen.getByLabelText('VLA') as HTMLInputElement).checked).toBe(true);
    expect((screen.getByLabelText('Robotics') as HTMLInputElement).checked).toBe(false);
  });

  it('clicking a checkbox fires onToggle with id (does not close)', () => {
    const onToggle = vi.fn();
    const onClose = vi.fn();
    render(<TopicPopover topics={[{ id: 't1', name: 'VLA', createdAt: 0 }]} selectedIds={[]} onToggle={onToggle} onCreate={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByLabelText('VLA'));
    expect(onToggle).toHaveBeenCalledWith('t1');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('empty catalog shows "Type to create your first topic"', () => {
    render(<TopicPopover topics={[]} selectedIds={[]} onToggle={() => {}} onCreate={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/Type to create your first topic/)).toBeInTheDocument();
  });
});
