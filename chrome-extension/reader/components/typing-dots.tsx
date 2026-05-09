export function TypingDots() {
  return (
    <div
      role="status"
      aria-label="AI is thinking"
      style={{
        display: 'flex', alignItems: 'center', gap: 5,
        padding: '6px 2px',
        animation: 'fade-up 180ms',
      }}
    >
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="pf-typing-dot"
          style={{
            width: 6, height: 6, borderRadius: '50%',
            background: 'var(--ink-faded)',
            animation: 'pf-typing-dot 1.2s ease-in-out infinite',
            animationDelay: `${i * 160}ms`,
            display: 'inline-block',
          }}
        />
      ))}
    </div>
  );
}
