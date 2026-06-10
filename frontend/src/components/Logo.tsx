interface LogoProps {
  className?: string;
}

/** Custom Sentinel brand mark: a shield with a verification check + scan line. */
export function Logo({ className = 'h-6 w-6' }: LogoProps) {
  return (
    <svg viewBox="0 0 32 32" fill="none" className={className} aria-hidden="true">
      <path
        d="M16 2.5 L27 6.2 V15 C27 22.6 22.2 27.6 16 29.5 C9.8 27.6 5 22.6 5 15 V6.2 Z"
        stroke="currentColor"
        strokeWidth="1.6"
        fill="rgba(77,124,254,0.10)"
      />
      <path
        d="M10.8 16.2 l3.6 3.6 L21.4 11.4"
        stroke="currentColor"
        strokeWidth="2.1"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M8 12.6 H24" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
    </svg>
  );
}

export function Wordmark({ className = '' }: LogoProps) {
  return (
    <span className={`flex items-center gap-2.5 ${className}`}>
      <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent-soft text-accent">
        <Logo className="h-5 w-5" />
      </span>
      <span className="font-display text-[15px] font-semibold tracking-tight text-slate-100">
        Verify<span className="text-accent">My</span>Interview
      </span>
    </span>
  );
}
