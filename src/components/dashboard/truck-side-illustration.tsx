import type { TruckSide } from "@/lib/vehicle-check-types";

// Simple placeholder line-art per truck side — not a real vehicle photo.
// Swapping these for real illustrations or reference photos later is a
// pure asset change: the carousel only ever consumes a ReactNode per side.

function DepanIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="20" y="14" width="80" height="46" rx="6" />
      <rect x="34" y="20" width="52" height="20" rx="3" />
      <line x1="60" y1="40" x2="60" y2="60" />
      <circle cx="34" cy="66" r="8" />
      <circle cx="86" cy="66" r="8" />
    </svg>
  );
}

function SampingIllustration({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 160 80"
      className="h-full w-full"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <rect x="8" y="18" width="40" height="38" rx="4" />
      <rect x="16" y="24" width="18" height="14" rx="2" />
      <rect x="48" y="10" width="104" height="46" rx="4" />
      <circle cx="30" cy="62" r="8" />
      <circle cx="128" cy="62" r="8" />
    </svg>
  );
}

function BelakangIllustration() {
  return (
    <svg viewBox="0 0 120 80" className="h-full w-full" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="20" y="10" width="80" height="52" rx="4" />
      <line x1="60" y1="10" x2="60" y2="62" />
      <rect x="28" y="18" width="24" height="36" rx="2" />
      <rect x="68" y="18" width="24" height="36" rx="2" />
      <circle cx="34" cy="68" r="8" />
      <circle cx="86" cy="68" r="8" />
    </svg>
  );
}

export function TruckSideIllustration({ side }: { side: TruckSide }) {
  if (side === "DEPAN") return <DepanIllustration />;
  if (side === "BELAKANG") return <BelakangIllustration />;
  return <SampingIllustration flip={side === "KIRI"} />;
}
