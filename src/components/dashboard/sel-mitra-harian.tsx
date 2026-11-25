"use client";

// Satu sel tanggal di panel Transaksi DO per Mitra = tombol yang membuka UI
// gabungan untuk mitra itu di tanggal itu:
//   1. Hasil penawaran — log follow-up (melalui apa, oleh siapa, hasil,
//      angka pemesanan). Append-only: log lama tidak bisa diedit, hanya
//      ditambah log baru; yang terbaru dianggap benar, sisanya jadi riwayat.
//   2. Transaksi — rantai SO → DO → SI/SP hari itu (pengganti panel Kartu
//      Transaksi lama).
// Semua diambil saat dibuka saja, bukan saat halaman dimuat.
import { useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { konfirmasi } from "@/components/konfirmasi";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SalesTransactionCards } from "@/components/dashboard/sales-transaction-cards";
import { cn } from "@/lib/utils";
import { SALURAN_FOLLOW_UP, type ContactType } from "@/lib/saluran-follow-up";
import type { MitraContactLogEntry } from "@/lib/queries/mitra-contact-log";
import type { PelakuFollowUp } from "@/lib/queries/akun";
import type { SalesOrderCard } from "@/lib/queries/sales-cards";
import {
  getRiwayatPenawaranAction,
  getTransaksiMitraHarianAction,
  hapusLogPenawaranAction,
  tambahLogPenawaranAction,
} from "@/app/mkesindo/(dashboard)/transaksi/actions";

const NAMA_HARI_PANJANG = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const NAMA_BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];

// Pilihan "Oleh" di luar nama marketing.
// Disimpan ke DilakukanOleh sebagai "Nama @username".
const labelPelaku = (p: PelakuFollowUp) => `${p.nama} @${p.username}`;

// Kelompokkan per peran, urutan kelompok mengikuti urutan dari server.
function kelompokPelaku(pelaku: PelakuFollowUp[]): [string, PelakuFollowUp[]][] {
  const peta = new Map<string, PelakuFollowUp[]>();
  for (const p of pelaku) peta.set(p.kelompok, [...(peta.get(p.kelompok) ?? []), p]);
  return [...peta.entries()];
}

const angka = (n: number) => n.toLocaleString("id-ID", { maximumFractionDigits: 1 });

function labelTanggal(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return `${NAMA_HARI_PANJANG[d.getUTCDay()]}, ${d.getUTCDate()} ${NAMA_BULAN[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

// DicatatPada = naive WIB "YYYY-MM-DDTHH:mm:ss" — dibaca apa adanya.
function labelWaktuLog(dicatatPada: string): string {
  return `${dicatatPada.slice(8, 10)}/${dicatatPada.slice(5, 7)} ${dicatatPada.slice(11, 16)}`;
}

function KartuLog({
  log,
  terbaru,
  onHapus,
}: {
  log: MitraContactLogEntry;
  terbaru: boolean;
  // Hanya diisi untuk Accounting/Direktur.
  onHapus?: () => void;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-1 rounded-md border px-2.5 py-2 text-xs",
        terbaru ? "border-primary/40 bg-primary/5" : "bg-muted/30 text-muted-foreground"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="shrink-0 rounded bg-muted px-1.5 text-[10px] leading-4 font-medium text-foreground">
            {log.ContactType}
          </span>
          <span className="truncate">{log.DilakukanOleh ?? "Tidak dicatat"}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <span className="text-[10px] text-muted-foreground tabular-nums">{labelWaktuLog(log.DicatatPada)}</span>
          {onHapus && (
            <button
              type="button"
              onClick={onHapus}
              title="Hapus log ini"
              aria-label="Hapus log ini"
              className="rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
            >
              <Trash2 className="size-3" />
            </button>
          )}
        </span>
      </div>
      {log.AngkaPemesanan != null && (
        <p className="tabular-nums">
          Pesan{" "}
          <span className={cn("font-semibold", terbaru && "text-sm text-foreground")}>{angka(log.AngkaPemesanan)}</span>{" "}
          kantong
        </p>
      )}
      {log.HasilPenawaran && <p className="whitespace-pre-wrap">{log.HasilPenawaran}</p>}
      {log.AlasanTidakSesuai && (
        <p className="whitespace-pre-wrap text-muted-foreground">
          <span className="font-medium">Alasan tidak sesuai:</span> {log.AlasanTidakSesuai}
        </p>
      )}
    </div>
  );
}

function FormLogBaru({
  businessPartnerId,
  dateISO,
  isPast,
  pelaku,
  olehAwal,
  onTersimpan,
  onBatal,
}: {
  businessPartnerId: string;
  dateISO: string;
  isPast: boolean;
  // Akun aktif per peran (Marketing, Supervisor, Staff, Accounting, Direktur).
  pelaku: PelakuFollowUp[];
  olehAwal: string;
  onTersimpan: () => void;
  onBatal: () => void;
}) {
  const [melalui, setMelalui] = useState<ContactType | "">("");
  const [oleh, setOleh] = useState(olehAwal);
  const [hasil, setHasil] = useState("");
  const [angkaPesan, setAngkaPesan] = useState("");
  const [alasan, setAlasan] = useState("");
  const [pending, startTransition] = useTransition();

  function simpan() {
    if (!melalui) return toast.error("Pilih follow-up melalui apa.");
    if (!oleh) return toast.error("Pilih siapa yang melakukan follow-up.");
    if (!hasil.trim() && !angkaPesan.trim()) return toast.error("Isi hasil penawaran atau angka pemesanan.");
    startTransition(async () => {
      const res = await tambahLogPenawaranAction({
        businessPartnerId,
        dateISO,
        contactType: melalui,
        dilakukanOleh: oleh,
        hasilPenawaran: hasil.trim() || null,
        angkaPemesanan: angkaPesan.trim() ? Number(angkaPesan) : null,
        alasanTidakSesuai: alasan.trim() || null,
      });
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      toast.success("Log penawaran ditambahkan");
      onTersimpan();
    });
  }

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-2.5">
      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Melalui</Label>
          <Select value={melalui} onValueChange={(v) => setMelalui((v as ContactType) ?? "")}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Follow-up melalui">
              <SelectValue>{(v: string) => v || "Pilih..."}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {SALURAN_FOLLOW_UP.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Oleh</Label>
          <Select value={oleh} onValueChange={(v) => setOleh((v as string) ?? "")}>
            <SelectTrigger className="h-8 w-full text-xs" aria-label="Dilakukan oleh">
              <SelectValue>{(v: string) => v || "Pilih..."}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {kelompokPelaku(pelaku).map(([kelompok, anggota], idx) => (
                <SelectGroup key={kelompok}>
                  {idx > 0 && <SelectSeparator />}
                  <SelectLabel>{kelompok}</SelectLabel>
                  {anggota.map((p) => (
                    <SelectItem key={p.username} value={labelPelaku(p)}>
                      {p.nama} <span className="text-muted-foreground">@{p.username}</span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Hasil penawaran</Label>
        <Textarea
          value={hasil}
          onChange={(e) => setHasil(e.target.value)}
          rows={2}
          className="text-xs"
          placeholder="Apa hasil penawaran ke mitra..."
        />
      </div>
      <div className="flex flex-col gap-1">
        <Label className="text-[10px] text-muted-foreground">Angka pemesanan (kantong)</Label>
        <Input
          type="number"
          min={0}
          value={angkaPesan}
          onChange={(e) => setAngkaPesan(e.target.value)}
          className="h-8 text-xs"
          placeholder="0"
        />
      </div>
      {isPast && (
        <div className="flex flex-col gap-1">
          <Label className="text-[10px] text-muted-foreground">Alasan pengiriman tidak sesuai pesanan (opsional)</Label>
          <Textarea value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} className="text-xs" />
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onBatal} disabled={pending}>
          Batal
        </Button>
        <Button size="sm" onClick={simpan} disabled={pending}>
          {pending && <Loader2 className="size-3.5 animate-spin" />}
          Simpan log
        </Button>
      </div>
    </div>
  );
}

export function SelMitraHarian({
  businessPartnerId,
  namaMitra,
  dateISO,
  isPast,
  qty,
  target,
  marketingMitra,
  className,
  children,
}: {
  businessPartnerId: string;
  namaMitra: string;
  dateISO: string;
  isPast: boolean;
  qty: number;
  target: number | null;
  // Nama marketing mitra (= akun.nama marketing) — jadi pilihan awal "Oleh".
  marketingMitra: string | null;
  className?: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [riwayat, setRiwayat] = useState<MitraContactLogEntry[] | null>(null);
  const [bolehHapus, setBolehHapus] = useState(false);
  const [pelaku, setPelaku] = useState<PelakuFollowUp[]>([]);
  const [transaksi, setTransaksi] = useState<SalesOrderCard[] | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [formTerbuka, setFormTerbuka] = useState(false);
  const [riwayatTerbuka, setRiwayatTerbuka] = useState(false);

  const adaTransaksi = isPast && qty > 0;
  const marketingAwal = pelaku.find((p) => p.kelompok === "Marketing" && p.nama === marketingMitra);

  function muatRiwayat() {
    getRiwayatPenawaranAction(businessPartnerId, dateISO)
      .then((res) => {
        if (!res.success) return setGalat(res.error);
        setRiwayat(res.data.log);
        setBolehHapus(res.data.bolehHapus);
        setPelaku(res.data.pelaku);
      })
      .catch(() => setGalat("Gagal memuat log penawaran."));
  }

  async function hapus(log: MitraContactLogEntry) {
    const ok = await konfirmasi("Hapus log penawaran ini?", {
      keterangan: `${log.ContactType} oleh ${log.DilakukanOleh ?? "-"} (${labelWaktuLog(log.DicatatPada)}). Log disembunyikan dari riwayat; log sebelumnya kembali jadi yang terbaru.`,
      tombol: "Hapus",
      bahaya: true,
    });
    if (!ok) return;
    const res = await hapusLogPenawaranAction(log.LogID);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Log penawaran dihapus");
    muatRiwayat();
    router.refresh();
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) return;
    setGalat(null);
    setFormTerbuka(false);
    setRiwayatTerbuka(false);
    muatRiwayat();
    if (adaTransaksi && transaksi == null) {
      getTransaksiMitraHarianAction(businessPartnerId, dateISO)
        .then((res) => (res.success ? setTransaksi(res.data) : setGalat(res.error)))
        .catch(() => setGalat("Gagal memuat transaksi."));
    }
  }

  const [terbaru, ...sebelumnya] = riwayat ?? [];

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger render={<button type="button" className={className} />}>{children}</DialogTrigger>
      {/* Selalu di tengah layar. Kepala + Hasil penawaran tetap di atas;
          hanya bagian Transaksi yang bergulir. */}
      <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="flex max-h-[60vh] shrink-0 flex-col gap-3 overflow-y-auto border-b p-4">
          <div className="pr-6">
            <DialogTitle className="text-sm font-semibold">{namaMitra}</DialogTitle>
            <p className="text-xs text-muted-foreground tabular-nums">
              {labelTanggal(dateISO)}
              {isPast && ` · terkirim ${angka(qty)}`}
              {target != null && ` · target ${angka(target)}`}
            </p>
          </div>

          {galat && <p className="text-center text-xs text-destructive">{galat}</p>}

          {/* 1. Hasil penawaran */}
          <section className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold">Hasil penawaran</p>
              {/* Tunggu daftar pelaku termuat supaya pilihan awal "Oleh" terisi. */}
              {!formTerbuka && riwayat != null && (
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setFormTerbuka(true)}>
                  <Plus className="size-3.5" />
                  Log baru
                </Button>
              )}
            </div>
            {formTerbuka && (
              <FormLogBaru
                businessPartnerId={businessPartnerId}
                dateISO={dateISO}
                isPast={isPast}
                pelaku={pelaku}
                olehAwal={marketingAwal ? labelPelaku(marketingAwal) : ""}
                onBatal={() => setFormTerbuka(false)}
                onTersimpan={() => {
                  setFormTerbuka(false);
                  muatRiwayat();
                  // Angka pemesanan di sel & kepala kolom berasal dari
                  // ringkasan tingkat halaman — segarkan.
                  router.refresh();
                }}
              />
            )}
            {riwayat == null && !galat ? (
              <p className="flex items-center justify-center gap-1.5 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Memuat log...
              </p>
            ) : !terbaru ? (
              !formTerbuka && <p className="py-1 text-xs text-muted-foreground">Belum ada follow-up untuk tanggal ini.</p>
            ) : (
              <>
                <KartuLog log={terbaru} terbaru onHapus={bolehHapus ? () => hapus(terbaru) : undefined} />
                {sebelumnya.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() => setRiwayatTerbuka((v) => !v)}
                      className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                    >
                      <ChevronDown className={cn("size-3 transition-transform", riwayatTerbuka && "rotate-180")} />
                      Riwayat sebelumnya ({sebelumnya.length})
                    </button>
                    {riwayatTerbuka &&
                      sebelumnya.map((log) => (
                        <KartuLog
                          key={log.LogID}
                          log={log}
                          terbaru={false}
                          onHapus={bolehHapus ? () => hapus(log) : undefined}
                        />
                      ))}
                  </>
                )}
              </>
            )}
          </section>
        </div>

        {/* 2. Transaksi — satu-satunya bagian yang bergulir */}
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <section className="flex flex-col gap-1.5">
            <p className="text-xs font-semibold">Transaksi</p>
            {!adaTransaksi ? (
              <p className="py-1 text-xs text-muted-foreground">
                {isPast ? "Tidak ada pengiriman di tanggal ini." : "Tanggal ini belum berjalan."}
              </p>
            ) : transaksi == null ? (
              <p className="flex items-center justify-center gap-1.5 py-3 text-xs text-muted-foreground">
                <Loader2 className="size-3.5 animate-spin" /> Memuat transaksi...
              </p>
            ) : (
              <SalesTransactionCards orders={transaksi} satuKolom />
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}
