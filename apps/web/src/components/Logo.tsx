/**
 * The iGerald mark: an open orbit with the "i" dot at its centre and one satellite on the ring —
 * one intelligence, many accounts around it. Original artwork for this product.
 */
export function LogoMark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden focusable="false">
      <defs>
        <linearGradient id="ig-chrome" x1="3" y1="3" x2="29" y2="29" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#ffffff" />
          <stop offset="0.38" stopColor="#aeb7c6" />
          <stop offset="0.6" stopColor="#5d6777" />
          <stop offset="1" stopColor="#e9edf3" />
        </linearGradient>
      </defs>
      <path d="M26.6 12.2A11.4 11.4 0 1 0 27.4 16" fill="none" stroke="url(#ig-chrome)" strokeWidth="3.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="3.6" fill="#9d8cff" />
      <circle cx="27.4" cy="16" r="2.5" fill="url(#ig-chrome)" />
    </svg>
  );
}

export function Wordmark({ size = 26, href }: { size?: number; href?: string }) {
  const inner = (
    <>
      <LogoMark size={size} />
      <span>
        i<b>Gerald</b>
      </span>
    </>
  );
  return href ? (
    <a className="wordmark" href={href} aria-label="iGerald — overview">
      {inner}
    </a>
  ) : (
    <span className="wordmark">{inner}</span>
  );
}
