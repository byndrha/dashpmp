"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { History, LayoutGrid, MonitorCog } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { AppearanceMenu } from "@/components/dashboard/appearance-menu";
import { SignOutButton } from "@/components/dashboard/sign-out-button";
import {
  getKeadaanAction,
  getRiwayatSayaAction,
  setKendaraanAktifAction,
} from "@/app/produksi-operasional-actions";
import type { ActionResult } from "@/lib/action-result";
import type { BakElemen, KodeProduksi } from "@/lib/produksi-denah";
import { shiftDari, type KeadaanRek, type KendaraanPilihan } from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import type { DataPabrik, KodeGalatProduksi } from "@/lib/queries/produksi-operasional";
import { GridRek } from "./grid-rek";
import { LembarAksiRek } from "./lembar-aksi-rek";
import { PemilihKendaraan } from "./pemilih-kendaraan";
import { RiwayatSaya, type DataRiwayat } from "./riwayat-saya";

export type HasilAksi<T> = ActionResult<T> | { success: false; error: string; kodeGalat: KodeGalatProduksi };

/**
 * Menjalankan satu aksi tulis: tombol aksi dikunci selama permintaan berjalan,
 * hasil ditampilkan sebagai toast, lalu keadaan disegarkan. Galat BELUM_SIAP
 * tidak di-toast — formulir panen menampilkan dialog konfirmasinya sendiri.
 */
export type Jalankan = <T>(fn: () => Promise<HasilAksi<T>>, pesanSukses: string) => Promise<HasilAksi<T>>;

type TabKey = "rek" | "riwayat";

interface DataKeadaan {
  data: DataPabrik;
  keadaan: KeadaanRek[];
}

const INTERVAL_SEGAR_MS = 30_000;
const PESAN_DENAH_KOSONG = "Denah produksi belum diatur — hubungi admin.";
const PESAN_GAGAL_MUAT = "Gagal memuat — periksa koneksi. Data mungkin belum terbaru.";

export function ProduksiApp({
  kode,
  namaPerusahaan,
  namaOperator,
  admin,
  awalKeadaan,
  awalArmada,
  armadaGalat,
  awalKendaraanAktif,
  awalRiwayat,
}: {
  kode: KodeProduksi;
  namaPerusahaan: string;
  namaOperator: string;
  admin: boolean;
  awalKeadaan: { data: DataKeadaan | null; galat: string | null };
  awalArmada: KendaraanArmada[];
  armadaGalat: string | null;
  awalKendaraanAktif: KendaraanPilihan | null;
  awalRiwayat: { data: DataRiwayat | null; galat: string | null };
}) {
  const [keadaan, setKeadaan] = useState<DataKeadaan | null>(awalKeadaan.data);
  const [galatKeadaan, setGalatKeadaan] = useState<string | null>(awalKeadaan.galat);
  const [kendaraanAktif, setKendaraanAktifState] = useState<KendaraanPilihan | null>(awalKendaraanAktif);
  const [riwayat, setRiwayat] = useState<DataRiwayat | null>(awalRiwayat.data);
  const [galatRiwayat, setGalatRiwayat] = useState<string | null>(awalRiwayat.galat);
  const [memuatRiwayat, setMemuatRiwayat] = useState(false);
  const [tab, setTab] = useState<TabKey>("rek");
  const [dikunjungi, setDikunjungi] = useState<Set<TabKey>>(() => new Set(["rek"]));
  const [bakAktifId, setBakAktifId] = useState<string>("");
  const [rekTerpilihId, setRekTerpilihId] = useState<string | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const sibukRef = useRef(false);

  // Kedua pemuat tidak pernah melempar: kegagalan jaringan (wifi putus)
  // ditampilkan sebagai galat, data lama tetap tampil.
  const muatKeadaan = useCallback(async () => {
    try {
      const r = await getKeadaanAction(kode);
      if (r.success) {
        setKeadaan({ data: r.data.data, keadaan: r.data.keadaan });
        setGalatKeadaan(null);
      } else {
        setGalatKeadaan(r.error);
      }
    } catch {
      setGalatKeadaan(PESAN_GAGAL_MUAT);
    }
  }, [kode]);

  const muatRiwayat = useCallback(async () => {
    setMemuatRiwayat(true);
    try {
      const r = await getRiwayatSayaAction(kode);
      if (r.success) {
        setRiwayat(r.data);
        setGalatRiwayat(null);
      } else {
        setGalatRiwayat(r.error);
      }
    } catch {
      setGalatRiwayat(PESAN_GAGAL_MUAT);
    } finally {
      setMemuatRiwayat(false);
    }
  }, [kode]);

  // Segarkan otomatis tiap 30 detik (dilewati saat tab browser tersembunyi
  // atau ada aksi yang sedang berjalan); segarkan juga saat kembali terlihat.
  useEffect(() => {
    const segar = () => {
      if (document.hidden || sibukRef.current) return;
      void muatKeadaan();
    };
    const id = setInterval(segar, INTERVAL_SEGAR_MS);
    const saatTerlihat = () => {
      if (!document.hidden) segar();
    };
    document.addEventListener("visibilitychange", saatTerlihat);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", saatTerlihat);
    };
  }, [muatKeadaan]);

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
        // Penyegaran sesudah aksi tidak boleh menggagalkan aksi yang sudah
        // berhasil (pemuat menangkap galatnya sendiri; allSettled = jaring kedua).
        await Promise.allSettled([muatKeadaan(), muatRiwayat()]);
        return r;
      } finally {
        sibukRef.current = false;
        setSibuk(false);
      }
    },
    [muatKeadaan, muatRiwayat],
  );

  const gantiKendaraanAktif = useCallback(
    async (k: KendaraanPilihan) => {
      const lama = kendaraanAktif;
      setKendaraanAktifState(k);
      let galat: string | null = null;
      try {
        const r = await setKendaraanAktifAction(kode, k);
        if (!r.success) galat = r.error;
      } catch {
        galat = "Gagal menyimpan kendaraan aktif — periksa koneksi.";
      }
      if (galat) {
        setKendaraanAktifState(lama);
        toast.error(galat);
      }
    },
    [kode, kendaraanAktif],
  );

  function gantiTab(t: TabKey) {
    setTab(t);
    setDikunjungi((s) => (s.has(t) ? s : new Set(s).add(t)));
    if (t === "riwayat") void muatRiwayat();
  }

  const daftarBak = useMemo(
    () => (keadaan?.data.denah?.elemen ?? []).filter((e): e is BakElemen => e.tipe === "bak"),
    [keadaan],
  );
  const petaKeadaan = useMemo(() => new Map((keadaan?.keadaan ?? []).map((k) => [k.kolomId, k])), [keadaan]);
  const bakTampil = daftarBak.find((b) => b.id === bakAktifId)?.id ?? daftarBak[0]?.id ?? "";
  const rekTerpilih = rekTerpilihId ? petaKeadaan.get(rekTerpilihId) ?? null : null;
  const namaBakTerpilih = rekTerpilih ? daftarBak.find((b) => b.id === rekTerpilih.bakId)?.nama.trim() || "Bak" : "";
  const sekarang = keadaan?.data.sekarang ?? awalKeadaan.data?.data.sekarang ?? "";
  const shift = sekarang ? shiftDari(new Date(sekarang)) : 1;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="z-20 flex flex-col gap-2 border-b bg-background px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="truncate text-sm leading-tight font-semibold">{namaOperator}</p>
            <p className="truncate text-xs text-muted-foreground">
              Shift {shift} · Produksi {namaPerusahaan}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5">
            {admin && (
              <Link
                href={`/${kode}/produksi`}
                className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-primary hover:bg-muted"
              >
                <MonitorCog className="size-4" /> Layar admin
              </Link>
            )}
            <AppearanceMenu />
            <SignOutButton />
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Kendaraan aktif</span>
          <PemilihKendaraan
            kode={kode}
            armada={awalArmada}
            armadaGalat={armadaGalat}
            nilai={kendaraanAktif}
            onPilih={(k) => void gantiKendaraanAktif(k)}
            disabled={sibuk}
          />
        </div>
      </header>

      <div className="relative min-h-0 flex-1">
        {dikunjungi.has("rek") && (
          <div className={cn("h-full overflow-y-auto", tab !== "rek" && "hidden")}>
            {galatKeadaan && (
              <p className="m-3 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
                {galatKeadaan}
                {keadaan && " Data di bawah mungkin belum terbaru."}
              </p>
            )}
            {keadaan && daftarBak.length === 0 && (
              <p className="m-3 rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{PESAN_DENAH_KOSONG}</p>
            )}
            {daftarBak.length > 0 && (
              <GridRek
                daftarBak={daftarBak}
                bakAktifId={bakTampil}
                onPilihBak={setBakAktifId}
                keadaan={petaKeadaan}
                onPilihRek={setRekTerpilihId}
              />
            )}
          </div>
        )}
        {dikunjungi.has("riwayat") && (
          <div className={cn("h-full overflow-y-auto", tab !== "riwayat" && "hidden")}>
            <RiwayatSaya
              data={riwayat}
              galat={galatRiwayat}
              memuat={memuatRiwayat}
              shift={shift}
              onSegarkan={() => void muatRiwayat()}
            />
          </div>
        )}
      </div>

      {/* Tidak `fixed` — saudara flex biasa di kolom h-dvh (pola satpam/driver app). */}
      <nav className="flex border-t border-border bg-background">
        {(
          [
            { key: "rek", label: "Rek", icon: LayoutGrid },
            { key: "riwayat", label: "Riwayat saya", icon: History },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => gantiTab(t.key)}
            className={cn(
              "flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px]",
              tab === t.key ? "text-primary" : "text-muted-foreground",
            )}
          >
            <t.icon className="size-5" />
            {t.label}
          </button>
        ))}
      </nav>

      <LembarAksiRek
        kode={kode}
        rek={rekTerpilih}
        namaBak={namaBakTerpilih}
        armada={awalArmada}
        armadaGalat={armadaGalat}
        kendaraanAktif={kendaraanAktif}
        sekarang={sekarang}
        sibuk={sibuk}
        jalankan={jalankan}
        onKendaraanTerakhir={(k) => void gantiKendaraanAktif(k)}
        onTutup={() => setRekTerpilihId(null)}
      />
    </div>
  );
}
