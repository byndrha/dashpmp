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
  isiAirAction,
  setKendaraanAktifAction,
} from "@/app/produksi-operasional-actions";
import type { ActionResult } from "@/lib/action-result";
import type { BakElemen, KodeProduksi } from "@/lib/produksi-denah";
import {
  cocokFilterVarian,
  filterVarianSah,
  shiftDari,
  type FilterVarian,
  type KeadaanRek,
  type KendaraanPilihan,
  type RingkasanBak,
  type Tugas,
} from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import type { DataPabrik, KodeGalatProduksi } from "@/lib/queries/produksi-operasional";
import { LegendaCan } from "../grid-can";
import { DaftarRek } from "./daftar-rek";
import { DaftarTugas } from "./daftar-tugas";
import { LembarAksiRek, type TampilanAwal } from "./lembar-aksi-rek";
import { singkatVarian } from "../warna-tahap";
import { PemilihKendaraan } from "./pemilih-kendaraan";
import { RiwayatSaya, type DataRiwayat } from "./riwayat-saya";

export type HasilAksi<T> = ActionResult<T> | { success: false; error: string; kodeGalat: KodeGalatProduksi };

/**
 * Menjalankan satu aksi tulis: tombol aksi dikunci selama permintaan berjalan,
 * hasil ditampilkan sebagai toast, lalu keadaan disegarkan (juga saat gagal —
 * KEADAAN_BERUBAH/KAPASITAS berarti data di layar basi). Galat BELUM_SIAP
 * tidak di-toast — formulir panen menampilkan dialog konfirmasinya sendiri.
 */
export type Jalankan = <T>(fn: () => Promise<HasilAksi<T>>, pesanSukses: string) => Promise<HasilAksi<T>>;

type TabKey = "rek" | "riwayat";

export interface DataKeadaan {
  data: DataPabrik;
  keadaan: KeadaanRek[];
  ringkasBak: RingkasanBak[];
  tugas: Tugas[];
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
  const [rekTerpilih, setRekTerpilih] = useState<{ kolomId: string; awal: TampilanAwal } | null>(null);
  const [sibuk, setSibuk] = useState(false);
  const sibukRef = useRef(false);

  // Kedua pemuat tidak pernah melempar: kegagalan jaringan (wifi putus)
  // ditampilkan sebagai galat, data lama tetap tampil.
  // Penjaga urutan: respons polling lama tidak boleh menimpa respons sesudah aksi.
  const nomorMuat = useRef(0);
  const muatKeadaan = useCallback(async () => {
    const nomor = ++nomorMuat.current;
    try {
      const r = await getKeadaanAction(kode);
      if (nomor !== nomorMuat.current) return;
      if (r.success) {
        setKeadaan({ data: r.data.data, keadaan: r.data.keadaan, ringkasBak: r.data.ringkasBak, tugas: r.data.tugas });
        setGalatKeadaan(null);
      } else {
        setGalatKeadaan(r.error);
      }
    } catch {
      if (nomor === nomorMuat.current) setGalatKeadaan(PESAN_GAGAL_MUAT);
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

  // Isi Air dari daftar tugas = SATU ketukan: semua slot kosong tak rusak (slot null).
  const isiAirSatuKetuk = useCallback(
    (rek: KeadaanRek) => {
      void jalankan(() => isiAirAction(kode, rek.kolomId, null), `Rek ${rek.nomor} diisi air ${rek.slotKosong.length} can.`);
    },
    [jalankan, kode],
  );

  // "Isi semua" dari baris kelompok tugas (sesudah dialog konfirmasi di
  // DaftarTugas): Isi Air per rek BERURUTAN di bawah satu kunci permintaan,
  // berhenti pada galat pertama, satu toast ringkasan (jumlah dari hasil server).
  const isiAirBanyak = useCallback(
    async (daftar: KeadaanRek[]) => {
      if (daftar.length === 0) return;
      if (sibukRef.current) {
        toast.error("Masih memproses aksi sebelumnya.");
        return;
      }
      sibukRef.current = true;
      setSibuk(true);
      try {
        let berhasil = 0;
        let can = 0;
        let galat: string | null = null;
        for (const rek of daftar) {
          let r: HasilAksi<{ isianId: string; jumlah: number }>;
          try {
            r = await isiAirAction(kode, rek.kolomId, null);
          } catch {
            r = { success: false, error: "Koneksi gagal. Coba lagi." };
          }
          if (!r.success) {
            galat = `Rek ${rek.nomor}: ${r.error}`;
            break;
          }
          berhasil++;
          // Jumlah can dari server (bisa beda dari layar bila rek berubah sejak dimuat).
          can += r.data.jumlah;
        }
        if (galat) toast.error(`${berhasil} dari ${daftar.length} rek diisi air, lalu berhenti. ${galat}`);
        else toast.success(`${berhasil} rek diisi air (${can} can).`);
        await Promise.allSettled([muatKeadaan(), muatRiwayat()]);
      } finally {
        sibukRef.current = false;
        setSibuk(false);
      }
    },
    [kode, muatKeadaan, muatRiwayat],
  );

  // Filter varian dibaca setelah mount (localStorage tidak ada di server) dan
  // gagal dengan tenang bila penyimpanan diblokir.
  const kunciFilter = `produksi-app:filter-varian:${kode}`;
  const [filterTersimpan, setFilterTersimpan] = useState<string | null>(null);
  useEffect(() => {
    let v: string | null = null;
    try {
      v = window.localStorage.getItem(kunciFilter);
    } catch {
      v = null;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sinkron sekali dari penyimpanan browser
    setFilterTersimpan(v);
  }, [kunciFilter]);
  function pilihFilter(f: FilterVarian) {
    setFilterTersimpan(f);
    try {
      window.localStorage.setItem(kunciFilter, f);
    } catch {
      /* penyimpanan tidak tersedia — filter tetap berlaku untuk sesi ini */
    }
  }

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
  const bakAktif = daftarBak.find((b) => b.id === bakAktifId) ?? daftarBak[0] ?? null;
  const bakTampil = bakAktif?.id ?? "";
  const rekLembar = rekTerpilih ? petaKeadaan.get(rekTerpilih.kolomId) ?? null : null;
  const namaBakTerpilih = rekLembar ? daftarBak.find((b) => b.id === rekLembar.bakId)?.nama.trim() || "Bak" : "";
  // Satu entri per varian di bak aktif; filter BK/BB hanya muncul bila ≥ 2 varian.
  const ringkasanBak = useMemo(() => (keadaan?.ringkasBak ?? []).filter((r) => r.bakId === bakTampil), [keadaan, bakTampil]);
  const varianBak = useMemo(() => ringkasanBak.map((r) => r.varian), [ringkasanBak]);
  const filter: FilterVarian = filterVarianSah(filterTersimpan, varianBak);
  const tampilFilter = varianBak.length >= 2;
  const filterAktif: FilterVarian = tampilFilter ? filter : "semua";
  const tugasBak = useMemo(
    () => (keadaan?.tugas ?? []).filter((t) => t.bakId === bakTampil && cocokFilterVarian(filterAktif, t.varian)),
    [keadaan, bakTampil, filterAktif],
  );
  const rekSlotBelumSiap = useMemo(
    () => (keadaan?.keadaan ?? []).filter((k) => k.bakId === bakTampil && k.slotBelumSiap && k.utama !== "nonaktif" && cocokFilterVarian(filterAktif, k.varian)),
    [keadaan, bakTampil, filterAktif],
  );
  const panenPerBak = useMemo(() => {
    const m = new Map<string, number>();
    for (const t of keadaan?.tugas ?? []) if (t.jenis === "panen") m.set(t.bakId, (m.get(t.bakId) ?? 0) + 1);
    return m;
  }, [keadaan]);
  const sekarang = keadaan?.data.sekarang ?? awalKeadaan.data?.data.sekarang ?? "";
  const shift = sekarang ? shiftDari(new Date(sekarang)) : 1;

  return (
    <div className="flex h-dvh flex-col bg-background">
      <header className="z-20 flex flex-col gap-1.5 border-b bg-background px-3 py-2">
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
        <div className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-xs text-muted-foreground">Kendaraan</span>
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
            {bakAktif && (
              <div className="flex flex-col pb-4">
                <TabBak daftarBak={daftarBak} bakAktifId={bakAktif.id} onPilih={setBakAktifId} panenPerBak={panenPerBak} />
                <ChipRingkasan ringkasan={ringkasanBak} filter={tampilFilter ? filter : null} onFilter={pilihFilter} />
                <DaftarTugas
                  key={bakAktif.id}
                  tugas={tugasBak}
                  rekSlotBelumSiap={rekSlotBelumSiap}
                  keadaan={petaKeadaan}
                  sekarang={sekarang}
                  sibuk={sibuk}
                  onPanen={(kolomId) => setRekTerpilih({ kolomId, awal: "panen" })}
                  onIsiAir={isiAirSatuKetuk}
                  onIsiAirSemua={(daftar) => void isiAirBanyak(daftar)}
                  onBuka={(kolomId) => setRekTerpilih({ kolomId, awal: "menu" })}
                />
                <h2 className="px-3 pt-4 pb-1.5 text-[11px] font-bold tracking-wider text-muted-foreground uppercase">Semua rek</h2>
                <DaftarRek bak={bakAktif} keadaan={petaKeadaan} filter={filterAktif} onPilihRek={(kolomId) => setRekTerpilih({ kolomId, awal: "menu" })} />
                <LegendaCan className="px-3 pt-3" />
              </div>
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
        rek={rekLembar}
        tampilanAwal={rekTerpilih?.awal ?? "menu"}
        namaBak={namaBakTerpilih}
        armada={awalArmada}
        armadaGalat={armadaGalat}
        kendaraanAktif={kendaraanAktif}
        sekarang={sekarang}
        sibuk={sibuk}
        jalankan={jalankan}
        onKendaraanTerakhir={(k) => void gantiKendaraanAktif(k)}
        onTutup={() => setRekTerpilih(null)}
      />
    </div>
  );
}

// Tab bak: lebar sama (grid), tidak pernah terpotong; lencana = rek siap panen.
function TabBak({
  daftarBak,
  bakAktifId,
  onPilih,
  panenPerBak,
}: {
  daftarBak: BakElemen[];
  bakAktifId: string;
  onPilih: (id: string) => void;
  panenPerBak: Map<string, number>;
}) {
  return (
    <div
      className="sticky top-0 z-10 grid gap-1 border-b bg-background px-2 pt-2.5 pb-2"
      style={{ gridTemplateColumns: `repeat(${daftarBak.length}, minmax(0, 1fr))` }}
    >
      {daftarBak.map((b) => {
        const aktif = b.id === bakAktifId;
        const panen = panenPerBak.get(b.id) ?? 0;
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onPilih(b.id)}
            aria-current={aktif ? "true" : undefined}
            aria-label={`${b.nama.trim() || "Bak"}${panen > 0 ? `, ${panen} rek siap panen` : ""}`}
            className={cn(
              "relative flex h-10 min-w-0 items-center justify-center rounded-lg border px-1 text-sm font-semibold",
              aktif ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
            )}
          >
            <span className="truncate">{b.nama.trim() || "Bak"}</span>
            {panen > 0 && (
              <span className="absolute -top-1.5 -right-1 min-w-4 rounded-full bg-green-600 px-1 text-[10px] leading-4 font-bold text-white tabular-nums">
                {panen}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

// Chip jumlah rek per kategori, satu baris per varian bak aktif (ringkasBak di
// server), diawali "BK 30 rek". Filter Semua | BK | BB hanya bila ≥ 2 varian.
function ChipRingkasan({
  ringkasan,
  filter,
  onFilter,
}: {
  ringkasan: RingkasanBak[];
  filter: FilterVarian | null;
  onFilter: (f: FilterVarian) => void;
}) {
  const opsi: { nilai: FilterVarian; label: string }[] = [
    { nilai: "semua", label: "Semua" },
    ...ringkasan.map((r) => ({ nilai: r.varian as FilterVarian, label: singkatVarian(r.varian) })),
  ];
  return (
    <div className="flex flex-col gap-1.5 px-3 pt-2.5">
      {filter !== null && (
        <div role="group" aria-label="Saring varian" className="flex gap-1">
          {opsi.map((o) => (
            <button
              key={o.nilai}
              type="button"
              onClick={() => onFilter(o.nilai)}
              aria-pressed={filter === o.nilai}
              className={cn(
                "h-8 min-w-14 rounded-full border px-3 text-xs font-semibold",
                filter === o.nilai ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
      {ringkasan.map((r) => (
        <BarisChip key={r.varian} r={r} />
      ))}
    </div>
  );
}

function BarisChip({ r }: { r: RingkasanBak }) {
  const chip = [
    {
      label: "Siap",
      n: r.siap,
      tanda: <span className="size-2.5 shrink-0 rounded-full bg-green-600" />,
      kelas: "border-green-600/60 bg-green-50 text-green-800 dark:bg-green-950/60 dark:text-green-200",
    },
    {
      label: "Kosong",
      n: r.kosong,
      tanda: <span className="size-2.5 shrink-0 rounded-full border border-dashed border-current" />,
      kelas: "border-dashed border-zinc-400 text-foreground dark:border-zinc-500",
    },
    {
      label: "Babonan",
      n: r.babonan,
      tanda: <span className="shrink-0 text-[10px] leading-none">◆</span>,
      kelas: "border-orange-500/60 bg-orange-50 text-orange-800 dark:bg-orange-950/60 dark:text-orange-200",
    },
    {
      label: "Rusak",
      n: r.rusak,
      tanda: <span className="shrink-0 text-[10px] leading-none">✕</span>,
      kelas: "border-zinc-400 bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200",
    },
  ];
  return (
    <div className="flex flex-col gap-1">
      <p className="text-xs text-muted-foreground">
        <b className="text-foreground">{singkatVarian(r.varian)}</b> {r.rek} rek
      </p>
      {/* 2 × 2 di layar HP (≥ 375 px label tidak terpotong), 4 kolom di layar lebar. */}
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
        {chip.map((c) => (
          <span
            key={c.label}
            className={cn(
              "flex min-w-0 items-center justify-center gap-1 rounded-full border px-1.5 py-1 text-xs font-semibold",
              c.kelas,
              c.n === 0 && "opacity-45",
            )}
          >
            {c.tanda}
            <span className="truncate">{c.label}</span>
            <b className="tabular-nums">{c.n}</b>
          </span>
        ))}
      </div>
    </div>
  );
}
