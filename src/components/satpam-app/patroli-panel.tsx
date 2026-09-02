"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Camera, CheckCircle2, Circle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPatroliSesiAction, selesaiPatroliSesiAction } from "@/app/mkesindo/satpam-app/actions";
import type { PatroliSesiDetail, PatroliSesiRingkas } from "@/lib/queries/satpam-patroli";
import { PATROLI_TITIK_LIST } from "@/lib/satpam-patroli-titik";
import { formatDate, formatTime } from "@/lib/format";

// Konten tab "Patroli" -- dua kondisi: tidak ada sesi aktif (tombol Mulai +
// riwayat) atau ada sesi aktif (checklist 13 titik + Foto Tambahan + Selesai
// Patroli). Setiap tap titik/Foto Tambahan pindah ke route penuh-layar
// terpisah (Task 7) lewat navigasi Next.js sungguhan (bukan tab-switch di
// dalam shell) -- pola yang sama seperti tombol "Inspeksi" di InspeksiPanel.
export function PatroliPanel({
  initialActiveSesi,
  initialRiwayat,
}: {
  initialActiveSesi: PatroliSesiDetail | null;
  initialRiwayat: PatroliSesiRingkas[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function handleMulai() {
    startTransition(async () => {
      const result = await startPatroliSesiAction();
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push("/mkesindo/satpam-app/patroli");
    });
  }

  function handleSelesai() {
    if (!initialActiveSesi) return;
    startTransition(async () => {
      const result = await selesaiPatroliSesiAction(initialActiveSesi.sesiId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      router.push("/mkesindo/satpam-app/patroli");
    });
  }

  if (!initialActiveSesi) {
    return (
      <div className="flex flex-col gap-4 p-4">
        <Button size="lg" className="h-14" disabled={pending} onClick={handleMulai}>
          Mulai Patroli
        </Button>
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-base font-semibold">Riwayat Patroli</h2>
          {initialRiwayat.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Belum ada riwayat patroli.</p>
          ) : (
            initialRiwayat.map((sesi) => (
              <div key={sesi.sesiId} className="rounded-lg border p-3 text-sm">
                <p className="font-medium">
                  {formatDate(sesi.mulaiWaktu)} — {formatTime(sesi.mulaiWaktu)} s/d {formatTime(sesi.selesaiWaktu)}
                </p>
                <p className="text-xs text-muted-foreground">{sesi.jumlahFoto} foto</p>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  const fotoByTitik = new Map(
    initialActiveSesi.fotos.filter((f) => f.titikPatroli != null).map((f) => [f.titikPatroli as string, f])
  );
  const fotoTambahan = initialActiveSesi.fotos.filter((f) => f.titikPatroli == null);
  const semuaTitikTerisi = PATROLI_TITIK_LIST.every((t) => fotoByTitik.has(t));

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-2">
        {PATROLI_TITIK_LIST.map((titik) => {
          const sudah = fotoByTitik.has(titik);
          return (
            <button
              key={titik}
              type="button"
              className="flex items-center justify-between gap-2 rounded-lg border p-3 text-left"
              onClick={() =>
                router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}?titik=${encodeURIComponent(titik)}`)
              }
            >
              <span className="text-sm">{titik}</span>
              {sudah ? (
                <CheckCircle2 className="size-5 text-emerald-600" />
              ) : (
                <Circle className="size-5 text-muted-foreground" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-display text-base font-semibold">Foto Tambahan</h2>
        {fotoTambahan.map((f) => (
          <div key={f.fotoId} className="rounded-lg border p-3 text-sm">
            {f.keterangan}
          </div>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}`)}
        >
          <Camera className="size-4" /> Tambah Foto
        </Button>
      </div>

      <Button size="lg" className="h-14" disabled={pending || !semuaTitikTerisi} onClick={handleSelesai}>
        Selesai Patroli
      </Button>
    </div>
  );
}
