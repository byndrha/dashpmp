"use client";

// Detail satu rek di layar admin (/{kode}/produksi, spec §8): grid can
// (mode lihat — juga untuk penonton tanpa hak aksi), daftar isian aktif +
// aksi operasional. Memakai ulang isi lembar aksi aplikasi HP
// (IsiLembar + FormPanen) supaya aturan aksi tidak diduplikasi. Khusus
// `admin`: bagian Koreksi (ubah isian aktif, batalkan panen ≤ 7 hari, ubah
// kendaraan muatan panen ≤ 7 hari).
//
// Dirender di dalam <SheetContent> milik pemanggil (judul memakai SheetTitle).
// Beri `key={keadaan.kolomId}` supaya state formulir tidak terbawa antar-rek.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { getPanenTerakhirAction, getPilihanKendaraanAction, setKendaraanAktifAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import { kodeRek, type IsianAktif, type KeadaanRek, type KendaraanPilihan } from "@/lib/produksi-operasional";
import type { PanenTerakhir } from "@/lib/queries/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { singkatVarian, tanggalJamWib } from "../warna-tahap";
import { DialogBatalPanen, DialogKoreksi, DialogUbahKendaraan, RincianPanen } from "./dialog-koreksi";
import { IsiLembar } from "../app/lembar-aksi-rek";
import type { Jalankan } from "../app/produksi-app";

export interface PropsDetailRek {
  kode: KodeProduksi;
  keadaan: KeadaanRek;
  /** Admin produksi (bolehKelolaProduksi) — Task 9: aksi Koreksi. */
  admin: boolean;
  /** Dipanggil sesudah setiap aksi tulis (pemanggil memuat ulang keadaan). */
  onBerubah: () => void;
  /**
   * Boleh menjalankan aksi operator (bolehAksiProduksi). Bawaan = `admin`.
   * Akun dashboard biasa (false) hanya melihat isian, tanpa tombol aksi.
   */
  bolehAksi?: boolean;
  /** Nama bak untuk judul ("Bak 2 · Rek 14"). */
  namaBak?: string;
  /** Jam server terakhir (ISO) untuk menghitung %; bawaan jam peramban. */
  sekarang?: string;
  /** Tutup panel (dipanggil sesudah aksi berhasil). */
  onTutup?: () => void;
}

const PESAN_ARMADA_GAGAL = "Daftar armada gagal dimuat — periksa koneksi. Pakai kendaraan pembeli atau coba lagi.";

export function DetailRek({ kode, keadaan, admin, onBerubah, bolehAksi, namaBak, sekarang, onTutup }: PropsDetailRek) {
  const dapatAksi = bolehAksi ?? admin;
  const [sibuk, setSibuk] = useState(false);
  const sibukRef = useRef(false);
  const [armada, setArmada] = useState<KendaraanArmada[]>([]);
  const [armadaGalat, setArmadaGalat] = useState<string | null>(null);
  const [kendaraanAktif, setKendaraanAktif] = useState<KendaraanPilihan | null>(null);
  const [jamBuka] = useState(() => new Date().toISOString());

  // Pilihan kendaraan (armada ERP + kendaraan aktif akun ini) hanya diperlukan
  // untuk formulir panen — dimuat saat panel dibuka oleh akun yang boleh beraksi.
  useEffect(() => {
    if (!dapatAksi && !admin) return;
    let batal = false;
    getPilihanKendaraanAction(kode).then(
      (r) => {
        if (batal) return;
        if (r.success) {
          setArmada(r.data.armada);
          setArmadaGalat(r.data.armadaGalat);
          setKendaraanAktif(r.data.aktif);
        } else {
          setArmadaGalat(r.error);
        }
      },
      () => {
        if (!batal) setArmadaGalat(PESAN_ARMADA_GAGAL);
      },
    );
    return () => {
      batal = true;
    };
  }, [kode, dapatAksi, admin]);

  const jalankan: Jalankan = useCallback(
    async (fn, pesanSukses) => {
      if (sibukRef.current) return { success: false, error: "Masih memproses aksi sebelumnya." };
      sibukRef.current = true;
      setSibuk(true);
      try {
        let r: Awaited<ReturnType<typeof fn>>;
        try {
          r = await fn();
        } catch {
          r = { success: false, error: "Koneksi gagal. Coba lagi." };
        }
        if (r.success) toast.success(pesanSukses);
        else if (!("kodeGalat" in r && r.kodeGalat === "BELUM_SIAP")) toast.error(r.error);
        // Galat pun memuat ulang: penolakan KEADAAN_BERUBAH berarti data di layar basi.
        onBerubah();
        return r;
      } finally {
        sibukRef.current = false;
        setSibuk(false);
      }
    },
    [onBerubah],
  );

  const gantiKendaraanAktif = useCallback(
    async (k: KendaraanPilihan) => {
      setKendaraanAktif(k);
      try {
        const r = await setKendaraanAktifAction(kode, k);
        if (!r.success) toast.error(r.error);
      } catch {
        toast.error("Gagal menyimpan kendaraan aktif — periksa koneksi.");
      }
    },
    [kode],
  );

  return (
    <div className="flex-1 overflow-y-auto">
      <IsiLembar
        kode={kode}
        rek={keadaan}
        namaBak={namaBak?.trim() || "Bak"}
        armada={armada}
        armadaGalat={armadaGalat}
        kendaraanAktif={kendaraanAktif}
        sekarang={sekarang ?? jamBuka}
        sibuk={sibuk}
        jalankan={jalankan}
        onKendaraanTerakhir={(k) => void gantiKendaraanAktif(k)}
        onTutup={() => onTutup?.()}
        bolehAksi={dapatAksi}
      />
      {!dapatAksi && (
        <p className="mx-4 mb-4 rounded-lg bg-muted p-3 text-xs text-muted-foreground">
          Mode lihat saja. Aksi rek hanya untuk operator dan admin produksi.
        </p>
      )}
      {admin && (
        <KoreksiAdmin
          kode={kode}
          keadaan={keadaan}
          lokasi={`${namaBak?.trim() || "Bak"} – Rek ${keadaan.nomor} (${kodeRek(keadaan.kodeBak, keadaan.nomor)})`}
          armada={armada}
          armadaGalat={armadaGalat}
          onBerubah={onBerubah}
        />
      )}
    </div>
  );
}

// ── Koreksi (admin saja; server action memakai gerbang "kelola") ───────────

function KoreksiAdmin({
  kode,
  keadaan,
  lokasi,
  armada,
  armadaGalat,
  onBerubah,
}: {
  kode: KodeProduksi;
  keadaan: KeadaanRek;
  lokasi: string;
  armada: KendaraanArmada[];
  armadaGalat: string | null;
  onBerubah: () => void;
}) {
  const isian = [...keadaan.isianProduksi, ...(keadaan.isianBabonan ? [keadaan.isianBabonan] : [])];
  const [panen, setPanen] = useState<PanenTerakhir[] | null>(null);
  const [panenGalat, setPanenGalat] = useState<string | null>(null);
  const [koreksi, setKoreksi] = useState<IsianAktif | null>(null);
  const [batal, setBatal] = useState<PanenTerakhir | null>(null);
  const [ubahKendaraan, setUbahKendaraan] = useState<PanenTerakhir | null>(null);
  const [muatUlang, setMuatUlang] = useState(0);

  // Muat ulang daftar panen kalau isian rek berubah (mis. panen baru dari
  // formulir di atas atau dari HP operator) atau sesudah pembatalan.
  const sidik = isian.map((i) => `${i.id}:${i.slot.join(".")}`).join(",");
  useEffect(() => {
    let batalMuat = false;
    getPanenTerakhirAction(kode, keadaan.kolomId).then(
      (r) => {
        if (batalMuat) return;
        if (r.success) {
          setPanen(r.data);
          setPanenGalat(null);
        } else {
          setPanenGalat(r.error);
        }
      },
      () => {
        if (!batalMuat) setPanenGalat("Daftar panen gagal dimuat — periksa koneksi.");
      },
    );
    return () => {
      batalMuat = true;
    };
  }, [kode, keadaan.kolomId, sidik, muatUlang]);

  const selesai = () => {
    setKoreksi(null);
    setBatal(null);
    setUbahKendaraan(null);
    setMuatUlang((n) => n + 1);
    onBerubah();
  };

  return (
    <section className="mx-4 mb-4 flex flex-col gap-3 rounded-lg border border-amber-300 p-3 dark:border-amber-800">
      <h3 className="text-sm font-semibold">Koreksi (admin)</h3>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Isian aktif</p>
        {isian.length === 0 && <p className="text-xs text-muted-foreground">Tidak ada isian aktif.</p>}
        {isian.map((i) => (
          <div key={i.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {i.jenis === "babonan" ? "Babonan" : "Produksi"} {singkatVarian(i.varian)} · {i.sisa}/{i.jumlahAwal} can ·{" "}
              <span className="text-muted-foreground">{tanggalJamWib(i.mulaiAt)}</span>
            </span>
            <Button variant="outline" size="sm" onClick={() => setKoreksi(i)}>
              Koreksi
            </Button>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <p className="text-xs font-medium text-muted-foreground">Panen 7 hari terakhir (belum dibatalkan)</p>
        {panenGalat && <p className="text-xs text-destructive">{panenGalat}</p>}
        {panen === null && !panenGalat && <p className="text-xs text-muted-foreground">Memuat…</p>}
        {panen?.length === 0 && <p className="text-xs text-muted-foreground">Tidak ada panen dalam 7 hari terakhir.</p>}
        {panen?.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-sm">
            <span className="flex-1">
              {p.tandaiBabonan && (
                <span className="mr-1 rounded border border-amber-400 bg-amber-100 px-1 text-[11px] font-semibold text-amber-900 dark:border-amber-700 dark:bg-amber-950/70 dark:text-amber-100">
                  Tandai Babonan
                </span>
              )}
              <span className="tabular-nums">{tanggalJamWib(p.panenAt)}</span> · <RincianPanen panen={p} />
              <span className="block text-xs text-muted-foreground">
                {p.operatorNama}
                {!p.isianAktif && " · isian asal sudah selesai (batal hanya menandai)"}
              </span>
            </span>
            <div className="flex shrink-0 flex-col gap-1">
              {!p.tandaiBabonan && p.dimuat > 0 && (
                <Button variant="outline" size="sm" onClick={() => setUbahKendaraan(p)}>
                  Ubah kendaraan
                </Button>
              )}
              <Button variant="destructive" size="sm" onClick={() => setBatal(p)}>
                Batalkan
              </Button>
            </div>
          </div>
        ))}
      </div>

      {koreksi && (
        <DialogKoreksi
          key={koreksi.id}
          kode={kode}
          rek={keadaan}
          // Pakai data isian terkini kalau rek dimuat ulang selama dialog terbuka.
          isian={isian.find((i) => i.id === koreksi.id) ?? koreksi}
          lokasi={lokasi}
          onTutup={() => setKoreksi(null)}
          onBerhasil={selesai}
        />
      )}
      {ubahKendaraan && (
        <DialogUbahKendaraan
          key={ubahKendaraan.id}
          kode={kode}
          panen={ubahKendaraan}
          lokasi={lokasi}
          armada={armada}
          armadaGalat={armadaGalat}
          onTutup={() => setUbahKendaraan(null)}
          onBerhasil={selesai}
        />
      )}
      {batal && <DialogBatalPanen key={batal.id} kode={kode} panen={batal} lokasi={lokasi} onTutup={() => setBatal(null)} onBerhasil={selesai} />}
    </section>
  );
}
