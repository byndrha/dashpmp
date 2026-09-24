// src/components/dashboard/mitra-es-balok-form-dialog.tsx
"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AgenLocationField, type AgenLocationValue } from "@/components/dashboard/agen-location-field";
import type { MitraInput, SumberAgen, WilayahOption } from "@/lib/queries/mitra-es-balok";

export function emptyMitraForm(): MitraInput {
  return { nama: "", telepon: "", wilayahId: null, alamat: "", hargaBalokKecil: 0, hargaBalokBesar: 0, maksimumHutang: 0 };
}

export function MitraEsBalokFormDialog({
  open,
  onOpenChange,
  kode,
  mode,
  initial,
  initialSumber,
  initialLocation,
  wilayahOptions,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  kode: string;
  mode: "create" | "edit";
  initial: MitraInput;
  initialSumber: SumberAgen;
  initialLocation: AgenLocationValue | null;
  wilayahOptions: WilayahOption[];
  onSubmit: (input: MitraInput, sumber: SumberAgen, location: AgenLocationValue | null) => Promise<void>;
}) {
  const [form, setForm] = useState<MitraInput>(initial);
  const [sumber, setSumber] = useState<SumberAgen>(initialSumber);
  const [location, setLocation] = useState<AgenLocationValue | null>(initialLocation);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const needsSumberChoice = kode !== "pmputra";

  useEffect(() => {
    if (open) {
      // Resets the form to the caller-supplied initial values every time the
      // dialog is opened — not derivable from render since these are
      // user-editable fields, not synced from any prop while the dialog is open.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setForm(initial);
      setSumber(initialSumber);
      setLocation(initialLocation);
      setFormError(null);
    }
  }, [open, initial, initialSumber, initialLocation]);

  async function handleSubmit() {
    setSubmitting(true);
    setFormError(null);
    try {
      await onSubmit(form, sumber, location);
      onOpenChange(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : "Gagal menyimpan Mitra.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Tambah Mitra" : "Edit Mitra"}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {needsSumberChoice && mode === "create" && (
            <div className="flex flex-col gap-1.5">
              <Label>Sumber</Label>
              <Select value={sumber} onValueChange={(v) => setSumber((v ?? "utama") as SumberAgen)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utama">Utama</SelectItem>
                  <SelectItem value="logistik">Logistik (Bersama)</SelectItem>
                </SelectContent>
              </Select>
              {sumber === "logistik" && (
                <p className="text-xs text-warning">
                  Mitra baru ini akan otomatis muncul juga di modul Mitra perusahaan pasangan ({kode === "pmpersada" ? "pmpakis" : "pmpersada"}),
                  karena keduanya menulis ke database fisik yang sama.
                </p>
              )}
            </div>
          )}

          <div className="flex flex-col gap-1.5">
            <Label>Nama</Label>
            <Input value={form.nama} onChange={(e) => setForm({ ...form, nama: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Telepon</Label>
            <Input value={form.telepon} onChange={(e) => setForm({ ...form, telepon: e.target.value })} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Wilayah</Label>
            <Select
              value={form.wilayahId ?? "__none__"}
              onValueChange={(v) => setForm({ ...form, wilayahId: !v || v === "__none__" ? null : v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Pilih Wilayah" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Tidak ada</SelectItem>
                {wilayahOptions.map((w) => (
                  <SelectItem key={w.wilayahId} value={w.wilayahId}>
                    {w.nama}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Alamat</Label>
            <Input value={form.alamat} onChange={(e) => setForm({ ...form, alamat: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label>Harga Balok Kecil</Label>
              <Input
                type="number"
                value={form.hargaBalokKecil}
                onChange={(e) => setForm({ ...form, hargaBalokKecil: Number(e.target.value) })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label>Harga Balok Besar</Label>
              <Input
                type="number"
                value={form.hargaBalokBesar}
                onChange={(e) => setForm({ ...form, hargaBalokBesar: Number(e.target.value) })}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>Batas Hutang</Label>
            <Input
              type="number"
              value={form.maksimumHutang}
              onChange={(e) => setForm({ ...form, maksimumHutang: Number(e.target.value) })}
            />
          </div>

          <AgenLocationField value={location} onChange={setLocation} />

          {formError && <p className="text-sm text-destructive">{formError}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Batal
          </Button>
          <Button onClick={handleSubmit} disabled={submitting || !form.nama}>
            Simpan
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
