"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Trash2 } from "lucide-react";
import type { AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { tambahAnggotaTimAction, hapusAnggotaTimAction, setKehadiranAction } from "@/app/mkesindo/produksi/actions";

export function TimProduksiRoster({
  tanggalUsaha,
  shift,
  timAnggota,
  kehadiran,
  canEdit,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  timAnggota: AnggotaTimRow[];
  kehadiran: number[];
  canEdit: boolean;
  onChanged: () => void;
}) {
  const [namaBaru, setNamaBaru] = useState("");
  const [checked, setChecked] = useState<Set<number>>(new Set(kehadiran));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function toggleHadir(anggotaId: number) {
    if (!canEdit) return;
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(anggotaId)) next.delete(anggotaId);
      else next.add(anggotaId);
      return next;
    });
  }

  function handleSimpanKehadiran() {
    setError(null);
    startTransition(async () => {
      const result = await setKehadiranAction(tanggalUsaha, shift, [...checked]);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  function handleTambahAnggota() {
    if (!namaBaru.trim()) return;
    setError(null);
    startTransition(async () => {
      const result = await tambahAnggotaTimAction(shift, namaBaru.trim());
      if (!result.success) {
        setError(result.error);
        return;
      }
      setNamaBaru("");
      onChanged();
    });
  }

  function handleHapusAnggota(anggotaId: number) {
    setError(null);
    startTransition(async () => {
      const result = await hapusAnggotaTimAction(anggotaId);
      if (!result.success) {
        setError(result.error);
        return;
      }
      onChanged();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Tim Produksi (Shift {shift})</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-2">
          {timAnggota.map((a) => (
            <div key={a.anggotaId} className="flex items-center gap-2">
              <input
                type="checkbox"
                className="accent-primary"
                checked={checked.has(a.anggotaId)}
                onChange={() => toggleHadir(a.anggotaId)}
                disabled={!canEdit}
              />
              <span className="flex-1 text-sm">{a.nama}</span>
              <Button variant="ghost" size="icon" className="size-6" disabled={pending} onClick={() => handleHapusAnggota(a.anggotaId)}>
                <Trash2 className="size-3.5 text-destructive" />
              </Button>
            </div>
          ))}
          {timAnggota.length === 0 && <p className="text-xs text-muted-foreground">Belum ada anggota di tim ini.</p>}
        </div>
        {canEdit && (
          <Button size="sm" className="w-fit" disabled={pending} onClick={handleSimpanKehadiran}>
            Simpan Kehadiran
          </Button>
        )}
        <div className="flex gap-2">
          <Input placeholder="Nama anggota baru" value={namaBaru} onChange={(e) => setNamaBaru(e.target.value)} />
          <Button size="sm" variant="outline" disabled={pending} onClick={handleTambahAnggota}>
            Tambah
          </Button>
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
