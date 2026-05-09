export function isEditingInput(e: { target: EventTarget | null }): boolean {
  const t = e.target as HTMLElement | null;
  if (!t) return false;
  if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA') return true;
  const ce = t.getAttribute('contenteditable');
  return ce === 'true' || ce === '';
}
