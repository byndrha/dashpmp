"use client";

// Layar admin / monitoring produksi Es Balok (/{kode}/produksi, spec §8):
// tab Peta · Ringkasan · FIFO · Peringatan · (admin) Pencocokan · Log audit.
// Memegang data getKeadaanAction, disegarkan tiap 30 detik (dilewati saat tab
// browser tersembunyi) dan sesudah setiap aksi di DetailRek.
//
// Akses (spec §9): semua akun dashboard pabrik melihat 4 tab pertama (server
// action memakai gerbang "lihat"); tombol aksi hanya untuk `bolehAksi`;
// Pencocokan & Log audit hanya dirender untuk `admin` (dan server action-nya
// sendiri memakai gerbang "kelola").

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { getKeadaanAction } from "@/app/produksi-operasional-actions";
import { DenahPenampil } from "@/components/produksi-denah/denah-penampil";
import type { StatusKolom } from "@/components/produksi-denah/denah-kanvas";
import type { BakElemen, DenahDokumen, KodeProduksi } from "@/lib/produksi-denah";
import { kodeRek, type KeadaanRek, type Peringatan, type RingkasanStok, type Tahap } from "@/lib/produksi-operasional";
import type { DataPabrik } from "@/lib/queries/produksi-operasional";
import { isiPetaRek, jamWib, RENTANG_TAHAP, warnaRek, WARNA_KEADAAN, WARNA_TAHAP } from "../warna-tahap";
import { DaftarPeringatan } from "./daftar-peringatan";
import { DetailRek } from "./detail-rek";
import { RingkasanStokPanel } from "./ringkasan-stok";
import { TabelFifo } from "./tabel-fifo";
import { TabLogAudit } from "./tab-log-audit";
import { TabPencocokan } from "./tab-pencocokan";

export interface DataKeadaanAdmin {
  data: DataPabrik;
  keadaan: KeadaanRek[];
  peringatan: Peringatan[];
  ringkasan: RingkasanStok;
  /** Pemeriksaan DO (selisih muatan) gagal/lewat batas waktu di server. */
  selisihGagal: boolean;
}

type TabKey = "peta" | "ringkasan" | "fifo" | "peringatan" | "pencocokan" | "log";

const INTERVAL_SEGAR_MS = 30_000;
const PESAN_GAGAL_MUAT = "Gagal memuat keadaan produksi — periksa koneksi.";
const URUTAN_TAHAP: Tahap[] = ["air", "mulai", "kristal", "siap", "jadi"];

export function TabOperasional({
  kode,
  dokumen,
  admin,
  bolehAksi,
  awal,
  petaAtas,
  petaBawah,
}: {
  kode: KodeProduksi;
  /** Denah dari server (stabil — kanvas tidak digambar ulang setiap polling). */
  dokumen: DenahDokumen;
  /** bolehKelolaProduksi(user). */
  admin: boolean;
  /** bolehAksiProduksi(user). */
  bolehAksi: boolean;
  awal: { data: DataKeadaanAdmin | null; galat: string | null };
  /** Ringkasan denah lama (bak/kolom/ice can/kapasitas) di atas peta. */
  petaAtas?: React.ReactNode;
  /** Keterangan versi denah di bawah peta. */
  petaBawah?: React.ReactNode;
}) {
  const [hasil, setHasil] = useState<DataKeadaanAdmin | null>(awal.data);
  const [galat, setGalat] = useState<string | null>(awal.galat);
  const [memuat, setMemuat] = useState(false);
  const [tab, setTab] = useState<TabKey>("peta");
  const [rekId, setRekId] = useState<string | null>(null);
  // Penjaga urutan: polling 30 detik dan muat ulang sesudah aksi bisa saling
  // mendahului; hanya respons permintaan TERBARU yang boleh menimpa layar.
  const nomorMuat = useRef(0);

  const muat = useCallback(async () => {
    const nomor = ++nomorMuat.current;
    setMemuat(true);
    try {
      const r = await getKeadaanAction(kode);
      if (nomor !== nomorMuat.current) return;
      if (r.success) {
        setHasil(r.data);
        setGalat(null);
      } else {
        setGalat(r.error);
      }
    } catch {
      if (nomor === nomorMuat.current) setGalat(PESAN_GAGAL_MUAT);
    } finally {
      if (nomor === nomorMuat.current) setMemuat(false);
    }
  }, [kode]);

  useEffect(() => {
    const segar = () => {
      if (!document.hidden) void muat();
    };
    const id = setInterval(segar, INTERVAL_SEGAR_MS);
    document.addEventListener("visibilitychange", segar);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", segar);
    };
  }, [muat]);

  const onBerubah = useCallback(() => {
    void muat();
  }, [muat]);

  const daftarBak = useMemo(
    () => dokumen.elemen.filter((e): e is BakElemen => e.tipe === "bak").map((b) => ({ id: b.id, nama: b.nama.trim() || "Bak" })),
    [dokumen],
  );
  const namaBak = useMemo(() => new Map(daftarBak.map((b) => [b.id, b.nama])), [daftarBak]);
  const keadaan = useMemo(() => hasil?.keadaan ?? [], [hasil]);
  const petaKeadaan = useMemo(() => new Map(keadaan.map((k) => [k.kolomId, k])), [keadaan]);

  const statusKolom = useMemo(() => {
    const s: Record<string, StatusKolom> = {};
    for (const k of keadaan) {
      if (k.utama === "nonaktif") continue; // pola arsir nonaktif bawaan kanvas tetap terlihat
      const w = warnaRek(k.utama, k.tahap);
      const bagian = [`${namaBak.get(k.bakId) ?? "Bak"} – Rek ${k.nomor} (${kodeRek(k.kodeBak, k.nomor)})`];
      bagian.push(k.utama === "berisi" ? `${k.pct ?? 0}% ${w.label}` : w.label);
      if (k.utama === "berisi" && k.babonan > 0) bagian.push(`Babonan ${k.babonan}`);
      bagian.push(`kosong ${k.canKosong}/${k.kapasitas} can`);
      s[k.kolomId] = { warna: isiPetaRek(k.utama, k.tahap), label: bagian.join(" · ") };
    }
    return s;
  }, [keadaan, namaBak]);

  const rek = rekId ? (petaKeadaan.get(rekId) ?? null) : null;
  const sekarang = hasil?.data.sekarang ?? null;
  const jumlahPeringatan = hasil?.peringatan.length ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {galat && (
          <p className="w-full rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
            {galat}
            {hasil && " Data di bawah mungkin belum terbaru."}
          </p>
        )}
        <span>
          {sekarang ? `Keadaan per ${jamWib(sekarang)} WIB · disegarkan otomatis tiap 30 detik` : "Keadaan produksi belum termuat."}
        </span>
        <Button variant="ghost" size="sm" onClick={() => void muat()} disabled={memuat} className="ml-auto">
          <RefreshCw className={cn("size-3.5", memuat && "animate-spin")} /> Segarkan
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => typeof v === "string" && setTab(v as TabKey)}>
        <TabsList className="no-scrollbar w-full justify-start overflow-x-auto">
          <TabsTrigger value="peta" className="shrink-0">
            Peta
          </TabsTrigger>
          <TabsTrigger value="ringkasan" className="shrink-0">
            Ringkasan
          </TabsTrigger>
          <TabsTrigger value="fifo" className="shrink-0">
            FIFO
          </TabsTrigger>
          <TabsTrigger value="peringatan" className="shrink-0">
            Peringatan
            {jumlahPeringatan === 0 && admin && hasil?.selisihGagal && (
              <span className="rounded-full bg-amber-500 px-1.5 text-[11px] leading-4 font-semibold text-white">!</span>
            )}
            {jumlahPeringatan > 0 && (
              <span className="rounded-full bg-destructive px-1.5 text-[11px] leading-4 font-semibold text-white tabular-nums">
                {jumlahPeringatan}
              </span>
            )}
          </TabsTrigger>
          {admin && (
            <>
              <TabsTrigger value="pencocokan" className="shrink-0">
                Pencocokan
              </TabsTrigger>
              <TabsTrigger value="log" className="shrink-0">
                Log audit
              </TabsTrigger>
            </>
          )}
        </TabsList>

        <TabsContent value="peta" className="flex flex-col gap-3">
          {petaAtas}
          <DenahPenampil
            dokumen={dokumen}
            statusKolom={hasil ? statusKolom : undefined}
            onKlikKolom={hasil ? setRekId : undefined}
            kolomTerpilihId={rekId}
            legenda={hasil ? <LegendaStatus /> : undefined}
          />
          {petaBawah}
        </TabsContent>
        <TabsContent value="ringkasan">
          {hasil && sekarang ? <RingkasanStokPanel ringkasan={hasil.ringkasan} keadaan={keadaan} sekarang={sekarang} /> : <BelumTermuat />}
        </TabsContent>
        <TabsContent value="fifo">
          {hasil && sekarang ? (
            <TabelFifo keadaan={keadaan} sekarang={sekarang} namaBak={namaBak} daftarBak={daftarBak} onPilihRek={setRekId} />
          ) : (
            <BelumTermuat />
          )}
        </TabsContent>
        <TabsContent value="peringatan">
          {hasil ? (
            <DaftarPeringatan peringatan={hasil.peringatan} selisihGagal={admin && hasil.selisihGagal} onPilihRek={setRekId} />
          ) : (
            <BelumTermuat />
          )}
        </TabsContent>
        {admin && (
          <>
            <TabsContent value="pencocokan">
              <TabPencocokan kode={kode} />
            </TabsContent>
            <TabsContent value="log">
              <TabLogAudit kode={kode} daftarBak={daftarBak} />
            </TabsContent>
          </>
        )}
      </Tabs>

      <Sheet open={rek !== null} onOpenChange={(o) => !o && setRekId(null)}>
        <SheetContent side="right" className="w-full gap-0 data-[side=right]:sm:max-w-md">
          {rek && (
            <DetailRek
              key={rek.kolomId}
              kode={kode}
              keadaan={rek}
              admin={admin}
              bolehAksi={bolehAksi}
              namaBak={namaBak.get(rek.bakId)}
              sekarang={sekarang ?? undefined}
              onBerubah={onBerubah}
              onTutup={() => setRekId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function BelumTermuat() {
  return <p className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">Keadaan produksi belum termuat.</p>;
}

function LegendaStatus() {
  const isi: { label: string; warna: string }[] = [
    ...URUTAN_TAHAP.map((t) => ({ label: `${WARNA_TAHAP[t].label} ${RENTANG_TAHAP[t]}`, warna: isiPetaRek("berisi", t) })),
    { label: WARNA_KEADAAN.babonan.label, warna: isiPetaRek("babonan", null) },
    { label: WARNA_KEADAAN.maintenance.label, warna: isiPetaRek("maintenance", null) },
    { label: WARNA_KEADAAN.kosong.label, warna: isiPetaRek("kosong", null) },
  ];
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {isi.map((l) => (
        <span key={l.label} className="flex items-center gap-1.5">
          <span className="size-3 rounded-sm border border-border" style={{ backgroundColor: l.warna }} /> {l.label}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="size-3 rounded-sm bg-[repeating-linear-gradient(45deg,var(--muted-foreground)_0_1px,var(--muted)_1px_4px)] opacity-80" /> Nonaktif
      </span>
    </div>
  );
}
