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
import type { PerusahaanDirektoriOption } from "@/lib/queries/akun-direktori";
import type { KoneksiRow, UpsertKoneksiInput } from "@/lib/queries/perusahaan-koneksi";

const STATUS_LABEL: Record<PerusahaanStatus, string> = {
  Draft: "Draft",
  StandaloneHTML: "Standalone HTML",
  AktifPenuh: "Aktif Penuh",
};

// Es Kristal companies have one MSSQL database; Es Balok companies (PT
// Prima Maesa Putra's shape) have two — see docs/superpowers/specs/
// 2026-07-30-perusahaan-db-koneksi-design.md, "UI connection-block count
// follows Jenis Bisnis" decision. Not a generic add/remove list.
const KONEKSI_LABELS_BY_JENIS: Record<PerusahaanJenisBisnis, string[]> = {
  "Es Kristal": ["utama"],
  "Es Balok": ["utama", "logistik"],
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
    kode: null,
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
    kode: row.Kode,
    dbServer: row.DbServer,
    dbPort: row.DbPort,
    dbName: row.DbName,
    dbUser: row.DbUser,
    dbPassword: null, // never pre-filled — write-only field
    catatan: row.Catatan,
  };
}

// `target`: "new" for the create dialog, a PerusahaanRow for edit, null to
// stay closed. `onSubmit` now also receives the connection blocks the user
// filled in (empty array if not linked to a Postgres perusahaan, or if the
// user left every block untouched).
export function PerusahaanFormDialog({
  target,
  perusahaanDirektoriOptions,
  existingKoneksi,
  onOpenChange,
  onSubmit,
  pending,
  error,
}: {
  target: PerusahaanRow | "new" | null;
  perusahaanDirektoriOptions: PerusahaanDirektoriOption[];
  existingKoneksi: KoneksiRow[];
  onOpenChange: (open: boolean) => void;
  onSubmit: (input: PerusahaanInput, koneksiBlocks: UpsertKoneksiInput[]) => void;
  pending: boolean;
  error: string | null;
}) {
  const initial = target === "new" ? emptyForm() : target ? rowToForm(target) : emptyForm();
  const [status, setStatus] = useState<PerusahaanStatus>(initial.status);
  const [jenisBisnis, setJenisBisnis] = useState<PerusahaanJenisBisnis>(initial.jenisBisnis === "Es Balok" ? "Es Balok" : "Es Kristal");
  const [direktoriId, setDirektoriId] = useState<number | null>(
    perusahaanDirektoriOptions.find((o) => o.kode === initial.kode)?.id ?? null
  );
  const [location, setLocation] = useState<MitraLocationValue | null>(
    initial.pabrikLatitude != null && initial.pabrikLongitude != null
      ? { latitude: initial.pabrikLatitude, longitude: initial.pabrikLongitude, alamat: initial.pabrikAlamat }
      : null
  );

  const koneksiLabels = KONEKSI_LABELS_BY_JENIS[jenisBisnis];
  const linkedKoneksi = direktoriId != null ? existingKoneksi.filter((k) => k.perusahaanId === direktoriId) : [];

  function handleSubmit(formData: FormData) {
    const kode = perusahaanDirektoriOptions.find((o) => o.id === direktoriId)?.kode ?? null;

    const koneksiBlocks: UpsertKoneksiInput[] = [];
    if (direktoriId != null) {
      for (const label of koneksiLabels) {
        const host = String(formData.get(`koneksi_${label}_host`) ?? "").trim();
        if (!host) continue; // untouched block — nothing to save
        const portRaw = formData.get(`koneksi_${label}_port`);
        const port = portRaw && String(portRaw).trim() ? Number(portRaw) : 1433;
        koneksiBlocks.push({
          perusahaanId: direktoriId,
          label,
          host,
          port,
          dbName: String(formData.get(`koneksi_${label}_dbName`) ?? ""),
          dbUser: String(formData.get(`koneksi_${label}_dbUser`) ?? ""),
          dbPassword: String(formData.get(`koneksi_${label}_dbPassword`) ?? "") || null,
        });
      }
    }

    onSubmit(
      {
        nama: String(formData.get("nama") ?? ""),
        jenisBisnis,
        wilayah: String(formData.get("wilayah") ?? "") || null,
        pabrikLatitude: location?.latitude ?? null,
        pabrikLongitude: location?.longitude ?? null,
        pabrikAlamat: location?.alamat ?? null,
        status,
        standaloneUrl: String(formData.get("standaloneUrl") ?? "") || null,
        kode,
        dbServer: initial.dbServer,
        dbPort: initial.dbPort,
        dbName: initial.dbName,
        dbUser: initial.dbUser,
        dbPassword: null,
        catatan: String(formData.get("catatan") ?? "") || null,
      },
      koneksiBlocks
    );
  }

  return (
    <Dialog open={target != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{target === "new" ? "Tambah PT" : `Ubah PT — ${initial.nama}`}</DialogTitle>
          <DialogDescription>
            Data registry perusahaan. Tautkan ke Perusahaan (Postgres) untuk mengatur koneksi database live.
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
            <legend className="px-1 text-xs font-medium text-muted-foreground">Tautan &amp; Koneksi Database</legend>
            <div className="flex flex-col gap-1.5">
              <Label>Tautan ke Perusahaan (Postgres)</Label>
              <Select
                value={direktoriId != null ? String(direktoriId) : "none"}
                onValueChange={(v) => setDirektoriId(v === "none" ? null : Number(v))}
              >
                <SelectTrigger className="w-full">
                  <SelectValue>
                    {() => perusahaanDirektoriOptions.find((o) => o.id === direktoriId)?.nama ?? "Belum ditautkan"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Belum ditautkan</SelectItem>
                  {perusahaanDirektoriOptions.map((o) => (
                    <SelectItem key={o.id} value={String(o.id)}>
                      {o.nama}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {direktoriId == null && (
              <p className="text-xs text-muted-foreground">
                Tautkan ke salah satu Perusahaan di atas untuk mengatur koneksi database.
              </p>
            )}

            {direktoriId != null &&
              koneksiLabels.map((label) => {
                const existing = linkedKoneksi.find((k) => k.label === label);
                return (
                  <div key={label} className="flex flex-col gap-2 rounded-md border p-2.5">
                    <p className="text-xs font-medium capitalize">Koneksi {label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_host`}>
                          Host
                        </Label>
                        <Input
                          id={`koneksi_${label}_host`}
                          name={`koneksi_${label}_host`}
                          defaultValue={existing?.host ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_port`}>
                          Port
                        </Label>
                        <Input
                          id={`koneksi_${label}_port`}
                          name={`koneksi_${label}_port`}
                          type="number"
                          defaultValue={existing?.port ?? 1433}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_dbName`}>
                          Nama Database
                        </Label>
                        <Input
                          id={`koneksi_${label}_dbName`}
                          name={`koneksi_${label}_dbName`}
                          defaultValue={existing?.dbName ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                      <div className="flex flex-col gap-1">
                        <Label className="text-xs" htmlFor={`koneksi_${label}_dbUser`}>
                          Username
                        </Label>
                        <Input
                          id={`koneksi_${label}_dbUser`}
                          name={`koneksi_${label}_dbUser`}
                          defaultValue={existing?.dbUser ?? ""}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Label className="text-xs" htmlFor={`koneksi_${label}_dbPassword`}>
                        Password
                      </Label>
                      <Input
                        id={`koneksi_${label}_dbPassword`}
                        name={`koneksi_${label}_dbPassword`}
                        type="password"
                        placeholder={existing ? "(tidak diubah, kosongkan untuk tetap pakai yang lama)" : "wajib diisi untuk koneksi baru"}
                        className="h-8 text-xs"
                      />
                    </div>
                  </div>
                );
              })}
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
