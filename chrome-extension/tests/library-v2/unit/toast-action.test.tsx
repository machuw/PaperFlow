import { describe, it, expect, vi, afterEach } from 'vitest';
import '@testing-library/jest-dom';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ToastHost } from '../../../reader/components/toast';
import { showToast } from '../../../reader/lib/toast-helpers';

afterEach(() => { vi.useRealTimers(); });

describe('ToastHost — action toast', () => {
  it('renders message + action button when pf-show-toast event fires', async () => {
    render(<ToastHost />);
    act(() => {
      showToast({ message: "Library 'Q4' deleted.", action: { label: 'Undo', handler: () => {} } });
    });
    expect(await screen.findByText("Library 'Q4' deleted.")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
  });

  it('clicking the action button fires the handler and dismisses', async () => {
    const handler = vi.fn();
    render(<ToastHost />);
    act(() => {
      showToast({ message: 'gone', action: { label: 'Undo', handler } });
    });
    const undo = await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    expect(handler).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByText('gone')).toBeNull());
  });

  it('auto-dismisses after timeoutMs (default 5000ms)', async () => {
    // Use fake timers from the start so the scheduled setTimeout is fake-controlled
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      showToast({ message: 'fades', action: { label: 'Undo', handler: () => {} } });
    });
    // State update from event is synchronous within act — use getByText, not findByText
    expect(screen.getByText('fades')).toBeInTheDocument();
    // Advance past 5000ms — triggers the fake setTimeout → setState(null)
    await act(async () => { vi.advanceTimersByTime(5001); });
    expect(screen.queryByText('fades')).toBeNull();
  });

  it('respects custom timeoutMs', async () => {
    vi.useFakeTimers();
    render(<ToastHost />);
    act(() => {
      showToast({ message: 'short', action: { label: 'X', handler: () => {} }, timeoutMs: 1000 });
    });
    expect(screen.getByText('short')).toBeInTheDocument();
    // 900ms — still visible
    await act(async () => { vi.advanceTimersByTime(900); });
    expect(screen.getByText('short')).toBeInTheDocument();
    // 100ms more (total 1000ms) — should dismiss
    await act(async () => { vi.advanceTimersByTime(200); });
    expect(screen.queryByText('short')).toBeNull();
  });

  it('still works with the legacy setToast(string) API', async () => {
    const { setToast } = await import('../../../reader/components/toast');
    render(<ToastHost />);
    act(() => { setToast('legacy message'); });
    expect(await screen.findByText('legacy message')).toBeInTheDocument();
  });
});
