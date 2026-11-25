"use client";

import { useState, useTransition } from "react";
import { Package, Zap, Timer, PackageCheck, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { updateMesinAction, createMesinAction } from "@/app/mkesindo/produksi/actions";
import { STATUS_MESIN_LABEL, type StatusMesin } from "@/lib/produksi-mesin-status";
import type { MesinRow } from "@/lib/queries/produksi-mesin";

const STATUS_OPTIONS: StatusMesin[] = ["AKTIF", "MAINTENANCE", "RUSAK"];

const STATUS_BADGE_CLASS: Record<StatusMesin, string> = {
  AKTIF: "bg-emerald-500/15 text-emerald-600",
  MAINTENANCE: "bg-amber-500/15 text-amber-600",
  RUSAK: "bg-destructive/15 text-destructive",
};

export function PanelMesin({ mesinList }: { mesinList: MesinRow[] }) {
  // Tampilkan Mesin 3 -> 2 -> 1 (kebalikan urutan query yang ascending
  // MesinID) sesuai permintaan user 2026-09-19 -- murni urutan tampil,
  // tidak mengubah ORDER BY di query supaya konsumen getMesinList lain
  // (produksi-app, laporan-shift-detail) tidak ikut terdampak.
  const urutanTampil = [...mesinList].reverse();
  return (
    <div className="relative flex flex-wrap gap-3">
      {urutanTampil.map((mesin) => (
        <MesinCard key={mesin.MesinID} mesin={mesin} />
      ))}
      <TambahMesinCard mesinList={mesinList} />
    </div>
  );
}

interface NilaiFormMesin {
  nama: string;
  status: StatusMesin;
  kapasitas: string;
  listrik: string;
  lamaProduksi: string;
  lamaKemas: string;
}

function nilaiDariMesin(mesin: MesinRow): NilaiFormMesin {
  return {
    nama: mesin.Nama,
    status: mesin.Status,
    kapasitas: String(mesin.KapasitasProduksiPerHari),
    listrik: String(mesin.KonsumsiListrikKWh),
    lamaProduksi: String(mesin.LamaProduksiMenit),
    lamaKemas: String(mesin.LamaPengemasanMenit),
  };
}

// Mesin baru: nama berikutnya ("Mesin 4") dan angka dasar disalin dari
// mesin terakhir supaya operator cukup mengoreksi bila berbeda.
function nilaiMesinBaru(mesinList: MesinRow[]): NilaiFormMesin {
  const contoh = mesinList[mesinList.length - 1];
  return {
    nama: `Mesin ${mesinList.length + 1}`,
    status: "AKTIF",
    kapasitas: contoh ? String(contoh.KapasitasProduksiPerHari) : "",
    listrik: contoh ? String(contoh.KonsumsiListrikKWh) : "0",
    lamaProduksi: contoh ? String(contoh.LamaProduksiMenit) : "0",
    lamaKemas: contoh ? String(contoh.LamaPengemasanMenit) : "0",
  };
}

function keInput(n: NilaiFormMesin) {
  return {
    nama: n.nama,
    status: n.status,
    kapasitasProduksiPerHari: Number(n.kapasitas),
    konsumsiListrikKWh: Number(n.listrik),
    lamaProduksiMenit: Number(n.lamaProduksi),
    lamaPengemasanMenit: Number(n.lamaKemas),
  };
}

// Isi dialog Ubah/Tambah Mesin (form yang sama untuk keduanya).
function FormMesin({
  nilai,
  onUbah,
  error,
}: {
  nilai: NilaiFormMesin;
  onUbah: (n: NilaiFormMesin) => void;
  error: string | null;
}) {
  function set<K extends keyof NilaiFormMesin>(k: K, v: NilaiFormMesin[K]) {
    onUbah({ ...nilai, [k]: v });
  }
  return (
    <div className="grid gap-3">
      <div>
        <Label>Nama</Label>
        <Input value={nilai.nama} onChange={(e) => set("nama", e.target.value)} />
      </div>
      <div>
        <Label>Status</Label>
        <Select value={nilai.status} onValueChange={(v) => set("status", (v as StatusMesin) ?? "AKTIF")}>
          <SelectTrigger className="w-full">
            <SelectValue placeholder="Pilih status">{(v: string) => STATUS_MESIN_LABEL[v as StatusMesin]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((s) => (
              <SelectItem key={s} value={s}>
                {STATUS_MESIN_LABEL[s]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Kapasitas Produksi (kantong/hari)</Label>
        <Input type="number" value={nilai.kapasitas} onChange={(e) => set("kapasitas", e.target.value)} />
      </div>
      <div>
        <Label>Konsumsi Listrik (kWh)</Label>
        <Input type="number" value={nilai.listrik} onChange={(e) => set("listrik", e.target.value)} />
      </div>
      <div>
        <Label>Lama Produksi (menit)</Label>
        <Input type="number" value={nilai.lamaProduksi} onChange={(e) => set("lamaProduksi", e.target.value)} />
      </div>
      <div>
        <Label>Lama Pengemasan (menit)</Label>
        <Input type="number" value={nilai.lamaKemas} onChange={(e) => set("lamaKemas", e.target.value)} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

function MesinCard({ mesin }: { mesin: MesinRow }) {
  const [open, setOpen] = useState(false);
  const [nilai, setNilai] = useState(() => nilaiDariMesin(mesin));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await updateMesinAction({ mesinId: mesin.MesinID, ...keInput(nilai) });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          // MesinCard tetap ter-mount antar buka/tutup (key MesinID), jadi
          // isian yang ditinggalkan tanpa disimpan diisi ulang dari data
          // mesin terkini setiap kali dialog dibuka.
          setNilai(nilaiDariMesin(mesin));
          setError(null);
        }
      }}
    >
      <DialogTrigger className="rounded-lg border border-border bg-background p-3 text-left text-sm hover:bg-muted/50">
        <div className="flex items-center justify-between gap-2">
          <p className="font-semibold">{mesin.Nama}</p>
          <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_BADGE_CLASS[mesin.Status]}`}>
            {STATUS_MESIN_LABEL[mesin.Status]}
          </span>
        </div>
        <div className="mt-1 flex flex-col gap-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1" title="Kapasitas Produksi">
            <Package className="size-3.5" />
            {mesin.KapasitasProduksiPerHari}/hari
          </span>
          <span className="flex items-center gap-1" title="Konsumsi Listrik">
            <Zap className="size-3.5" />
            {mesin.KonsumsiListrikKWh} kWh
          </span>
          <span className="flex items-center gap-1" title="Lama Produksi">
            <Timer className="size-3.5" />
            {mesin.LamaProduksiMenit} mnt
          </span>
          <span className="flex items-center gap-1" title="Lama Pengemasan">
            <PackageCheck className="size-3.5" />
            {mesin.LamaPengemasanMenit} mnt
          </span>
        </div>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Ubah Data Mesin</DialogTitle>
        </DialogHeader>
        <FormMesin nilai={nilai} onUbah={setNilai} error={error} />
        <DialogFooter>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Tombol bulat "+" di pojok kanan atas deretan kartu mesin (absolute — deretan
// kartu menggantung di tepi bawah peta, sebelahnya ada legenda peta, jadi
// tidak boleh menambah lebar). Mesin baru langsung
// tampil di peta, menjadi papan (kolom) baru di Riwayat Produksi, dan
// muncul sebagai pilihan mesin di aplikasi operator.
function TambahMesinCard({ mesinList }: { mesinList: MesinRow[] }) {
  const [open, setOpen] = useState(false);
  const [nilai, setNilai] = useState(() => nilaiMesinBaru(mesinList));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await createMesinAction(keInput(nilai));
      if (!result.success) {
        setError(result.error);
        return;
      }
      setOpen(false);
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setNilai(nilaiMesinBaru(mesinList));
          setError(null);
        }
      }}
    >
      <DialogTrigger
        title="Tambah mesin produksi"
        aria-label="Tambah Mesin"
        className="absolute -top-3 -right-3 z-10 flex size-7 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:border-primary/60 hover:bg-primary hover:text-primary-foreground"
      >
        <Plus className="size-4" />
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Tambah Mesin</DialogTitle>
        </DialogHeader>
        <p className="-mt-2 text-xs text-muted-foreground">
          Mesin baru otomatis menjadi papan baru di Riwayat Produksi dan bisa dipilih operator saat mencatat hasil panen.
        </p>
        <FormMesin nilai={nilai} onUbah={setNilai} error={error} />
        <DialogFooter>
          <Button onClick={handleSave} disabled={pending}>
            {pending ? "Menyimpan..." : "Tambah"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
