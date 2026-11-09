"use client";

// Dialog Koreksi admin (spec §2 baris Koreksi): ubah mulaiAt / varian / sisa
// satu isian aktif, batalkan panen ≤ 7 hari, atau ubah kendaraan muatan
// panen ≤ 7 hari (jumlah dimuat tetap). Alasan wajib. Pesan galat
// server ditampilkan apa adanya (validasi sesungguhnya di server: waktu masa
// depan, kapasitas, isian sudah tidak aktif, dll.).

import { useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { batalkanPanenAction, koreksiIsianAction, koreksiMuatanAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi, Varian } from "@/lib/produksi-denah";
import { validasiKoreksiMuatan, type IsianAktif, type KendaraanPilihan, type MuatanInput } from "@/lib/produksi-operasional";
import type { PanenTerakhir } from "@/lib/queries/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { singkatVarian, tanggalJamWib } from "../warna-tahap";
import { PemilihKendaraan } from "../app/pemilih-kendaraan";

const WIB_OFFSET_MS = 7 * 3_600_000;
const KELAS_SELECT =
  "h-8 w-full rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

/** ISO → nilai <input type="datetime-local"> dalam jam dinding WIB ("2026-11-09T08:10"). */
export function keLokalWib(iso: string): string {
  return new Date(Date.parse(iso) + WIB_OFFSET_MS).toISOString().slice(0, 16);
}

/** Nilai datetime-local yang dibaca sebagai WIB (+07:00) → ISO; null kalau tidak sah. */
export function dariLokalWib(nilai: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(nilai)) return null;
  const t = Date.parse(`${nilai}:00+07:00`);
  return Number.isNaN(t) ? null : new Date(t).toISOString();
}

async function panggil(fn: () => Promise<{ success: boolean; error?: string }>): Promise<string | null> {
  try {
    const r = await fn();
    return r.success ? null : (r.error ?? "Gagal.");
  } catch {
    return "Koneksi gagal. Coba lagi.";
  }
}

export function DialogKoreksi({
  kode,
  isian,
  lokasi,
  onTutup,
  onBerhasil,
}: {
  kode: KodeProduksi;
  isian: IsianAktif;
  lokasi: string;
  onTutup: () => void;
  onBerhasil: () => void;
}) {
  const awalMulai = keLokalWib(isian.mulaiAt);
  const [mulai, setMulai] = useState(awalMulai);
  const [varian, setVarian] = useState<Varian>(isian.varian);
  const [sisa, setSisa] = useState(String(isian.sisa));
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const [maks] = useState(() => keLokalWib(new Date().toISOString()));

  async function simpan() {
    const ubah: { mulaiAt?: string; varian?: Varian; sisa?: number } = {};
    if (mulai !== awalMulai) {
      const iso = dariLokalWib(mulai);
      if (!iso) return setGalat("Waktu isi air tidak sah.");
      ubah.mulaiAt = iso;
    }
    if (varian !== isian.varian) ubah.varian = varian;
    if (sisa.trim() !== String(isian.sisa)) {
      const n = Number(sisa);
      if (!Number.isSafeInteger(n) || n < 0) return setGalat("Sisa can harus bilangan bulat ≥ 0.");
      ubah.sisa = n;
    }
    if (Object.keys(ubah).length === 0) return setGalat("Tidak ada yang diubah.");
    // Alasan kosong tetap dikirim: server yang menolak (pesannya ditampilkan apa adanya).
    setSibuk(true);
    const g = await panggil(() => koreksiIsianAction(kode, isian.id, ubah, alasan));
    setSibuk(false);
    if (g) return setGalat(g);
    onBerhasil();
  }

  const babonan = isian.jenis === "babonan";
  return (
    <Dialog open onOpenChange={(o) => !o && !sibuk && onTutup()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Koreksi isian</DialogTitle>
          <DialogDescription>
            {lokasi} · {babonan ? "Babonan" : "Produksi"} {singkatVarian(isian.varian)} · {isian.sisa}/{isian.jumlahAwal} can · diisi{" "}
            {tanggalJamWib(isian.mulaiAt)} oleh {isian.diisiOlehNama}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="koreksi-mulai">{babonan ? "Babonan sejak (WIB)" : "Waktu isi air (WIB)"}</Label>
            <Input id="koreksi-mulai" type="datetime-local" value={mulai} max={maks} onChange={(e) => setMulai(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="koreksi-varian">Varian</Label>
              <select id="koreksi-varian" className={KELAS_SELECT} value={varian} onChange={(e) => setVarian(e.target.value as Varian)}>
                <option value="kecil">BK (kecil)</option>
                <option value="besar">BB (besar)</option>
              </select>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="koreksi-sisa">Sisa can</Label>
              <Input id="koreksi-sisa" type="number" inputMode="numeric" min={0} step={1} value={sisa} onChange={(e) => setSisa(e.target.value)} />
            </div>
          </div>
          {!babonan && varian !== isian.varian && (
            <p className="text-xs text-muted-foreground">Ganti varian juga mengganti durasi beku ke nilai bak untuk varian itu.</p>
          )}
          {sisa.trim() !== String(isian.sisa) && (
            <p className="text-xs text-muted-foreground">Mengubah sisa ikut menggeser jumlah awal dengan selisih yang sama (salah hitung can).</p>
          )}
          <div className="grid gap-1.5">
            <Label htmlFor="koreksi-alasan">Alasan (wajib)</Label>
            <Textarea id="koreksi-alasan" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} maxLength={1000} />
          </div>
          {galat && <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{galat}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onTutup} disabled={sibuk}>
            Batal
          </Button>
          <Button onClick={() => void simpan()} disabled={sibuk}>
            {sibuk ? "Menyimpan…" : "Simpan koreksi"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function DialogBatalPanen({
  kode,
  panen,
  lokasi,
  onTutup,
  onBerhasil,
}: {
  kode: KodeProduksi;
  panen: PanenTerakhir;
  lokasi: string;
  onTutup: () => void;
  onBerhasil: () => void;
}) {
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  async function batalkan() {
    setSibuk(true);
    const g = await panggil(() => batalkanPanenAction(kode, panen.id, alasan));
    setSibuk(false);
    if (g) return setGalat(g);
    onBerhasil();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !sibuk && onTutup()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{panen.tandaiBabonan ? "Batalkan Tandai Babonan" : "Batalkan panen"}</DialogTitle>
          <DialogDescription>
            {lokasi} · {tanggalJamWib(panen.panenAt)} · {panen.operatorNama} · <RincianPanen panen={panen} />
          </DialogDescription>
        </DialogHeader>
        <p className="text-xs text-muted-foreground">
          {panen.isianAktif
            ? panen.tandaiBabonan
              ? "Can yang ditandai Babonan ditarik kembali ke isian asal."
              : "Can dikembalikan ke isian asal (termasuk can yang dipindah ke Babonan), kalau kapasitas rek dan Babonan masih cukup."
            : "Isian asal sudah selesai: panen hanya ditandai dibatalkan, can tidak dikembalikan."}{" "}
          Isian baru hasil isi ulang tidak ikut diubah — koreksi terpisah kalau perlu. Panen yang dibatalkan keluar dari pencocokan DO.
        </p>
        <div className="grid gap-1.5">
          <Label htmlFor="batal-alasan">Alasan (wajib)</Label>
          <Textarea id="batal-alasan" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} maxLength={1000} />
        </div>
        {galat && <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{galat}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onTutup} disabled={sibuk}>
            Kembali
          </Button>
          <Button variant="destructive" onClick={() => void batalkan()} disabled={sibuk}>
            {sibuk ? "Membatalkan…" : "Batalkan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

interface BarisUbah {
  kunci: number;
  kendaraan: KendaraanPilihan | null;
  jumlah: string;
}

function angkaBaris(s: string): number {
  const t = s.trim();
  if (t === "") return 0;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

/**
 * "Ubah kendaraan": ganti pembagian muatan sebuah panen ke kendaraan (mis.
 * dicatat ke kendaraan yang salah). Jumlah dimuat tidak berubah — Σ baris
 * baru wajib sama dengan dimuat. Memakai PemilihKendaraan yang sama dengan
 * formulir panen.
 */
export function DialogUbahKendaraan({
  kode,
  panen,
  lokasi,
  armada,
  armadaGalat,
  onTutup,
  onBerhasil,
}: {
  kode: KodeProduksi;
  panen: PanenTerakhir;
  lokasi: string;
  armada: KendaraanArmada[];
  armadaGalat: string | null;
  onTutup: () => void;
  onBerhasil: () => void;
}) {
  const [baris, setBaris] = useState<BarisUbah[]>(() =>
    panen.kendaraan.map((k, i) => ({
      kunci: i,
      kendaraan: { jenis: k.jenis, kendaraanErpId: k.kendaraanErpId, plat: k.plat, agenId: k.agenId, agenNama: k.agenNama },
      jumlah: String(k.jumlah),
    })),
  );
  const [kunciBerikut, setKunciBerikut] = useState(panen.kendaraan.length);
  const [alasan, setAlasan] = useState("");
  const [galat, setGalat] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);

  const muatan: MuatanInput[] = baris
    .filter((b): b is BarisUbah & { kendaraan: KendaraanPilihan } => b.kendaraan !== null)
    .map((b) => ({ ...b.kendaraan, jumlah: angkaBaris(b.jumlah) }));
  const total = baris.reduce((s, b) => s + (Number.isNaN(angkaBaris(b.jumlah)) ? 0 : angkaBaris(b.jumlah)), 0);
  const galatBentuk = baris.some((b) => b.kendaraan === null)
    ? "Pilih kendaraan untuk setiap baris."
    : validasiKoreksiMuatan(panen.dimuat, muatan);

  function ubahBaris(kunci: number, ubah: Partial<BarisUbah>) {
    setBaris((l) => l.map((b) => (b.kunci === kunci ? { ...b, ...ubah } : b)));
  }

  async function simpan() {
    if (galatBentuk) return setGalat(galatBentuk);
    setSibuk(true);
    const g = await panggil(() => koreksiMuatanAction(kode, panen.id, muatan, alasan));
    setSibuk(false);
    if (g) return setGalat(g);
    onBerhasil();
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !sibuk && onTutup()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Ubah kendaraan</DialogTitle>
          <DialogDescription>
            {lokasi} · {tanggalJamWib(panen.panenAt)} · {panen.operatorNama} · dimuat {panen.dimuat} can {singkatVarian(panen.varian)}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          {baris.map((b, i) => (
            <div key={b.kunci} className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <PemilihKendaraan
                  kode={kode}
                  armada={armada}
                  armadaGalat={armadaGalat}
                  nilai={b.kendaraan}
                  onPilih={(k) => ubahBaris(b.kunci, { kendaraan: k })}
                  disabled={sibuk}
                  tampilan="baris"
                  judul={`Kendaraan muatan ${i + 1}`}
                />
              </div>
              <Input
                value={b.jumlah}
                onChange={(e) => ubahBaris(b.kunci, { jumlah: e.target.value })}
                inputMode="numeric"
                aria-label={`Jumlah can muatan ${i + 1}`}
                className="h-10 w-16 text-center text-base font-semibold"
                disabled={sibuk}
              />
              {baris.length > 1 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Hapus baris muatan"
                  disabled={sibuk}
                  onClick={() => setBaris((l) => l.filter((x) => x.kunci !== b.kunci))}
                >
                  <X className="size-4" />
                </Button>
              ) : (
                <span className="w-8" />
              )}
            </div>
          ))}
          <button
            type="button"
            disabled={sibuk}
            onClick={() => {
              const kurang = panen.dimuat - total;
              setBaris((l) => [...l, { kunci: kunciBerikut, kendaraan: null, jumlah: kurang > 0 ? String(kurang) : "" }]);
              setKunciBerikut((k) => k + 1);
            }}
            className="flex items-center gap-1 self-start text-sm font-medium text-primary disabled:opacity-50"
          >
            <Plus className="size-4" /> Bagi ke kendaraan lain
          </button>
          <p className={total === panen.dimuat ? "text-xs text-muted-foreground" : "text-xs text-destructive"}>
            Total {total} dari {panen.dimuat} can dimuat.
          </p>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="ubah-kendaraan-alasan">Alasan (wajib)</Label>
          <Textarea id="ubah-kendaraan-alasan" value={alasan} onChange={(e) => setAlasan(e.target.value)} rows={2} maxLength={1000} />
        </div>
        {(galat ?? galatBentuk) && <p className="rounded-lg bg-destructive/10 p-2 text-sm text-destructive">{galat ?? galatBentuk}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onTutup} disabled={sibuk}>
            Batal
          </Button>
          <Button onClick={() => void simpan()} disabled={sibuk || galatBentuk !== null}>
            {sibuk ? "Menyimpan…" : "Simpan kendaraan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "S 9805 UH 20 · S 9870 UH 14 · Babonan 2" / "Tandai Babonan 6 can". */
export function RincianPanen({ panen }: { panen: PanenTerakhir }) {
  if (panen.tandaiBabonan) return <>Tandai Babonan {panen.keBabonan} can</>;
  const bagian = panen.kendaraan.map((k) => `${k.plat} ${k.jumlah}`);
  if (panen.kendaraan.length === 0) bagian.push(`dimuat ${panen.dimuat}`);
  if (panen.keBabonan > 0) bagian.push(`Babonan ${panen.keBabonan}`);
  if (panen.pecah > 0) bagian.push(`pecah ${panen.pecah}`);
  return <>{`${singkatVarian(panen.varian)} · ${bagian.join(" · ")}`}</>;
}
