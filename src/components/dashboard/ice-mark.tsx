export function IceMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className={className}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path d="M16 1 L29 9 V23 L16 31 L3 23 V9 Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M16 1 V31 M3 9 L29 23 M29 9 L3 23" stroke="currentColor" strokeWidth="1.1" strokeOpacity="0.55" />
      <path d="M16 1 L29 9 V23 L16 31 L3 23 V9 Z" fill="currentColor" fillOpacity="0.12" />
    </svg>
  );
}
