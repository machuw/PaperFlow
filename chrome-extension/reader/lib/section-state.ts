export type SectionState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'streaming'; body: string }
  | { kind: 'ready'; body: string }
  | { kind: 'error'; message: string };
