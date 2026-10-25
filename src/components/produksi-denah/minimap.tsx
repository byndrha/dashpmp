"use client";

// Minimap Builder Denah (pojok kanan bawah kanvas): gambar sederhana semua
// elemen + kotak viewport. Klik/tarik untuk memindah tampilan.

import { memo, useRef } from "react";
import { kotakElemen, type DenahDokumen, type DenahElemen, type Titik } from "@/lib/produksi-denah";
import { useToko, type Toko } from "@/components/produksi-denah/bidang";
import type { Tampilan } from "@/components/produksi-denah/denah-kanvas";

export interface InfoTampilan {
  tampilan: Tampilan;
  ukuran: { w: number; h: number };
}

const LEBAR_PX = 180;

const KELAS: Record<DenahElemen["tipe"], string> = {
  bak: "fill-sky-500/70",
  mesin: "fill-violet-500/80",
  derek: "fill-orange-500/80",
  dinding: "fill-slate-500",
  pintu: "fill-amber-500/80",
  area: "fill-emerald-500/25",
  label: "fill-muted-foreground/40",
};

const IsiMinimap = memo(function IsiMinimap({ elemen, terpilih }: { elemen: DenahElemen[]; terpilih: ReadonlySet<string> }) {
  return (
    <>
      {elemen.map((e) => {
        const k = kotakElemen(e);
        return (
          <rect
            key={e.id}
            x={k.x}
            y={k.y}
            width={Math.max(k.w, 0.5)}
            height={Math.max(k.h, 0.5)}
            className={terpilih.has(e.id) ? "fill-primary" : KELAS[e.tipe]}
          />
        );
      })}
    </>
  );
});

function KotakViewport({ toko }: { toko: Toko<InfoTampilan | null> }) {
  const info = useToko(toko);
  if (!info) return null;
  const { tampilan: t, ukuran: u } = info;
  return (
    <rect
      x={t.x}
      y={t.y}
      width={u.w / t.skala}
      height={u.h / t.skala}
      className="fill-primary/10 stroke-primary"
      strokeWidth={1.5}
      vectorEffect="non-scaling-stroke"
      pointerEvents="none"
    />
  );
}

export function Minimap({
  dokumen,
  terpilih,
  toko,
  onPusatkan,
}: {
  dokumen: DenahDokumen;
  terpilih: ReadonlySet<string>;
  toko: Toko<InfoTampilan | null>;
  onPusatkan: (titik: Titik) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const tekan = useRef(false);
  const { lebar, tinggi } = dokumen.kanvas;
  const tinggiPx = Math.max(60, Math.min(160, (LEBAR_PX * tinggi) / lebar));
  // Margin agar kotak viewport yang keluar kanvas tetap terlihat sebagian.
  const m = Math.max(lebar, tinggi) * 0.04;

  const keTitik = (ev: React.PointerEvent): Titik | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  };

  return (
    <div className="pointer-events-auto rounded-lg border bg-background/90 p-1 shadow-md backdrop-blur" style={{ width: LEBAR_PX + 10 }}>
      <svg
        ref={svgRef}
        width={LEBAR_PX}
        height={tinggiPx}
        viewBox={`${-m} ${-m} ${lebar + m * 2} ${tinggi + m * 2}`}
        className="block cursor-pointer touch-none"
        role="img"
        aria-label="Minimap denah"
        onPointerDown={(ev) => {
          tekan.current = true;
          ev.currentTarget.setPointerCapture(ev.pointerId);
          const t = keTitik(ev);
          if (t) onPusatkan(t);
        }}
        onPointerMove={(ev) => {
          if (!tekan.current) return;
          const t = keTitik(ev);
          if (t) onPusatkan(t);
        }}
        onPointerUp={() => (tekan.current = false)}
        onPointerCancel={() => (tekan.current = false)}
      >
        <rect x={0} y={0} width={lebar} height={tinggi} className="fill-card stroke-muted-foreground/40" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        <IsiMinimap elemen={dokumen.elemen} terpilih={terpilih} />
        <KotakViewport toko={toko} />
      </svg>
    </div>
  );
}
