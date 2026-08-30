/** Routeforge mark: a keystone hexagon with a route struck through it. */
export default function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label="Routeforge"
      className="logo"
    >
      <path d="M32 3 58 18v28L32 61 6 46V18Z" fill="var(--logo-bg)" />
      <path
        d="M32 3 58 18v28L32 61 6 46V18Z"
        fill="none"
        stroke="var(--logo-rim)"
        strokeWidth="3.5"
        strokeLinejoin="round"
      />
      <path
        d="M17 44 27 32l10 6 11-16"
        fill="none"
        stroke="var(--logo-line)"
        strokeWidth="4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="17" cy="44" r="5.5" fill="var(--logo-line)" />
      <circle cx="27" cy="32" r="4.5" fill="var(--logo-bg)" stroke="var(--logo-line)" strokeWidth="3" />
      <circle cx="37" cy="38" r="4.5" fill="var(--logo-bg)" stroke="var(--logo-line)" strokeWidth="3" />
      {/* The last node is the boss. */}
      <circle cx="48" cy="22" r="6" fill="var(--logo-boss)" />
    </svg>
  )
}
