import type { OutlineItem, Paper } from '../types';
import { resolveOutlineTarget } from './paper';

const SCROLL_BREATHING_PX = 16;

/**
 * Resolve the reader scroll container from any target inside it. Falls back
 * to the document-wide marker if the target was just removed mid-flight.
 *
 * scrollIntoView() walks all ancestors and may try to scroll the window /
 * body / intermediate divs, which produced an unreliable "page jumps and
 * then can't scroll back" state on Chromium when the body has overflow:hidden.
 * Targeting the explicit container with scrollTo sidesteps that whole class.
 */
function resolveScrollContainer(target: HTMLElement): HTMLElement | null {
  const closest = target.closest<HTMLElement>('[data-reader-scroll]');
  if (closest) return closest;
  return document.querySelector<HTMLElement>('[data-reader-scroll]');
}

/**
 * Smoothly scroll `target` to the top of its reader scroll container.
 *
 * Uses getBoundingClientRect() deltas (additive math against current
 * scrollTop) instead of an offsetParent walk — the readerScrollRef has no
 * `position` set, so its descendants' offsetParent chains skip past it,
 * making the offsetParent approach return null and silently fail.
 */
function smoothScrollContainerTo(target: HTMLElement) {
  const container = resolveScrollContainer(target);
  if (!container) return;
  const tRect = target.getBoundingClientRect();
  const cRect = container.getBoundingClientRect();
  const delta = tRect.top - cRect.top - SCROLL_BREATHING_PX;
  const next = Math.max(0, container.scrollTop + delta);
  container.scrollTo({ top: next, behavior: 'smooth' });
}

/** Scroll-into-view for the paragraph resolved from an outline item. */
export function scrollToOutlineItem(item: OutlineItem, paper: Paper) {
  // PDF mode: outline entries carry a `page` number and the page skeleton
  // always exists with known dimensions (even before pdfjs has rendered the
  // text layer via IntersectionObserver). Prefer page-based scrolling so the
  // click is never a silent no-op.
  if (item.page != null) {
    const pageEl = document.querySelector<HTMLElement>(`.pf-pdf-page[data-page="${item.page}"]`);
    if (pageEl) {
      smoothScrollContainerTo(pageEl);
      return;
    }
  }
  const target = resolveOutlineTarget(item, paper);
  if (!target) {
    console.warn(`[PaperFlow] outline item has no resolvable paragraph: ${item.id} (${item.label})`);
    return;
  }
  const el = document.querySelector(`[data-pid="${target.id}"]`);
  if (el instanceof HTMLElement) {
    smoothScrollContainerTo(el);
  }
}
