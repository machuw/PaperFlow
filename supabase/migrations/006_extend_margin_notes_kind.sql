-- supabase/migrations/006_extend_margin_notes_kind.sql
-- Per docs/specs/2026-04-24-spec-ui-redesign-chat-notes.md §5.3:
-- extend kind CHECK to allow new 'note' / 'highlight' values introduced
-- by the redesign, while preserving deprecated 'summarize'/'ask' for
-- historical rows.

alter table margin_notes
  drop constraint margin_notes_kind_check;

alter table margin_notes
  add constraint margin_notes_kind_check
    check (kind in ('explain','summarize','translate','ask','note','highlight'));
