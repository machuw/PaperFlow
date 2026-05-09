import { describe, it, expect, vi } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent } from '@testing-library/react';
import { ConfirmModal } from '../../../reader/components/confirm-modal';

describe('ConfirmModal', () => {
  it('renders title + body + Cancel + danger button (Delete)', () => {
    render(<ConfirmModal open title="Delete library 'Q4 Reading'?" body="7 papers will move to Uncategorized." dangerLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    expect(screen.getByText("Delete library 'Q4 Reading'?")).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText('Delete')).toBeInTheDocument();
  });

  it('initial focus is Cancel', () => {
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={() => {}} onCancel={() => {}} />);
    const cancel = screen.getByText('Cancel');
    expect(cancel).toHaveFocus();
  });

  it('Esc fires onCancel', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={() => {}} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('clicking Delete calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" onConfirm={onConfirm} onCancel={() => {}} />);
    fireEvent.click(screen.getByText('Delete'));
    expect(onConfirm).toHaveBeenCalled();
  });

  it('disables Esc + backdrop while inFlight=true; Delete button shows "Deleting…"', () => {
    const onCancel = vi.fn();
    render(<ConfirmModal open title="t" body="b" dangerLabel="Delete" inFlight onConfirm={() => {}} onCancel={onCancel} />);
    expect(screen.getByText('Deleting…')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).not.toHaveBeenCalled();
  });
});
