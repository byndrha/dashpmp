"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { cn } from "@/lib/utils";
import { getBusinessDateISO } from "@/lib/business-date";
import { SHIFT_LABEL } from "@/lib/produksi-shift";
import { STATUS_MESIN_LABEL } from "@/lib/produksi-mesin-status";
import { createKualitasAction, getKualitasRiwayatAction } from "@/app/mkesindo/produksi/actions";
import type { KualitasRow } from "@/lib/queries/produksi-kualitas";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

const SHIFT_OPTIONS = [1, 2, 3] as const;

// The 4-item pass/fail checklist agreed for this form's first version —
// Kejernihan Es, Ukuran/Bentuk Sesuai, Bebas Kontaminasi/Benda Asing,
// Kemasan Rapi. Each defaults to "Lolos" (true) rather than forcing every
// entry to explicitly confirm all four every time — an operator only needs
// to touch the items that actually failed.
const CHECKLIST_ITEMS = [
  { key: "cekKejernihan", label: "Kejernihan Es" },
  { key: "cekUkuranBentuk", label: "Ukuran/Bentuk Sesuai" },
  { key: "cekKontaminasi", label: "Bebas Kontaminasi/Benda Asing" },
  { key: "cekKemasan", label: "Kemasan Rapi" },
] as const;

type ChecklistKey = (typeof CHECKLIST_ITEMS)[number]["key"];
type ChecklistState = Record<ChecklistKey, boolean>;

const DEFAULT_CHECKLIST: ChecklistState = {
  cekKejernihan: true,
  cekUkuranBentuk: true,
  cekKontaminasi: true,
  cekKemasan: true,
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
  const [waktu, setWaktu] = useState("");
  const [shift, setShift] = useState<string>("1");
  const [mesinId, setMesinId] = useState<string>("");
  const [checklist, setChecklist] = useState<ChecklistState>(DEFAULT_CHECKLIST);
  const [suhuEs, setSuhuEs] = useState("");
  const [beratSampel, setBeratSampel] = useState("");
  const [catatan, setCatatan] = useState("");
  const [fotoPath, setFotoPath] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function reset() {
    setTanggalLabel(getBusinessDateISO());
    setWaktu("");
    setShift("1");
    setMesinId("");
    setChecklist(DEFAULT_CHECKLIST);
    setSuhuEs("");
    setBeratSampel("");
    setCatatan("");
    setFotoPath(null);
    setError(null);
  }

  async function handleCapture(file: File) {
    setError(null);
    setUploading(true);
    try {
      const path = await uploadFotoKualitas(file);
      setFotoPath(path);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(false);
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
    startTransition(async () => {
      const result = await createKualitasAction({
        tanggalLabel,
        waktu,
        shift: Number(shift) as 1 | 2 | 3,
        mesinId: Number(mesinId),
        cekKejernihan: checklist.cekKejernihan,
        cekUkuranBentuk: checklist.cekUkuranBentuk,
        cekKontaminasi: checklist.cekKontaminasi,
        cekKemasan: checklist.cekKemasan,
        suhuEs: suhuEs.trim() ? Number(suhuEs) : null,
        beratSampel: beratSampel.trim() ? Number(beratSampel) : null,
        catatan: catatan.trim() || null,
        fotoPath,
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
          <div className="grid grid-cols-[1fr_98px] gap-0">
            <div>
              <Input type="date" value={tanggalLabel} onChange={(e) => setTanggalLabel(e.target.value)} />
            </div>
            <div>
              <Input type="time" value={waktu} onChange={(e) => setWaktu(e.target.value)} />
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
              <label className="text-xs font-medium text-muted-foreground">Suhu Es (°C)</label>
              <Input type="number" step="0.1" value={suhuEs} onChange={(e) => setSuhuEs(e.target.value)} className="mt-1" />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Berat Sampel (gram)</label>
              <Input type="number" step="0.1" value={beratSampel} onChange={(e) => setBeratSampel(e.target.value)} className="mt-1" />
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
              />
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button disabled={pending || uploading} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function KualitasCard({ kualitas }: { kualitas: KualitasRow }) {
  const items = [
    { label: "Kejernihan", pass: kualitas.CekKejernihan },
    { label: "Ukuran/Bentuk", pass: kualitas.CekUkuranBentuk },
    { label: "Kontaminasi", pass: kualitas.CekKontaminasi },
    { label: "Kemasan", pass: kualitas.CekKemasan },
  ];
  const allPass = items.every((i) => i.pass);

  return (
    <div className={cn("rounded-lg border p-3", !allPass && "border-destructive/40 bg-destructive/5")}>
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold">{kualitas.MesinNama}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(kualitas.TanggalLabel).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
            {" • "}
            {kualitas.Waktu}
            {" • "}
            {SHIFT_LABEL[kualitas.Shift]}
          </p>
        </div>
        {!allPass && (
          <span className="shrink-0 rounded bg-destructive/15 px-2 py-0.5 text-xs font-medium text-destructive">
            Ada temuan
          </span>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((i) => (
          <span
            key={i.label}
            className={cn(
              "rounded px-2 py-0.5 text-[11px] font-medium",
              i.pass ? "bg-emerald-500/15 text-emerald-600" : "bg-destructive/15 text-destructive"
            )}
          >
            {i.label}: {i.pass ? "Lolos" : "Tidak"}
          </span>
        ))}
      </div>
      {(kualitas.SuhuEs != null || kualitas.BeratSampel != null) && (
        <p className="mt-1.5 text-xs text-muted-foreground">
          {kualitas.SuhuEs != null && `Suhu: ${kualitas.SuhuEs}°C`}
          {kualitas.SuhuEs != null && kualitas.BeratSampel != null && " • "}
          {kualitas.BeratSampel != null && `Berat sampel: ${kualitas.BeratSampel}g`}
        </p>
      )}
      {kualitas.Catatan && <p className="mt-1.5 text-xs text-muted-foreground">Catatan: {kualitas.Catatan}</p>}
      {kualitas.FotoPath && (
        // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
        <img src={kualitas.FotoPath} alt="Foto sampel" className="mt-2 h-20 w-20 rounded object-cover" />
      )}
    </div>
  );
}

export function KualitasView({
  initialRiwayat,
  mesinList,
}: {
  initialRiwayat: KualitasRow[];
  mesinList: MesinRow[];
}) {
  const [riwayat, setRiwayat] = useState(initialRiwayat);
  const [open, setOpen] = useState(false);

  function handleSaved() {
    setOpen(false);
    getKualitasRiwayatAction().then((result) => {
      if (result.success) setRiwayat(result.data);
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button onClick={() => setOpen(true)} className="w-fit gap-1.5">
        <Plus className="size-4" />
        Tambah Pemeriksaan
      </Button>

      {riwayat.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">Belum ada pemeriksaan kualitas.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {riwayat.map((k) => (
            <KualitasCard key={k.KualitasID} kualitas={k} />
          ))}
        </div>
      )}

      <TambahKualitasDialog open={open} onOpenChange={setOpen} mesinList={mesinList} onSaved={handleSaved} />
    </div>
  );
}
