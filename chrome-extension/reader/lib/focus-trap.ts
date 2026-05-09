export function trapFocus(el: HTMLElement): () => void {
  const focusable = el.querySelectorAll<HTMLElement>('button, input, [tabindex]:not([tabindex="-1"]), a')
  if (focusable.length === 0) return () => {}
  const first = focusable[0]
  const last = focusable[focusable.length - 1]
  const handler = (e: KeyboardEvent) => {
    if (e.key !== 'Tab') return
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus() }
  }
  el.addEventListener('keydown', handler)
  return () => el.removeEventListener('keydown', handler)
}
