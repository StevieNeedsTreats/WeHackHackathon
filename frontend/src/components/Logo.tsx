/**
 * TruthGraph's mark, the same drawing as app/icon.svg (the favicon): three pieces of evidence in the
 * stance colours (supports, mixed, refutes) converging on a verdict. Fixed colours, so it reads the
 * same in both themes; a hairline keeps the dark tile visible on the dark background.
 */
export function Logo({ size = 24, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={className} aria-hidden>
      <rect x=".5" y=".5" width="31" height="31" rx="7.5" fill="#1b1a17" stroke="var(--line-2)" strokeOpacity=".6" />
      <path d="M8.5 11.5 16 23M16 8v15M23.5 11.5 16 23" stroke="#f6f5f1" strokeOpacity=".55" strokeWidth="2" strokeLinecap="round" />
      <g stroke="#1b1a17" strokeWidth="1.5">
        <circle cx="8.5" cy="11.5" r="3.4" fill="#5a9be2" />
        <circle cx="16" cy="8" r="3.4" fill="#d8a52b" />
        <circle cx="23.5" cy="11.5" r="3.4" fill="#e2654f" />
        <circle cx="16" cy="23.2" r="4.8" fill="#f6f5f1" />
      </g>
      <circle cx="16" cy="23.2" r="1.8" fill="#1b1a17" />
    </svg>
  );
}
