/**
 * The Nodes Don't Lie mark, the same drawing as app/icon.svg (the favicon): a forest plot. Two studies,
 * each a square on its confidence line, pooled into the diamond under them; the dashed line is
 * "no effect". Drawn from the theme's tokens so it follows light and dark mode.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <path d="M12 3.5v25" stroke="var(--ink-4)" strokeWidth="1.5" strokeDasharray="2 2.2" strokeLinecap="round" />
      <g stroke="var(--ink)" strokeWidth="2" strokeLinecap="round">
        <path d="M6 8.5h14M11 15h15" />
      </g>
      <rect x="11" y="6" width="5" height="5" rx="1" fill="var(--ink)" />
      <rect x="17" y="12" width="6" height="6" rx="1" fill="var(--ink)" />
      <path d="M10 24.5 18 20.5l8 4-8 4z" fill="var(--pos)" />
    </svg>
  );
}
