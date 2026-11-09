"use client";

// Dialog Koreksi admin (spec §2 baris Koreksi): ubah mulaiAt / varian / sisa
// satu isian aktif, atau batalkan panen ≤ 7 hari. Alasan wajib. Pesan galat
// server ditampilkan apa adanya (validasi sesungguhnya di server: waktu masa
// depan, kapasitas, isian sudah tidak aktif, dll.).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { batalkanPanenAction, koreksiIsianAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi, Varian } from "@/lib/produksi-denah";
import type { IsianAktif } from "@/lib/produksi-operasional";
import type { PanenTerakhir } from "@/lib/queries/produksi-operasional";
import { singkatVarian, tanggalJamWib } from "../warna-tahap";

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

/** "S 9805 UH 20 · S 9870 UH 14 · Babonan 2" / "Tandai Babonan 6 can". */
export function RincianPanen({ panen }: { panen: PanenTerakhir }) {
  if (panen.tandaiBabonan) return <>Tandai Babonan {panen.keBabonan} can</>;
  const bagian = panen.kendaraan.map((k) => `${k.plat} ${k.jumlah}`);
  if (panen.kendaraan.length === 0) bagian.push(`dimuat ${panen.dimuat}`);
  if (panen.keBabonan > 0) bagian.push(`Babonan ${panen.keBabonan}`);
  if (panen.pecah > 0) bagian.push(`pecah ${panen.pecah}`);
  return <>{`${singkatVarian(panen.varian)} · ${bagian.join(" · ")}`}</>;
}
