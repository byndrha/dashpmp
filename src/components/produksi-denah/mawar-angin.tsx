// Mawar mata angin — komponen presentasi MANDIRI (SVG sendiri, tanpa
// ketergantungan pada viewBox kanvas denah), dipakai di pojok kanan atas
// kanvas 2D dan sebagai HUD di mode 3D.
//
// utaraDerajat: 0 = utara ke atas kanvas, bertambah searah jarum jam
// (sama dengan kanvas.utaraDerajat di dokumen). Huruf U/T/S/B ikut berputar
// mengikuti arahnya tetapi tetap tegak agar terbaca.

import { cn } from "@/lib/utils";

export interface MawarAnginProps {
  utaraDerajat: number;
  /** Diameter dalam piksel (bawaan 56). */
  ukuran?: number;
  className?: string;
}

const ARAH: { huruf: string; sudut: number }[] = [
  { huruf: "U", sudut: 0 },
  { huruf: "T", sudut: 90 },
  { huruf: "S", sudut: 180 },
  { huruf: "B", sudut: 270 },
];

export function MawarAngin({ utaraDerajat, ukuran = 56, className }: MawarAnginProps) {
  const r = 50; // koordinat SVG: viewBox -50..50
  const rHuruf = 36;
  return (
    <div
      className={cn("pointer-events-none rounded-full border bg-background/90 shadow-sm backdrop-blur", className)}
      style={{ width: ukuran, height: ukuran }}
      role="img"
      aria-label={`Mata angin: utara ${utaraDerajat}° dari atas`}
      title={`Utara ${utaraDerajat}°`}
    >
      <svg viewBox={`${-r} ${-r} ${r * 2} ${r * 2}`} width={ukuran} height={ukuran} aria-hidden>
        <g transform={`rotate(${utaraDerajat})`}>
          {/* Garis bantu silang + jarum: setengah utara merah, selatan abu. */}
          <line x1={0} y1={-24} x2={0} y2={24} className="stroke-muted-foreground/30" strokeWidth={1} />
          <line x1={-24} y1={0} x2={24} y2={0} className="stroke-muted-foreground/30" strokeWidth={1} />
          <path d="M 0 -26 L 7 0 L -7 0 Z" className="fill-red-500 dark:fill-red-400" />
          <path d="M 0 26 L 7 0 L -7 0 Z" className="fill-muted-foreground/60" />
          <circle r={2.5} className="fill-background stroke-foreground/60" strokeWidth={1} />
          {ARAH.map(({ huruf, sudut }) => {
            const rad = (sudut * Math.PI) / 180;
            const x = Math.sin(rad) * rHuruf;
            const y = -Math.cos(rad) * rHuruf;
            return (
              <text
                key={huruf}
                x={x}
                y={y}
                transform={`rotate(${-utaraDerajat} ${x} ${y})`}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize={huruf === "U" ? 17 : 14}
                fontWeight={huruf === "U" ? 700 : 500}
                className={huruf === "U" ? "fill-red-600 dark:fill-red-400" : "fill-muted-foreground"}
              >
                {huruf}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
