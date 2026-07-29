"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { ARMADA_STATUS, type ArmadaStatus } from "@/lib/armada-status";
import { FUEL_TYPES, type FuelType } from "@/lib/armada-fuel";
import { type ArmadaRow, type ArmadaInput } from "@/lib/queries/armada";
import { type ExpeditionVehicleOption } from "@/lib/queries/expedition";
import { createArmadaAction, updateArmadaAction, deleteArmadaAction } from "@/app/(dashboard)/delivery/actions";

export const STATUS_BADGE: Record<ArmadaStatus, string> = {
  Baik: "bg-primary/15 text-primary",
  Rusak: "bg-destructive/15 text-destructive",
  Perbaikan: "bg-warning/15 text-warning",
  Tertahan: "bg-muted text-muted-foreground",
};

function emptyForm(): ArmadaInput {
  return {
    nama: "",
    platNomor: null,
    brand: null,
    model: null,
    konsumsiBBM: null,
    kapasitasMaks: null,
    status: "Baik",
    fotoPath: null,
    jenisBBM: null,
    biayaBBMPerLiter: null,
    pajakLimaTahunan: null,
    biayaPajakLimaTahunan: null,
    expeditionDetailId: null,
  };
}

export function rowToForm(row: ArmadaRow): ArmadaInput {
  return {
    nama: row.Nama,
    platNomor: row.PlatNomor,
    brand: row.Brand,
    model: row.Model,
    konsumsiBBM: row.KonsumsiBBM,
    kapasitasMaks: row.KapasitasMaks,
    status: row.Status,
    fotoPath: row.FotoPath,
    jenisBBM: row.JenisBBM,
    biayaBBMPerLiter: row.BiayaBBMPerLiter,
    pajakLimaTahunan: row.PajakLimaTahunan ? new Date(row.PajakLimaTahunan).toISOString().slice(0, 10) : null,
    biayaPajakLimaTahunan: row.BiayaPajakLimaTahunan,
    expeditionDetailId: row.ExpeditionDetailID,
  };
}

export function ArmadaFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  onSubmit,
  pending,
  error,
  expeditionOptions,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ArmadaInput;
  title: string;
  onSubmit: (input: ArmadaInput) => void;
  pending: boolean;
  error: string | null;
  expeditionOptions: ExpeditionVehicleOption[];
}) {
  const [fotoPath, setFotoPath] = useState(initial.fotoPath);
  const [status, setStatus] = useState<ArmadaStatus>(initial.status);
  const [jenisBBM, setJenisBBM] = useState<FuelType | null>(initial.jenisBBM);
  const [expeditionDetailId, setExpeditionDetailId] = useState<string | null>(initial.expeditionDetailId);
  // The actual upload is deferred until "Simpan" (see handleSubmit) instead
  // of firing on file-select — picking a photo then cancelling the dialog
  // used to POST it to /api/upload/armada-foto immediately, leaving an
  // orphaned file in public/uploads/armada/ with no ArmadaID ever
  // referencing it. selectedFile/previewUrl hold the pick locally until a
  // real save happens.
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadError(null);
    setSelectedFile(file);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(file);
    });
  }

  async function handleSubmit(formData: FormData) {
    let savedFotoPath = fotoPath;
    if (selectedFile) {
      setUploading(true);
      setUploadError(null);
      try {
        const uploadData = new FormData();
        uploadData.append("file", selectedFile);
        const res = await fetch("/api/upload/armada-foto", { method: "POST", body: uploadData });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah foto");
        savedFotoPath = data.path;
      } catch (err) {
        setUploadError(err instanceof Error ? err.message : "Gagal mengunggah foto");
        setUploading(false);
        return;
      }
      setUploading(false);
    }
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      platNomor: String(formData.get("platNomor") ?? "") || null,
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      konsumsiBBM: formData.get("konsumsiBBM") ? Number(formData.get("konsumsiBBM")) : null,
      kapasitasMaks: formData.get("kapasitasMaks") ? Number(formData.get("kapasitasMaks")) : null,
      status,
      fotoPath: savedFotoPath,
      jenisBBM,
      biayaBBMPerLiter: formData.get("biayaBBMPerLiter") ? Number(formData.get("biayaBBMPerLiter")) : null,
      pajakLimaTahunan: String(formData.get("pajakLimaTahunan") ?? "") || null,
      biayaPajakLimaTahunan: formData.get("biayaPajakLimaTahunan") ? Number(formData.get("biayaPajakLimaTahunan")) : null,
      expeditionDetailId,
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) {
          setFotoPath(initial.fotoPath);
          setStatus(initial.status);
          setJenisBBM(initial.jenisBBM);
          setExpeditionDetailId(initial.expeditionDetailId);
          setSelectedFile(null);
          setPreviewUrl((prev) => {
            if (prev) URL.revokeObjectURL(prev);
            return null;
          });
          setUploadError(null);
        }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Data kendaraan tersimpan langsung ke database MKEsindo.</DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="grid grid-cols-2 gap-3">
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="nama" className="sr-only">Nama Kendaraan</Label>
            <Input id="nama" name="nama" placeholder="Nama Kendaraan (mis. GrandMax 1972)" defaultValue={initial.nama} required />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platNomor" className="sr-only">Plat Nomor</Label>
            <Input id="platNomor" name="platNomor" placeholder="Plat Nomor" defaultValue={initial.platNomor ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as ArmadaStatus) ?? "Baik")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {ARMADA_STATUS.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand" className="sr-only">Brand</Label>
            <Input id="brand" name="brand" placeholder="Brand (mis. Daihatsu)" defaultValue={initial.brand ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="model" className="sr-only">Model</Label>
            <Input id="model" name="model" placeholder="Model (mis. GrandMax)" defaultValue={initial.model ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="konsumsiBBM" className="sr-only">Konsumsi BBM (L/km)</Label>
            <Input
              id="konsumsiBBM"
              name="konsumsiBBM"
              type="number"
              step="0.01"
              placeholder="Konsumsi BBM (L/km)"
              defaultValue={initial.konsumsiBBM ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="kapasitasMaks" className="sr-only">Kapasitas Maks (kantong)</Label>
            <Input
              id="kapasitasMaks"
              name="kapasitasMaks"
              type="number"
              placeholder="Kapasitas Maks (kantong)"
              defaultValue={initial.kapasitasMaks ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="sr-only">Jenis BBM</Label>
            <Select value={jenisBBM ?? ""} onValueChange={(v) => setJenisBBM((v as FuelType) || null)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Jenis BBM">{(v: string) => v || "Jenis BBM"}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {FUEL_TYPES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="biayaBBMPerLiter" className="sr-only">Biaya BBM/Liter (Rp)</Label>
            <Input
              id="biayaBBMPerLiter"
              name="biayaBBMPerLiter"
              type="number"
              step="1"
              placeholder="Biaya BBM/Liter (Rp)"
              defaultValue={initial.biayaBBMPerLiter ?? ""}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="pajakLimaTahunan" className="text-xs text-muted-foreground">
              Jatuh Tempo Pajak 5 Tahunan
            </Label>
            <Input id="pajakLimaTahunan" name="pajakLimaTahunan" type="date" defaultValue={initial.pajakLimaTahunan ?? ""} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="biayaPajakLimaTahunan" className="sr-only">Biaya Pajak 5 Tahunan (Rp)</Label>
            <Input
              id="biayaPajakLimaTahunan"
              name="biayaPajakLimaTahunan"
              type="number"
              step="1"
              placeholder="Biaya Pajak 5 Tahunan (Rp)"
              defaultValue={initial.biayaPajakLimaTahunan ?? ""}
            />
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">
              Kendaraan ERP (Plat Resmi)
            </Label>
            <Select
              value={expeditionDetailId ?? "none"}
              onValueChange={(v) => setExpeditionDetailId(v === "none" ? null : (v ?? null))}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Belum ditautkan">
                  {(v: string) => {
                    if (v === "none") return "Belum ditautkan";
                    const opt = expeditionOptions.find((o) => o.ExpeditionDetailID === v);
                    return opt ? `${opt.VehicleNo}${opt.Description ? ` — ${opt.Description}` : ""}` : "Belum ditautkan";
                  }}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Belum ditautkan</SelectItem>
                {expeditionOptions.map((o) => (
                  <SelectItem key={o.ExpeditionDetailID} value={o.ExpeditionDetailID}>
                    {o.VehicleNo}
                    {o.Description ? ` — ${o.Description}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              Menentukan plat nomor resmi yang tertulis di Surat Jalan (DeliveryOrder) saat armada ini berangkat.
            </p>
          </div>
          <div className="col-span-2 flex flex-col gap-1.5">
            <Label htmlFor="foto" className="text-xs text-muted-foreground">
              Foto Armada
            </Label>
            <Input
              id="foto"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              disabled={uploading}
            />
            {selectedFile && !uploading && (
              <p className="text-xs text-muted-foreground">Foto baru dipilih — diunggah saat &quot;Simpan&quot; ditekan.</p>
            )}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {(previewUrl ?? fotoPath) && !uploading && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl ?? fotoPath ?? undefined} alt="Pratinjau foto armada" className="h-24 w-24 rounded-lg object-cover" />
            )}
          </div>
          {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={pending || uploading} className="ml-auto">
              {uploading ? "Mengunggah..." : pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// "Kelola Armada" list dialog and the add/edit form dialog never open at
// the same time (no nested Dialog-inside-Dialog) — opening the form closes
// the list first, and closing the form reopens the list.
export function ArmadaManager({ armada, expeditionOptions }: { armada: ArmadaRow[]; expeditionOptions: ExpeditionVehicleOption[] }) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ArmadaRow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleCreate(input: ArmadaInput) {
    setError(null);
    startTransition(async () => {
      try {
        await createArmadaAction(input);
        setCreating(false);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function handleUpdate(input: ArmadaInput) {
    if (!editing) return;
    setError(null);
    startTransition(async () => {
      try {
        await updateArmadaAction(editing.ArmadaID, input);
        setEditing(null);
        setOpen(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan armada.");
      }
    });
  }

  function handleDelete(row: ArmadaRow) {
    if (!confirm(`Hapus armada "${row.Nama}"?`)) return;
    startTransition(async () => {
      try {
        await deleteArmadaAction(row.ArmadaID);
      } catch (err) {
        alert(err instanceof Error ? err.message : "Gagal menghapus armada.");
      }
    });
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Kelola Armada
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola Armada</DialogTitle>
            <DialogDescription>Daftar kendaraan untuk Papan Pengiriman.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3">
            <Button
              size="sm"
              className="self-end"
              onClick={() => {
                setOpen(false);
                setCreating(true);
              }}
            >
              <Plus className="size-4" />
              Tambah Armada
            </Button>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex flex-col divide-y rounded-lg border">
              {armada.map((a) => {
                const linked = expeditionOptions.find((o) => o.ExpeditionDetailID === a.ExpeditionDetailID);
                return (
                <div key={a.ArmadaID} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.Nama}</p>
                    <p className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                      {/* Real ERP plate (linked ExpeditionDetail.VehicleNo) is
                          authoritative once linked — it's what's actually
                          written onto a real DeliveryOrder — so it takes
                          priority over the dashboard's own PlatNomor field. */}
                      {linked ? linked.VehicleNo : (a.PlatNomor ?? "-")}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[a.Status])}>
                        {a.Status}
                      </span>
                      {!linked && (
                        <span className="rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                          Belum ditautkan ke ERP
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setOpen(false);
                        setEditing(a);
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button variant="ghost" size="icon" className="size-7" onClick={() => handleDelete(a)}>
                      <Trash2 className="size-3.5 text-destructive" />
                    </Button>
                  </div>
                </div>
                );
              })}
              {armada.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Belum ada armada.</p>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {creating && (
        <ArmadaFormDialog
          open={creating}
          onOpenChange={(next) => {
            setCreating(next);
            if (!next) setOpen(true);
          }}
          initial={emptyForm()}
          title="Tambah Armada"
          onSubmit={handleCreate}
          pending={pending}
          error={error}
          expeditionOptions={expeditionOptions}
        />
      )}
      {editing && (
        <ArmadaFormDialog
          open={!!editing}
          onOpenChange={(next) => {
            if (!next) {
              setEditing(null);
              setOpen(true);
            }
          }}
          initial={rowToForm(editing)}
          title={`Edit Armada — ${editing.Nama}`}
          onSubmit={handleUpdate}
          pending={pending}
          error={error}
          expeditionOptions={expeditionOptions}
        />
      )}
    </>
  );
}
