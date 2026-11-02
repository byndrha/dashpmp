"use client";

// Pembungkus Mode 3D Replika (spec v2 §7). File ini TIDAK mengimpor three /
// @react-three/* secara statis: adegan dimuat via next/dynamic (ssr:false)
// sehingga pustaka 3D hanya masuk chunk dinamis dan hanya diunduh saat
// pengguna membuka mode 3D.
//
// Tanggung jawab:
// - Deteksi WebGL: bila tidak ada → tampilkan pesan + panggil onGagal.
// - Error boundary: galat saat memuat/merender adegan → pesan + onGagal.
//   Induk (builder/penampil) lalu kembali ke 2D.

import { Component, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import dynamic from "next/dynamic";
import { Box, Loader2, Square, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { DenahDokumen, GalatDenah, Lapisan } from "@/lib/produksi-denah";

export interface Tampilan3DProps {
  dokumen: DenahDokumen;
  terpilihIds: ReadonlySet<string>;
  lapisanTampil: ReadonlySet<Lapisan>;
  peringatan: GalatDenah[];
  fokusId?: string | null;
  className?: string;
  onPilih: (elemenId: string | null, kolomId?: string | null) => void;
  /** Dipanggil bila WebGL tak ada / error boundary menangkap → induk kembali ke 2D. */
  onGagal?: () => void;
}

const Adegan3D = dynamic(() => import("./adegan-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="size-4 animate-spin" /> Memuat mode 3D…
    </div>
  ),
});

// ---------- Deteksi WebGL (sekali per halaman) ----------

let webglTersedia: boolean | null = null;
function cekWebGL(): boolean {
  if (webglTersedia === null) {
    try {
      const c = document.createElement("canvas");
      const gl = c.getContext("webgl2") ?? c.getContext("webgl");
      webglTersedia = !!gl;
      // Lepas konteks uji agar tidak memakan jatah konteks WebGL browser.
      gl?.getExtension("WEBGL_lose_context")?.loseContext();
    } catch {
      webglTersedia = false;
    }
  }
  return webglTersedia;
}
const langgananKosong = () => () => {};

// ---------- Error boundary ----------

class BatasGalat3D extends Component<{ onGalat: () => void; children: ReactNode }, { galat: boolean }> {
  state = { galat: false };
  static getDerivedStateFromError() {
    return { galat: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Mode 3D gagal:", error);
    this.props.onGalat();
  }
  render() {
    if (this.state.galat) return <PesanGagal pesan="Mode 3D gagal dimuat." />;
    return this.props.children;
  }
}

function PesanGagal({ pesan }: { pesan: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="flex max-w-sm items-start gap-2 rounded-lg border bg-background p-3 text-sm shadow-sm">
        <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-500" />
        <div>
          <div className="font-medium">{pesan}</div>
          <div className="text-xs text-muted-foreground">Kembali ke tampilan 2D.</div>
        </div>
      </div>
    </div>
  );
}

export function Tampilan3D({ className, onGagal, ...props }: Tampilan3DProps) {
  // null di server (tidak pernah dirender di server dalam praktik: mode 3D dibuka oleh klik).
  const webgl = useSyncExternalStore(langgananKosong, cekWebGL, () => null);
  const onGagalRef = useRef(onGagal);
  useLayoutEffect(() => {
    onGagalRef.current = onGagal;
  });
  useEffect(() => {
    if (webgl === false) onGagalRef.current?.();
  }, [webgl]);

  return (
    <div className={cn("relative overflow-hidden", className)}>
      {webgl === false ? (
        <PesanGagal pesan="Perangkat/browser ini tidak mendukung WebGL." />
      ) : webgl ? (
        <BatasGalat3D onGalat={() => onGagalRef.current?.()}>
          <Adegan3D {...props} />
        </BatasGalat3D>
      ) : null}
    </div>
  );
}

/** Tombol segmen 2D | 3D untuk header builder & penampil. */
export function Toggle2D3D({ mode3D, onUbah, className }: { mode3D: boolean; onUbah: (mode3D: boolean) => void; className?: string }) {
  const tombol = (nilai: boolean, label: string, ikon: ReactNode, judul: string) => (
    <button
      type="button"
      role="radio"
      aria-checked={mode3D === nilai}
      title={judul}
      onClick={() => onUbah(nilai)}
      className={cn(
        "inline-flex h-7 items-center gap-1 rounded-[5px] px-2 text-xs font-medium transition-colors [&_svg]:size-3.5",
        mode3D === nilai ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
      )}
    >
      {ikon}
      {label}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Mode tampilan denah" className={cn("inline-flex items-center rounded-md bg-muted p-0.5", className)}>
      {tombol(false, "2D", <Square />, "Tampilan 2D (denah)")}
      {tombol(true, "3D", <Box />, "Mode 3D replika")}
    </div>
  );
}
