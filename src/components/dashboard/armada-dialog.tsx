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
import { type ArmadaRow, type ArmadaInput } from "@/lib/queries/armada";
import { createArmadaAction, updateArmadaAction, deleteArmadaAction } from "@/app/(dashboard)/delivery/actions";

const STATUS_BADGE: Record<ArmadaStatus, string> = {
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
  };
}

function rowToForm(row: ArmadaRow): ArmadaInput {
  return {
    nama: row.Nama,
    platNomor: row.PlatNomor,
    brand: row.Brand,
    model: row.Model,
    konsumsiBBM: row.KonsumsiBBM,
    kapasitasMaks: row.KapasitasMaks,
    status: row.Status,
    fotoPath: row.FotoPath,
  };
}

function ArmadaFormDialog({
  open,
  onOpenChange,
  initial,
  title,
  onSubmit,
  pending,
  error,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial: ArmadaInput;
  title: string;
  onSubmit: (input: ArmadaInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const [fotoPath, setFotoPath] = useState(initial.fotoPath);
  const [status, setStatus] = useState<ArmadaStatus>(initial.status);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/upload/armada-foto", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah foto");
      setFotoPath(data.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah foto");
    } finally {
      setUploading(false);
    }
  }

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      platNomor: String(formData.get("platNomor") ?? "") || null,
      brand: String(formData.get("brand") ?? "") || null,
      model: String(formData.get("model") ?? "") || null,
      konsumsiBBM: formData.get("konsumsiBBM") ? Number(formData.get("konsumsiBBM")) : null,
      kapasitasMaks: formData.get("kapasitasMaks") ? Number(formData.get("kapasitasMaks")) : null,
      status,
      fotoPath,
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
            {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
            {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            {fotoPath && !uploading && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fotoPath} alt="Pratinjau foto armada" className="h-24 w-24 rounded-lg object-cover" />
            )}
          </div>
          {error && <p className="col-span-2 text-xs text-destructive">{error}</p>}
          <DialogFooter className="col-span-2">
            <Button type="submit" disabled={pending || uploading} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
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
export function ArmadaManager({ armada }: { armada: ArmadaRow[] }) {
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
              {armada.map((a) => (
                <div key={a.ArmadaID} className="flex items-center justify-between gap-2 px-3 py-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.Nama}</p>
                    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      {a.PlatNomor ?? "-"}
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", STATUS_BADGE[a.Status])}>
                        {a.Status}
                      </span>
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
              ))}
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
        />
      )}
    </>
  );
}
