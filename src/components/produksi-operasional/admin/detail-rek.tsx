"use client";

// Detail satu rek di layar admin (/{kode}/produksi, spec §8): daftar isian
// aktif + aksi operasional. Memakai ulang isi lembar aksi aplikasi HP
// (IsiLembar + FormPanen) supaya aturan aksi tidak diduplikasi. Task 9
// menambahkan tombol Koreksi (khusus `admin`) di komponen ini.
//
// Dirender di dalam <SheetContent> milik pemanggil (judul memakai SheetTitle).
// Beri `key={keadaan.kolomId}` supaya state formulir tidak terbawa antar-rek.

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { getPilihanKendaraanAction, setKendaraanAktifAction } from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import type { KeadaanRek, KendaraanPilihan } from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
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
    if (!dapatAksi) return;
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
  }, [kode, dapatAksi]);

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
    </div>
  );
}
