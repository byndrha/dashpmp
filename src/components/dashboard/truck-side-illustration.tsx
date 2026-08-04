import type { TruckSide } from "@/lib/vehicle-check-types";

// Placeholder line-art per truck side — not a real vehicle photo. Redrawn
// with more detail/proportion than the original bare-primitive version, per
// user feedback on the built UI. Swapping these for real illustrations or
// reference photos later is a pure asset change: the carousel only ever
// consumes a ReactNode per side.

function DepanIllustration() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M28 34 h84 a8 8 0 0 1 8 8 v28 h-100 v-28 a8 8 0 0 1 8 -8 z" />
      <rect x="40" y="40" width="60" height="22" rx="3" />
      <line x1="70" y1="40" x2="70" y2="62" />
      <rect x="52" y="66" width="36" height="10" rx="2" />
      <line x1="52" y1="71" x2="88" y2="71" />
      <rect x="30" y="66" width="14" height="8" rx="2" />
      <rect x="96" y="66" width="14" height="8" rx="2" />
      <line x1="24" y1="80" x2="116" y2="80" />
      <circle cx="42" cy="86" r="10" />
      <circle cx="42" cy="86" r="4" />
      <circle cx="98" cy="86" r="10" />
      <circle cx="98" cy="86" r="4" />
    </svg>
  );
}

function SampingIllustration({ flip }: { flip?: boolean }) {
  return (
    <svg
      viewBox="0 0 220 100"
      className="h-full w-full"
      style={flip ? { transform: "scaleX(-1)" } : undefined}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <path d="M10 46 h34 v-16 a4 4 0 0 1 4 -4 h10 a4 4 0 0 1 4 4 v16 h4 v34 h-56 z" />
      <rect x="20" y="34" width="22" height="14" rx="2" />
      <rect x="66" y="20" width="140" height="60" rx="4" />
      <line x1="100" y1="20" x2="100" y2="80" />
      <line x1="140" y1="20" x2="140" y2="80" />
      <line x1="180" y1="20" x2="180" y2="80" />
      <line x1="10" y1="80" x2="206" y2="80" />
      <circle cx="34" cy="86" r="10" />
      <circle cx="34" cy="86" r="4" />
      <circle cx="150" cy="86" r="10" />
      <circle cx="150" cy="86" r="4" />
      <circle cx="182" cy="86" r="10" />
      <circle cx="182" cy="86" r="4" />
    </svg>
  );
}

function BelakangIllustration() {
  return (
    <svg
      viewBox="0 0 140 100"
      className="h-full w-full"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <rect x="22" y="14" width="96" height="66" rx="4" />
      <line x1="70" y1="14" x2="70" y2="80" />
      <rect x="30" y="24" width="32" height="46" rx="2" />
      <rect x="78" y="24" width="32" height="46" rx="2" />
      <line x1="62" y1="46" x2="66" y2="46" />
      <line x1="74" y1="46" x2="78" y2="46" />
      <rect x="22" y="60" width="8" height="14" rx="2" />
      <rect x="110" y="60" width="8" height="14" rx="2" />
      <line x1="18" y1="84" x2="122" y2="84" />
      <circle cx="42" cy="90" r="10" />
      <circle cx="42" cy="90" r="4" />
      <circle cx="98" cy="90" r="10" />
      <circle cx="98" cy="90" r="4" />
    </svg>
  );
}

export function TruckSideIllustration({ side }: { side: TruckSide }) {
  if (side === "DEPAN") return <DepanIllustration />;
  if (side === "BELAKANG") return <BelakangIllustration />;
  return <SampingIllustration flip={side === "KIRI"} />;
}
