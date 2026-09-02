"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { toast } from "sonner";
import { Camera, ChevronRight, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { startPatroliSesiAction, selesaiPatroliSesiAction } from "@/app/mkesindo/satpam-app/actions";
import type { PatroliSesiDetail, PatroliSesiRingkas } from "@/lib/queries/satpam-patroli";
import { PATROLI_TITIK_GROUPS, PATROLI_TITIK_LIST } from "@/lib/satpam-patroli-titik";
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
  const totalTitik = PATROLI_TITIK_LIST.length;
  const jumlahSelesai = PATROLI_TITIK_LIST.filter((t) => fotoByTitik.has(t)).length;
  const semuaTitikTerisi = jumlahSelesai === totalTitik;
  const persenSelesai = Math.round((jumlahSelesai / totalTitik) * 100);

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex flex-col gap-1.5 rounded-lg border p-3">
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium">
            {jumlahSelesai} dari {totalTitik} titik
          </span>
          <span className="text-xs text-muted-foreground">Mulai {formatTime(initialActiveSesi.mulaiWaktu)}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-emerald-600 transition-[width]"
            style={{ width: `${persenSelesai}%` }}
          />
        </div>
      </div>

      {PATROLI_TITIK_GROUPS.map((group) => (
        <div key={group.label} className="flex flex-col gap-2">
          <h2 className="text-xs font-medium text-muted-foreground">{group.label}</h2>
          <div className="flex flex-col gap-2">
            {group.titik.map((titik) => {
              const foto = fotoByTitik.get(titik);
              return (
                <button
                  key={titik}
                  type="button"
                  className="flex items-center gap-3 rounded-lg border p-2 text-left"
                  onClick={() =>
                    router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}?titik=${encodeURIComponent(titik)}`)
                  }
                >
                  <div className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {foto ? (
                      // eslint-disable-next-line @next/next/no-img-element -- remote Google Drive thumbnail, not a static build asset
                      <img src={foto.fotoPath} alt="" className="size-full object-cover" />
                    ) : (
                      <Camera className="size-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm">{titik}</p>
                    <p className="text-xs text-muted-foreground">{foto ? formatTime(foto.waktuFoto) : "Belum difoto"}</p>
                  </div>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                </button>
              );
            })}
          </div>
        </div>
      ))}

      <div className="flex flex-col gap-2">
        <h2 className="text-xs font-medium text-muted-foreground">Foto Tambahan</h2>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotoTambahan.map((f) => (
            <div key={f.fotoId} className="flex w-20 shrink-0 flex-col gap-1">
              <div className="size-20 overflow-hidden rounded-lg border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element -- remote Google Drive thumbnail, not a static build asset */}
                <img src={f.fotoPath} alt={f.keterangan ?? "Foto tambahan"} className="size-full object-cover" />
              </div>
              <p className="truncate text-xs text-muted-foreground">{f.keterangan}</p>
            </div>
          ))}
          <button
            type="button"
            className="flex size-20 shrink-0 items-center justify-center rounded-lg border border-dashed text-muted-foreground"
            onClick={() => router.push(`/mkesindo/satpam-app/patroli/foto/${initialActiveSesi.sesiId}`)}
          >
            <Plus className="size-5" />
          </button>
        </div>
      </div>

      <Button size="lg" className="h-14" disabled={pending || !semuaTitikTerisi} onClick={handleSelesai}>
        {semuaTitikTerisi ? "Selesai Patroli" : `Selesai Patroli · ${totalTitik - jumlahSelesai} titik lagi`}
      </Button>
    </div>
  );
}
