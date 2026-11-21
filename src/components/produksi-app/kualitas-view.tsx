"use client";

import { useState, useTransition } from "react";
import { Calendar, Clock, Check, X, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import type { PhotoUploadStatus } from "@/components/ui/photo-status-overlay";
import { cn } from "@/lib/utils";
import { getBusinessDateISO, getWibTimeHHmm } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { STATUS_MESIN_LABEL } from "@/lib/produksi-mesin-status";
import { createKualitasAction, getKualitasRiwayatAction } from "@/app/mkesindo/produksi/actions";
import type { KualitasRow } from "@/lib/queries/produksi-kualitas";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { KantongVariant } from "@/lib/queries/sales-order";

const SHIFT_OPTIONS = [1, 2, 3] as const;

// Pass/fail checklist this form collects — was 4 items (Kejernihan Es,
// Ukuran/Bentuk Sesuai, Bebas Kontaminasi/Benda Asing, Kemasan Rapi);
// Kontaminasi and Kemasan were dropped from the form per explicit request,
// and the underlying columns were dropped from the database entirely (they
// no longer exist, including for historical rows). Each remaining item
// defaults to "Lolos" (true) rather than forcing every entry to explicitly
// confirm both every time — an operator only needs to touch the items that
// actually failed.
const CHECKLIST_ITEMS = [
  { key: "cekKejernihan", label: "Kejernihan Es" },
  { key: "cekUkuranBentuk", label: "Ukuran/Bentuk Sesuai" },
] as const;

type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
type ChecklistState = Record<ChecklistKey, boolean>;

const DEFAULT_CHECKLIST: ChecklistState = {
  cekKejernihan: true,
  cekUkuranBentuk: true,
};

async function uploadFotoKualitas(file: File): Promise<string> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch("/api/mkesindo/upload/produksi-kualitas", { method: "POST", body: formData });
  const data = (await res.json()) as { path?: string; error?: string };
  if (!res.ok || !data.path) throw new Error(data.error ?? "Gagal mengunggah foto.");
  return data.path;
}

function TambahKualitasDialog({
  open,
  onOpenChange,
  mesinList,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mesinList: MesinRow[];
  onSaved: () => void;
}) {
  const [tanggalLabel, setTanggalLabel] = useState(() => getBusinessDateISO());
  // Defaults to the current WIB time — pure convenience, still editable.
  const [waktu, setWaktu] = useState(() => getWibTimeHHmm());
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [variant, setVariant] = useState<KantongVariant>("10kg");
  const [checklist, setChecklist] = useState<ChecklistState>(DEFAULT_CHECKLIST);
  const [diameterDalamMm, setDiameterDalamMm] = useState("");
  const [qty10KG, setQty10KG] = useState("");
  const [catatan, setCatatan] = useState("");
  const [fotoPath, setFotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fotoStatus, setFotoStatus] = useState<PhotoUploadStatus | undefined>(undefined);
  const [fotoBeratKemasanPath, setFotoBeratKemasanPath] = useState<string | null>(null);
  const [uploadingBeratKemasan, setUploadingBeratKemasan] = useState(false);
  const [fotoBeratKemasanStatus, setFotoBeratKemasanStatus] = useState<PhotoUploadStatus | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setWaktu(getWibTimeHHmm());
    setShift("1");
    setMesinId("");
    setVariant("10kg");
    setChecklist(DEFAULT_CHECKLIST);
    setDiameterDalamMm("");
    setQty10KG("");
    setCatatan("");
    setFotoPath(null);
    setFotoStatus(undefined);
    setFotoBeratKemasanPath(null);
    setFotoBeratKemasanStatus(undefined);
    setError(null);
  }

  async function handleCapture(file: File) {
    setError(null);
    setUploading(true);
    setFotoStatus("uploading");
    try {
      const path = await uploadFotoKualitas(file);
      setFotoPath(path);
      setFotoStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
      setFotoStatus("error");
    } finally {
      setUploading(false);
    }
  }

  async function handleCaptureBeratKemasan(file: File) {
    setError(null);
    setUploadingBeratKemasan(true);
    setFotoBeratKemasanStatus("uploading");
    try {
      const path = await uploadFotoKualitas(file);
      setFotoBeratKemasanPath(path);
      setFotoBeratKemasanStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
      setFotoBeratKemasanStatus("error");
    } finally {
      setUploadingBeratKemasan(false);
    }
  }

  function handleSubmit() {
    setError(null);
    if (!mesinId) {
      setError("Pilih mesin yang dipakai.");
      return;
    }
    if (!waktu) {
      setError("Isi waktu pemeriksaan.");
      return;
    }
    if (!qty10KG.trim() || Number(qty10KG) <= 0) {
      setError("Isi QTY Kantong Es.");
      return;
    }
    startTransition(async () => {
      const result = await createKualitasAction({
        tanggalLabel,
        waktu,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        variant,
        cekKejernihan: checklist.cekKejernihan,
        cekUkuranBentuk: checklist.cekUkuranBentuk,
        diameterDalamMm: diameterDalamMm.trim() ? Number(diameterDalamMm) : null,
        qty10KG: Number(qty10KG) || 0,
        catatan: catatan.trim() || null,
        fotoPath,
        fotoBeratKemasanPath,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      reset();
      onSaved();
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Tambah Pemeriksaan Kualitas</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {/* Tanggal narrower (100px, was the flexible 1fr column) / Jam
              wider (now 1fr, was a fixed 98px) — explicit request, swapped
              from the original layout. gap-y-3 (row gap only, gap-x stays 0
              so Tanggal/Jam sit flush against each other) separates this
              row from the Shift buttons below it, also per explicit
              request. */}
          <div className="grid grid-cols-[150px_1fr] gap-x-0 gap-y-3">
            <div className="relative">
              <Input type="time" value={waktu} onChange={(e) => setWaktu(e.target.value)} className="pl-8" />
            </div>
            <div className="relative">
              <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} className="pl-8" />
            </div>
            <div className="col-span-2 grid grid-cols-3">
              {SHIFT_OPTIONS.map((s) => (
                <Button
                  key={s}
                  type="button"
                  variant={shift === String(s) ? "default" : "outline"}
                  onClick={() => setShift(String(s))}
                  className="rounded-none"
                >
                  {SHIFT_LABEL[s]}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant={variant === "10kg" ? "default" : "outline"} onClick={() => setVariant("10kg")}>
              10 KG
            </Button>
            <Button type="button" variant={variant === "5kg" ? "default" : "outline"} onClick={() => setVariant("5kg")}>
              5 KG
            </Button>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {mesinList.map((m) => {
              const disabled = m.Status !== "AKTIF";
              const active = mesinId === String(m.MesinID);
              return (
                <button
                  key={m.MesinID}
                  type="button"
                  disabled={disabled}
                  onClick={() => setMesinId(String(m.MesinID))}
                  className={cn(
                    "flex flex-col items-start gap-0.5 rounded-lg border p-2 text-left text-xs transition-colors",
                    disabled ? "cursor-not-allowed border-border bg-muted/40 opacity-50" : "border-border hover:bg-muted/50",
                    active && !disabled && "border-primary bg-primary/10"
                  )}
                >
                  <span className="font-semibold">{m.Nama}</span>
                  <span
                    className={cn(
                      "text-[10px] font-medium",
                      m.Status === "AKTIF" ? "text-emerald-600" : m.Status === "MAINTENANCE" ? "text-amber-600" : "text-destructive"
                    )}
                  >
                    {STATUS_MESIN_LABEL[m.Status]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Checklist Kualitas</p>
            {CHECKLIST_ITEMS.map((item) => (
              <div key={item.key} className="flex items-center justify-between gap-2 rounded-lg border border-border p-2">
                <span className="text-sm">{item.label}</span>
                <div className="flex shrink-0 gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant={checklist[item.key] ? "default" : "outline"}
                    onClick={() => setChecklist((prev) => ({ ...prev, [item.key]: true }))}
                  >
                    Lolos
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={!checklist[item.key] ? "destructive" : "outline"}
                    onClick={() => setChecklist((prev) => ({ ...prev, [item.key]: false }))}
                  >
                    Tidak
                  </Button>
                </div>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Ukuran Diameter Dalam (mm)</label>
              <Input
                type="number"
                step="0.1"
                value={diameterDalamMm}
                onChange={(e) => setDiameterDalamMm(e.target.value)}
                placeholder="Standar: 28mm"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                QTY Kantong Es ({variant === "10kg" ? "10 KG" : "5 KG"})
              </label>
              <Input
                type="number"
                step="1"
                min="0"
                value={qty10KG}
                onChange={(e) => setQty10KG(e.target.value)}
                className="mt-1"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground">Catatan/Temuan (opsional)</label>
            <Textarea
              rows={2}
              value={catatan}
              onChange={(e) => setCatatan(e.target.value)}
              className="mt-1"
              placeholder="Retak, bau, dll..."
            />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Foto Bukti Sampel</label>
              <div className="mt-1 h-32 w-32">
                <LiveCameraCaptureField
                  label="Foto Sampel"
                  photoUrl={fotoPath}
                  size="main"
                  active
                  disabled={uploading || pending}
                  onCapture={handleCapture}
                  status={fotoStatus}
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Foto Bukti Berat Kemasan</label>
              <div className="mt-1 h-32 w-32">
                <LiveCameraCaptureField
                  label="Foto Berat Kemasan"
                  photoUrl={fotoBeratKemasanPath}
                  size="main"
                  active
                  disabled={uploadingBeratKemasan || pending}
                  onCapture={handleCaptureBeratKemasan}
                  status={fotoBeratKemasanStatus}
                />
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending || uploading || uploadingBeratKemasan} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Foto kecil persegi (ketuk untuk perbesar). `label` tampil sebagai pita
// kecil di bawah foto supaya operator tahu foto mana (sampel / berat).
function FotoThumbnail({ path, alt, label }: { path: string | null; alt: string; label: string }) {
  const keterangan = (
    <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-black/55 py-0.5 text-center text-[10px] font-medium text-white">
      {label}
    </span>
  );
  if (!path) {
    return (
      <div className="relative flex size-[84px] shrink-0 items-center justify-center rounded-md border bg-muted pb-3 text-center text-[9px] leading-tight text-muted-foreground">
        Tidak ada foto
        {keterangan}
      </div>
    );
  }
  return (
    <Dialog>
      <DialogTrigger
        type="button"
        className="relative block size-[84px] shrink-0 cursor-zoom-in overflow-hidden rounded-md focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
      >
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="size-full object-cover" />
        {keterangan}
      </DialogTrigger>

      <DialogContent className="max-w-3xl p-2 sm:p-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset */}
        <img src={path} alt={alt} className="max-h-[80vh] w-full rounded object-contain" />
      </DialogContent>
    </Dialog>
  );
}

// Tempat hasil pemeriksaan diletakkan: chip kode palet (mis. T1F), plus
// TakeAway/Armada bila ada alokasi langsung. Belum diletakkan sama sekali
// → chip abu-abu "Belum di palet".
function TempatHasil({ kualitas }: { kualitas: KualitasRow }) {
  const palet = kualitas.PaletKode ? kualitas.PaletKode.split(", ") : [];
  const kosong = palet.length === 0 && !kualitas.AdaTakeAway && !kualitas.AdaArmada;
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Layers className="size-3.5 shrink-0 text-muted-foreground" aria-label="Palet" />
      {palet.map((k) => (
        <span key={k} className="rounded bg-foreground px-1.5 py-0.5 text-[11px] font-bold tracking-wide text-background">
          {k}
        </span>
      ))}
      {kualitas.AdaTakeAway && (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">TakeAway</span>
      )}
      {kualitas.AdaArmada && (
        <span className="rounded bg-blue-500/15 px-1.5 py-0.5 text-[11px] font-medium text-blue-600">Armada</span>
      )}
      {kosong && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Belum di palet</span>}
    </div>
  );
}

// Kartu satu pemeriksaan (tata letak ringkas untuk HP):
//   [Msn 3                       ✓ Lolos]
//   22 Nov 2026 • 01:05 • Shift 3
//   [foto][foto]  10 KG · 75 kantong (sisa 75)
//                 ✓ Kejernihan  ✓ Ukuran/Bentuk
//   Catatan ...
function KualitasCard({ kualitas }: { kualitas: KualitasRow }) {
  const items = [
    { label: "Kejernihan", pass: kualitas.CekKejernihan },
    { label: "Ukuran/Bentuk", pass: kualitas.CekUkuranBentuk },
  ];
  const allPass = items.every((i) => i.pass);
  const varian = kualitas.Variant === "10kg" ? "10 KG" : "5 KG";

  return (
    <div className={cn("flex flex-col gap-2.5 rounded-xl border bg-card p-3", !allPass && "border-destructive/40 bg-destructive/5")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-semibold leading-tight">{kualitas.MesinNama}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(kualitas.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
            {" • "}
            {kualitas.Waktu}
            {" • "}
            {SHIFT_LABEL[kualitas.Shift]}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold",
            allPass ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"
          )}
        >
          {allPass ? <Check className="size-3" /> : <X className="size-3" />}
          {allPass ? "Lolos" : "Ada temuan"}
        </span>
      </div>

      <div className="flex gap-3">
        <div className="flex shrink-0 gap-1.5">
          <FotoThumbnail path={kualitas.FotoPath} alt="Foto sampel" label="Sampel" />
          <FotoThumbnail path={kualitas.FotoBeratKemasanPath} alt="Foto berat kemasan" label="Berat" />
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <p className="flex flex-wrap items-center gap-x-1.5 text-xs">
            <span className="rounded bg-sky-500/15 px-1.5 py-0.5 text-[11px] font-semibold text-sky-600">{varian}</span>
            {kualitas.Qty10KG != null && (
              <span className="text-muted-foreground">
                <span className="font-semibold text-foreground">{kualitas.Qty10KG}</span> kantong (sisa {kualitas.SisaAlokasi})
              </span>
            )}
          </p>
          <div className="flex flex-col gap-0.5">
            {items.map((i) => (
              <span
                key={i.label}
                className={cn("inline-flex items-center gap-1 text-xs", i.pass ? "text-emerald-600" : "font-medium text-destructive")}
              >
                {i.pass ? <Check className="size-3.5 shrink-0" /> : <X className="size-3.5 shrink-0" />}
                {i.label}
              </span>
            ))}
          </div>
          {kualitas.DiameterDalamMm != null && (
            <p className="text-xs text-muted-foreground">Diameter dalam {kualitas.DiameterDalamMm} mm</p>
          )}
          <TempatHasil kualitas={kualitas} />
        </div>
      </div>

      {kualitas.Catatan && (
        <p className="rounded-md bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Catatan:</span> {kualitas.Catatan}
        </p>
      )}
    </div>
  );
}

// Dialog Tambah Pemeriksaan dibuka dari tombol tengah bilah navigasi bawah
// (ProduksiBottomNav), jadi state open-nya dipegang ProduksiTabShell.
export function KualitasView({
  initialRiwayat,
  mesinList,
  tambahOpen,
  onTambahOpenChange,
}: {
  initialRiwayat: KualitasRow[];
  mesinList: MesinRow[];
  tambahOpen: boolean;
  onTambahOpenChange: (open: boolean) => void;
}) {
  const [riwayat, setRiwayat] = useState(initialRiwayat);

  function handleSaved() {
    onTambahOpenChange(false);
    getKualitasRiwayatAction().then((result) => {
      if (result.success) setRiwayat(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-2 p-2">

      {riwayat.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Belum ada pemeriksaan kualitas.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {riwayat.map((k) => (
            <KualitasCard key={k.KualitasID} kualitas={k} />
          ))}
        </div>
      )}

      <TambahKualitasDialog open={tambahOpen} onOpenChange={onTambahOpenChange} mesinList={mesinList} onSaved={handleSaved} />
    </div>
  );
}
