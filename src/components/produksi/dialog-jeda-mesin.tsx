"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { konfirmasi } from "@/components/konfirmasi";
import { simpanJedaMesinAction, hapusJedaMesinAction } from "@/app/mkesindo/produksi/actions";
import { PENYEBAB_JEDA, PENYEBAB_JEDA_LABEL, type PenyebabJeda } from "@/lib/produksi-mesin-jeda";

// Isi awal dialog: catatan baru dari tombol "+" (rentang = jeda antar dua
// kartu) atau catatan yang sudah ada (klik pilnya).
export interface DraftJeda {
  jedaId: number | null;
  mesinId: number;
  mesinNama: string;
  waktuMulai: string; // "YYYY-MM-DDTHH:mm" naive-WIB
  waktuSelesai: string;
  penyebab: PenyebabJeda;
  keterangan: string;
}

function durasiMenit(mulai: string, selesai: string): number {
  return Math.round((Date.parse(`${selesai}:00Z`) - Date.parse(`${mulai}:00Z`)) / 60_000);
}

function formatDurasi(menit: number): string {
  if (!(menit > 0)) return "-";
  const j = Math.floor(menit / 60);
  const m = menit % 60;
  return j ? (m ? `${j} jam ${m} menit` : `${j} jam`) : `${m} menit`;
}

// Induk memberi `key` baru setiap kali dialog dibuka, jadi state isian
// selalu mulai dari draft terbaru.
export function DialogJedaMesin({ draft, onTutup }: { draft: DraftJeda | null; onTutup: () => void }) {
  const [isi, setIsi] = useState<DraftJeda | null>(draft);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!isi) return null;
  const set = <K extends keyof DraftJeda>(k: K, v: DraftJeda[K]) => setIsi({ ...isi, [k]: v });
  const durasi = durasiMenit(isi.waktuMulai, isi.waktuSelesai);

  function simpan() {
    if (!isi) return;
    setError(null);
    startTransition(async () => {
      const r = await simpanJedaMesinAction(isi.jedaId, {
        mesinId: isi.mesinId,
        waktuMulai: isi.waktuMulai,
        waktuSelesai: isi.waktuSelesai,
        penyebab: isi.penyebab,
        keterangan: isi.keterangan,
      });
      if (!r.success) {
        setError(r.error);
        return;
      }
      onTutup();
    });
  }

  async function hapus() {
    if (!isi?.jedaId) return;
    const ok = await konfirmasi("Hapus catatan jeda ini?", {
      keterangan: `${PENYEBAB_JEDA_LABEL[isi.penyebab]} · ${isi.mesinNama}`,
      tombol: "Hapus",
      bahaya: true,
    });
    if (!ok) return;
    const id = isi.jedaId;
    startTransition(async () => {
      const r = await hapusJedaMesinAction(id);
      if (!r.success) {
        setError(r.error);
        return;
      }
      onTutup();
    });
  }

  return (
    <Dialog open={draft != null} onOpenChange={(buka) => !buka && onTutup()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isi.jedaId ? "Ubah Catatan Jeda" : "Catat Penyebab Jeda"}</DialogTitle>
          <DialogDescription>
            {isi.mesinNama} — kenapa mesin tidak berproduksi pada rentang waktu ini?
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label>Sejak</Label>
              <Input type="datetime-local" value={isi.waktuMulai} onChange={(e) => set("waktuMulai", e.target.value)} />
            </div>
            <div>
              <Label>Hingga</Label>
              <Input type="datetime-local" value={isi.waktuSelesai} onChange={(e) => set("waktuSelesai", e.target.value)} />
            </div>
          </div>
          <p className="-mt-1 text-xs text-muted-foreground">
            Durasi: <b className="text-foreground">{formatDurasi(durasi)}</b>
          </p>
          <div>
            <Label>Penyebab</Label>
            <Select value={isi.penyebab} onValueChange={(v) => v && set("penyebab", v as PenyebabJeda)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Pilih penyebab">{(v: string) => PENYEBAB_JEDA_LABEL[v as PenyebabJeda]}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PENYEBAB_JEDA.map((p) => (
                  <SelectItem key={p} value={p}>
                    {PENYEBAB_JEDA_LABEL[p]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>{isi.penyebab === "LAINNYA" ? "Aktivitas (wajib)" : "Keterangan (opsional)"}</Label>
            <Textarea
              rows={3}
              maxLength={500}
              value={isi.keterangan}
              onChange={(e) => set("keterangan", e.target.value)}
              placeholder={
                isi.penyebab === "LAINNYA"
                  ? "mis. Rapat tim, pemadaman PLN, menunggu bahan..."
                  : "mis. ganti seal kompresor, pipa amonia bocor..."
              }
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            Satu jeda boleh punya beberapa catatan (mis. 10.20–10.50 perbaikan, lalu 10.50–11.10 pembersihan).
          </p>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {isi.jedaId ? (
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={hapus} disabled={pending}>
              <Trash2 className="size-4" />
              Hapus
            </Button>
          ) : (
            <span />
          )}
          <Button onClick={simpan} disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
