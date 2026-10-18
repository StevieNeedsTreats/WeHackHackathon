/**
 * TruthGraph's mark, the same drawing as app/icon.svg (the favicon): a hypothesis over two findings
 * that contradict each other. Ink on paper with the contradiction in brick, from the theme's own
 * tokens, so it follows light and dark mode.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <g transform="translate(0 .8)" strokeWidth="2" strokeLinecap="round">
        <path d="M14.4 10.9 9.6 19.6M17.6 10.9l4.8 8.7" stroke="var(--ink)" fill="none" />
        <path d="M12.4 22.5h7.2" stroke="var(--neg)" strokeDasharray="1.6 2.4" />
        <circle cx="16" cy="8.2" r="3.6" fill="var(--ink)" />
        <circle cx="8.6" cy="22.5" r="3.1" fill="none" stroke="var(--ink)" />
        <circle cx="23.4" cy="22.5" r="3.1" fill="none" stroke="var(--ink)" />
      </g>
    </svg>
  );
}
