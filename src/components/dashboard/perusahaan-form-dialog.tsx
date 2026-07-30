"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import { PERUSAHAAN_STATUSES, type PerusahaanStatus, PERUSAHAAN_JENIS_BISNIS, type PerusahaanJenisBisnis } from "@/lib/perusahaan-status";
import type { PerusahaanRow, PerusahaanInput } from "@/lib/queries/perusahaan";

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

function emptyForm(): PerusahaanInput {
  return {
    nama: "",
    jenisBisnis: "Es Kristal",
    wilayah: null,
    pabrikLatitude: null,
    pabrikLongitude: null,
    pabrikAlamat: null,
    status: "Draft",
    standaloneUrl: null,
    dbServer: null,
    dbPort: null,
    dbName: null,
    dbUser: null,
    dbPassword: null,
    catatan: null,
  };
}

function rowToForm(row: PerusahaanRow): PerusahaanInput {
  return {
    nama: row.Nama,
    jenisBisnis: row.JenisBisnis,
    wilayah: row.Wilayah,
    pabrikLatitude: row.PabrikLatitude,
    pabrikLongitude: row.PabrikLongitude,
    pabrikAlamat: row.PabrikAlamat,
    status: row.Status,
    standaloneUrl: row.StandaloneUrl,
    dbServer: row.DbServer,
    dbPort: row.DbPort,
    dbName: row.DbName,
    dbUser: row.DbUser,
    dbPassword: null, // never pre-filled — write-only field
    catatan: row.Catatan,
  };
}

// `target`: "new" for the create dialog, a PerusahaanRow for edit, null to
// stay closed — matches the externally-controlled dialog pattern already
// used by UbahPemesananDialog/ArmadaManager's form dialogs in this codebase.
export function PerusahaanFormDialog({
  target,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  target: PerusahaanRow | "new" | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PerusahaanInput) => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = target === "new" ? emptyForm() : target ? rowToForm(target) : emptyForm();
  const [status, setStatus] = useState<PerusahaanStatus>(initial.status);
  const [jenisBisnis, setJenisBisnis] = useState<PerusahaanJenisBisnis>(initial.jenisBisnis ?? "Es Kristal");
  const [location, setLocation] = useState<MitraLocationValue | null>(
    initial.pabrikLatitude != null && initial.pabrikLongitude != null
      ? { latitude: initial.pabrikLatitude, longitude: initial.pabrikLongitude, alamat: initial.pabrikAlamat }
      : null
  );

  function handleSubmit(formData: FormData) {
    onSubmit({
      nama: String(formData.get("nama") ?? ""),
      jenisBisnis,
      wilayah: String(formData.get("wilayah") ?? "") || null,
      pabrikLatitude: location?.latitude ?? null,
      pabrikLongitude: location?.longitude ?? null,
      pabrikAlamat: location?.alamat ?? null,
      status,
      standaloneUrl: String(formData.get("standaloneUrl") ?? "") || null,
      dbServer: String(formData.get("dbServer") ?? "") || null,
      dbPort: formData.get("dbPort") ? Number(formData.get("dbPort")) : null,
      dbName: String(formData.get("dbName") ?? "") || null,
      dbUser: String(formData.get("dbUser") ?? "") || null,
      dbPassword: String(formData.get("dbPassword") ?? "") || null,
      catatan: String(formData.get("catatan") ?? "") || null,
    });
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target === "new" ? "Tambah PT" : `Ubah PT — ${initial.nama}`}</DialogTitle>
          <DialogDescription>
            Data registry perusahaan — belum menghubungkan dashboard ini ke database PT lain.
          </DialogDescription>
        </DialogHeader>
        <form action={handleSubmit} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="nama">Nama PT</Label>
            <Input id="nama" name="nama" defaultValue={initial.nama} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Jenis Bisnis</Label>
              <Select value={jenisBisnis} onValueChange={(v) => setJenisBisnis((v as PerusahaanJenisBisnis) ?? "Es Kristal")}>
                <SelectTrigger className="w-full">
                  <SelectValue>{(v: string) => v}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {PERUSAHAAN_JENIS_BISNIS.map((jb) => (
                    <SelectItem key={jb} value={jb}>
                      {jb}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="wilayah">Wilayah</Label>
              <Input id="wilayah" name="wilayah" placeholder="mis. Ponorogo" defaultValue={initial.wilayah ?? ""} />
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>Status</Label>
            <Select value={status} onValueChange={(v) => setStatus((v as PerusahaanStatus) ?? "Draft")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => STATUS_LABEL[v as PerusahaanStatus]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PERUSAHAAN_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {status === "StandaloneHTML" && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="standaloneUrl">URL Standalone</Label>
              <Input
                id="standaloneUrl"
                name="standaloneUrl"
                placeholder="/static/nama-pt"
                defaultValue={initial.standaloneUrl ?? ""}
                required
              />
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Lokasi Pabrik</Label>
            <MitraLocationField value={location} onChange={setLocation} wilayah={initial.wilayah} />
          </div>

          <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
            <legend className="px-1 text-xs font-medium text-muted-foreground">
              Kredensial Database (opsional, untuk dashboard PT ini nanti)
            </legend>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbServer">Server / IP</Label>
                <Input id="dbServer" name="dbServer" defaultValue={initial.dbServer ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbPort">Port</Label>
                <Input id="dbPort" name="dbPort" type="number" defaultValue={initial.dbPort ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbName">Nama Database</Label>
                <Input id="dbName" name="dbName" defaultValue={initial.dbName ?? ""} />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="dbUser">Username</Label>
                <Input id="dbUser" name="dbUser" defaultValue={initial.dbUser ?? ""} />
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="dbPassword">Password</Label>
              <Input
                id="dbPassword"
                name="dbPassword"
                type="password"
                placeholder={target !== "new" ? "(tidak diubah, kosongkan untuk tetap pakai yang lama)" : ""}
              />
            </div>
          </fieldset>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="catatan">Catatan</Label>
            <Textarea id="catatan" name="catatan" rows={2} defaultValue={initial.catatan ?? ""} />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          <DialogFooter>
            <Button type="submit" disabled={pending} className="ml-auto">
              {pending ? "Menyimpan..." : "Simpan"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
