import type { TruckSide } from "@/lib/vehicle-check-types";

// Real vehicle line-art supplied by the user, served as static assets from
// public/armada/ rather than inlined. Each file carries its own
// Adobe-Illustrator-exported <style> block with generic class names
// (.st0-.st3) — inlining would collide the moment two instances render at
// once (TruckCubeCarousel mounts KANAN and KIRI simultaneously, both
// pointing at Truk-Samping.svg), so <img> keeps each instance isolated.

const ILLUSTRATION_SRC = {
  DEPAN: "/armada/Truk-Depan.svg",
  SAMPING: "/armada/Truk-Samping.svg",
  BELAKANG: "/armada/Truk-Belakang.svg",
} as const;

export function TruckSideIllustration({ side }: { side: TruckSide }) {
  const src = side === "DEPAN" ? ILLUSTRATION_SRC.DEPAN : side === "BELAKANG" ? ILLUSTRATION_SRC.BELAKANG : ILLUSTRATION_SRC.SAMPING;

  return (
    // eslint-disable-next-line @next/next/no-img-element -- static SVG asset from public/, decorative background, not a next/image candidate
    <img
      src={src}
      alt=""
      aria-hidden="true"
      className="h-full w-full object-contain opacity-15"
      style={side === "KIRI" ? { transform: "scaleX(-1)" } : undefined}
    />
  );
}
