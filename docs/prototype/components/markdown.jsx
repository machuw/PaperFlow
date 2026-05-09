// Thin Markdown renderer — marked + DOMPurify, no syntax highlighting.
// Loaded after marked.min.js and purify.min.js; exposes window.Markdown.
function Markdown({ source }) {
  const html = useMemo(() => {
    if (!source) return '';
    const raw = window.marked.parse(source, { breaks: false, gfm: true });
    return window.DOMPurify.sanitize(raw);
  }, [source]);
  return (
    <div
      className="md-content"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
window.Markdown = Markdown;
