"use client";

import { useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, Ban, Droplets, Hammer, Snowflake, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buangBabonanAction,
  isiAirAction,
  mulaiMaintenanceAction,
  perbaikiRusakAction,
  selesaiMaintenanceAction,
  tandaiBabonanAction,
  tandaiRusakAction,
} from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import {
  hitungKematangan,
  tahapDari,
  validasiPilihSlot,
  type IsianAktif,
  type KeadaanRek,
  type KendaraanPilihan,
} from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { GridCan, LegendaCan } from "../grid-can";
import { formatUsia, singkatVarian, tanggalJamWib, WARNA_KEADAAN, WARNA_TAHAP } from "../warna-tahap";
import { FormPanen } from "./form-panen";
import type { Jalankan } from "./produksi-app";

type Tampilan =
  | { jenis: "menu" }
  | { jenis: "panen"; isianId: string }
  | { jenis: "isi-sebagian" }
  | { jenis: "tandai" }
  | { jenis: "buang" }
  | { jenis: "rusak" }
  | { jenis: "perbaiki" }
  | { jenis: "mulai-mt" };

/** Tampilan pertama saat lembar dibuka: menu, atau langsung formulir panen isian tertua. */
export type TampilanAwal = "menu" | "panen";

const JAM_MS = 3_600_000;

export interface PropsLembar {
  kode: KodeProduksi;
  rek: KeadaanRek | null;
  namaBak: string;
  armada: KendaraanArmada[];
  armadaGalat: string | null;
  kendaraanAktif: KendaraanPilihan | null;
  sekarang: string;
  sibuk: boolean;
  jalankan: Jalankan;
  onKendaraanTerakhir: (k: KendaraanPilihan) => void;
  onTutup: () => void;
  tampilanAwal?: TampilanAwal;
}

// Lembar bawah yang muncul saat baris rek / tugas diketuk: grid can, daftar
// isian aktif + aksi yang sesuai keadaan rek.
export function LembarAksiRek(props: PropsLembar) {
  const { rek, onTutup, tampilanAwal = "menu" } = props;
  return (
    <Sheet open={rek !== null} onOpenChange={(o) => !o && onTutup()}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        {rek && <IsiLembar key={`${rek.kolomId}:${tampilanAwal}`} {...props} rek={rek} />}
      </SheetContent>
    </Sheet>
  );
}

const JUDUL: Record<Exclude<Tampilan["jenis"], "menu" | "panen">, string> = {
  "isi-sebagian": "Isi Air — pilih can",
  tandai: "Tandai Babonan",
  buang: "Lepas Babonan — dibuang",
  rusak: "Tandai can rusak",
  perbaiki: "Can sudah diperbaiki",
  "mulai-mt": "Mulai Maintenance",
};

/**
 * Isi lembar aksi (tanpa pembungkus Sheet) — dipakai ulang DetailRek di layar
 * admin. `bolehAksi = false` = baca saja: grid & daftar isian tampil, tombol aksi tidak.
 */
export function IsiLembar({
  kode,
  rek,
  namaBak,
  armada,
  armadaGalat,
  kendaraanAktif,
  sekarang,
  sibuk,
  jalankan,
  onKendaraanTerakhir,
  onTutup,
  bolehAksi = true,
  tampilanAwal = "menu",
}: Omit<PropsLembar, "rek"> & { rek: KeadaanRek; bolehAksi?: boolean }) {
  const [tampilan, setTampilan] = useState<Tampilan>(() =>
    bolehAksi && tampilanAwal === "panen" && rek.isianProduksi[0]
      ? { jenis: "panen", isianId: rek.isianProduksi[0].id }
      : { jenis: "menu" },
  );
  const semuaIsian: IsianAktif[] = [...rek.isianProduksi, ...(rek.isianBabonan ? [rek.isianBabonan] : [])];
  const isianPanen = tampilan.jenis === "panen" ? semuaIsian.find((i) => i.id === tampilan.isianId) ?? null : null;
  const nonaktif = rek.utama === "nonaktif";

  const judul =
    tampilan.jenis === "menu"
      ? `${namaBak} · Rek ${rek.nomor}`
      : tampilan.jenis === "panen"
        ? isianPanen?.jenis === "babonan"
          ? "Lepas Babonan — dimuat"
          : "Panen & Isi Air"
        : JUDUL[tampilan.jenis];

  const kembali = () => setTampilan({ jenis: "menu" });
  const selesai = (r: { success: boolean }) => {
    if (r.success) onTutup();
  };

  // Slot per jenis (untuk grid pilih).
  const slotProduksi = useMemo(() => {
    const peta = new Map<number, string>();
    for (const i of rek.isianProduksi) for (const s of i.slot) peta.set(s, i.id);
    return peta;
  }, [rek.isianProduksi]);
  const slotBabonan = useMemo(() => new Set(rek.isianBabonan?.slot ?? []), [rek.isianBabonan]);
  const slotKosong = useMemo(() => new Set(rek.slotKosong), [rek.slotKosong]);
  const slotRusak = useMemo(() => new Set(rek.can.filter((c) => c.jenis === "rusak").map((c) => c.slot)), [rek.can]);

  return (
    <div className="flex flex-col gap-3 p-4 pb-6">
      <SheetHeader className="flex-row items-center gap-2 p-0 pr-8">
        {tampilan.jenis !== "menu" && (
          <Button variant="ghost" size="icon-sm" onClick={kembali} aria-label="Kembali" disabled={sibuk}>
            <ArrowLeft className="size-4" />
          </Button>
        )}
        <div className="min-w-0">
          <SheetTitle className="text-base">{judul}</SheetTitle>
          <SheetDescription className="text-xs">
            {tampilan.jenis !== "menu" && `Rek ${rek.nomor} · `}
            {singkatVarian(rek.varian)} · {rek.kapasitas} can · kosong {rek.canKosong}
            {rek.rusak > 0 && ` · rusak ${rek.rusak}`}
          </SheetDescription>
        </div>
      </SheetHeader>

      {tampilan.jenis === "menu" && (
        <Menu
          rek={rek}
          sekarang={sekarang}
          sibuk={sibuk}
          bolehAksi={bolehAksi}
          pilih={setTampilan}
          isiAirSemua={async () =>
            selesai(await jalankan(() => isiAirAction(kode, rek.kolomId, null), `Rek ${rek.nomor} diisi air ${rek.slotKosong.length} can.`))
          }
          selesaiMaintenance={async () => selesai(await jalankan(() => selesaiMaintenanceAction(kode, rek.kolomId), "Maintenance selesai."))}
        />
      )}

      {bolehAksi && tampilan.jenis === "panen" &&
        (isianPanen ? (
          <FormPanen
            key={isianPanen.id}
            kode={kode}
            rek={rek}
            isian={isianPanen}
            namaBak={namaBak}
            armada={armada}
            armadaGalat={armadaGalat}
            kendaraanAktif={kendaraanAktif}
            sibuk={sibuk}
            jalankan={jalankan}
            onKendaraanTerakhir={onKendaraanTerakhir}
            onSelesai={onTutup}
            sekarang={sekarang}
          />
        ) : (
          <p className="text-sm text-muted-foreground">Isian ini sudah tidak aktif (baru saja diubah). Kembali ke menu.</p>
        ))}

      {bolehAksi && tampilan.jenis === "isi-sebagian" && (
        <FormPilihSlot
          rek={rek}
          bolehDari={() => slotKosong}
          awal={rek.slotKosong}
          catatan="Hanya can kosong yang tidak rusak. Bawaan = semua."
          tombol={(n) => `Isi Air ${n} can`}
          ikon={<Droplets className="size-5" />}
          sibuk={sibuk}
          onKirim={async (slot) =>
            selesai(await jalankan(() => isiAirAction(kode, rek.kolomId, slot), `Rek ${rek.nomor} diisi air ${slot.length} can.`))
          }
        />
      )}

      {bolehAksi && tampilan.jenis === "tandai" && (
        <FormPilihSlot
          rek={rek}
          // Satu aksi = satu isian: sesudah can pertama dipilih, hanya can isian itu yang bisa dipilih.
          bolehDari={(p) => {
            const pertama = [...p].find((s) => slotProduksi.has(s));
            if (pertama === undefined) return new Set(slotProduksi.keys());
            const id = slotProduksi.get(pertama);
            return new Set([...slotProduksi].filter(([, i]) => i === id).map(([s]) => s));
          }}
          awal={[]}
          catatan="Can dipindah ke Babonan ◆ tanpa panen (penjaga suhu). Satu kali simpan = satu isian."
          tombol={(n) => `Tandai ${n} can Babonan`}
          pilihSemua={false}
          ikon={<Snowflake className="size-4" />}
          sibuk={sibuk}
          onKirim={async (slot) => {
            const isianId = slotProduksi.get(slot[0]);
            if (!isianId) return;
            selesai(await jalankan(() => tandaiBabonanAction(kode, isianId, slot), `${slot.length} can ditandai Babonan.`));
          }}
        />
      )}

      {bolehAksi && tampilan.jenis === "buang" && rek.isianBabonan && (
        <FormPilihSlot
          rek={rek}
          bolehDari={() => slotBabonan}
          awal={rek.isianBabonan.slot}
          catatan="Tidak dimuat ke kendaraan dan tidak ikut pencocokan DO. Can pecah ✕ boleh dibuang."
          tombol={(n) => `Buang ${n} can Babonan`}
          ikon={<Trash2 className="size-4" />}
          teks="Alasan (opsional)"
          merusak
          sibuk={sibuk}
          onKirim={async (slot, alasan) =>
            selesai(await jalankan(() => buangBabonanAction(kode, rek.kolomId, slot, alasan), `${slot.length} can Babonan dibuang.`))
          }
        />
      )}

      {bolehAksi && tampilan.jenis === "rusak" && (
        <FormPilihSlot
          rek={rek}
          bolehDari={() => slotKosong}
          awal={[]}
          catatan="Hanya can kosong. Can rusak dilewati saat Isi Air sampai ditandai sudah diperbaiki."
          tombol={(n) => `Tandai ${n} can rusak`}
          ikon={<Ban className="size-4" />}
          teks="Catatan (mis. bocor, penyok)"
          sibuk={sibuk}
          onKirim={async (slot, catatan) =>
            selesai(await jalankan(() => tandaiRusakAction(kode, rek.kolomId, slot, catatan), `${slot.length} can ditandai rusak.`))
          }
        />
      )}

      {bolehAksi && tampilan.jenis === "perbaiki" && (
        <FormPilihSlot
          rek={rek}
          bolehDari={() => slotRusak}
          awal={[...slotRusak]}
          catatan="Can yang dipilih kembali bisa diisi air."
          tombol={(n) => `${n} can sudah diperbaiki`}
          ikon={<Hammer className="size-4" />}
          sibuk={sibuk}
          onKirim={async (slot) =>
            selesai(await jalankan(() => perbaikiRusakAction(kode, rek.kolomId, slot), `${slot.length} can sudah diperbaiki.`))
          }
        />
      )}

      {bolehAksi && tampilan.jenis === "mulai-mt" && !nonaktif && (
        <FormCatatan
          sibuk={sibuk}
          onKirim={async (catatan) =>
            selesai(await jalankan(() => mulaiMaintenanceAction(kode, rek.kolomId, catatan), `Rek ${rek.nomor} masuk maintenance.`))
          }
        />
      )}
    </div>
  );
}

function Menu({
  rek,
  sekarang,
  sibuk,
  bolehAksi,
  pilih,
  isiAirSemua,
  selesaiMaintenance,
}: {
  rek: KeadaanRek;
  sekarang: string;
  sibuk: boolean;
  bolehAksi: boolean;
  pilih: (t: Tampilan) => void;
  isiAirSemua: () => void;
  selesaiMaintenance: () => void;
}) {
  const now = new Date(sekarang);
  const mt = rek.maintenance;
  const nonaktif = rek.utama === "nonaktif";
  const tertua = rek.isianProduksi[0] ?? null;
  const bolehIsi = !nonaktif && !mt && rek.slotKosong.length > 0;
  const bolehMulaiMt = !nonaktif && !mt && rek.isianProduksi.length === 0;
  const babonan = rek.isianBabonan;
  const bisaMuatBabonan = babonan ? babonan.slot.length > babonan.slotPecah.length : false;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 rounded-xl border bg-muted/30 p-2.5">
        <GridCan mode="lihat" can={rek.can} varian={rek.varian} />
        <LegendaCan />
      </div>

      {nonaktif && <p className="rounded-lg bg-muted p-3 text-sm">Rek ini dinonaktifkan di denah. Hubungi admin.</p>}

      {mt && (
        <div className={cn("rounded-lg border p-3 text-sm", WARNA_KEADAAN.maintenance.latar, WARNA_KEADAAN.maintenance.teks)}>
          <p className="flex items-center gap-1.5 font-semibold">
            <Wrench className="size-4" /> Maintenance sejak {tanggalJamWib(mt.mulaiAt)}
          </p>
          {mt.catatan && <p className="mt-1">{mt.catatan}</p>}
          <p className="mt-1 text-xs opacity-80">Dibuka oleh {mt.dibukaOlehNama}</p>
        </div>
      )}

      {rek.isianProduksi.length === 0 && !babonan && !mt && !nonaktif && <p className="text-sm text-muted-foreground">Rek kosong.</p>}

      {rek.isianProduksi.map((i, idx) => {
        const pct = hitungKematangan(new Date(i.mulaiAt), i.durasiBekuJam ?? 0, now);
        const w = WARNA_TAHAP[tahapDari(pct)];
        const matang = new Date(new Date(i.mulaiAt).getTime() + (i.durasiBekuJam ?? 0) * JAM_MS).toISOString();
        const usia = Math.floor((now.getTime() - new Date(i.mulaiAt).getTime()) / 60_000);
        return (
          <div key={i.id} className="flex items-start gap-2 rounded-lg border p-2.5 text-sm">
            <span className={cn("shrink-0 rounded-md border px-2 py-1 text-xs font-bold tabular-nums", w.latar, w.teks)}>{pct}%</span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold">
                {i.slot.length} can · isi {tanggalJamWib(i.mulaiAt)}
              </p>
              <p className="text-xs text-muted-foreground">
                {w.label} · usia {formatUsia(usia)} · matang ±{tanggalJamWib(matang)} · {i.diisiOlehNama}
              </p>
            </div>
            {bolehAksi && idx > 0 && (
              <Button variant="outline" size="sm" disabled={sibuk} onClick={() => pilih({ jenis: "panen", isianId: i.id })}>
                Panen
              </Button>
            )}
          </div>
        );
      })}

      {babonan && (
        <div className={cn("rounded-lg border p-2.5 text-sm", WARNA_KEADAAN.babonan.latar, WARNA_KEADAAN.babonan.teks)}>
          <p className="font-semibold">
            ◆ Babonan {rek.babonan} can
            {babonan.slotPecah.length > 0 && ` (✕ pecah ${babonan.slotPecah.length})`}
          </p>
          <p className="text-xs opacity-80">Sejak {tanggalJamWib(babonan.mulaiAt)}</p>
        </div>
      )}

      {bolehAksi && (
        <div className="flex flex-col gap-2 pt-1">
          {tertua && (
            <Button className="h-12 text-base" disabled={sibuk} onClick={() => pilih({ jenis: "panen", isianId: tertua.id })}>
              Panen & Isi Air
            </Button>
          )}
          {mt && (
            <Button className="h-12 text-base" disabled={sibuk} onClick={selesaiMaintenance}>
              Selesai Maintenance
            </Button>
          )}
          {bolehIsi && (
            <div className="flex flex-col gap-1">
              <Button variant={tertua ? "outline" : "default"} className="h-12 text-base" disabled={sibuk} onClick={isiAirSemua}>
                <Droplets className="size-5" /> Isi Air {rek.slotKosong.length} can
              </Button>
              <button
                type="button"
                disabled={sibuk}
                onClick={() => pilih({ jenis: "isi-sebagian" })}
                className="self-center py-1 text-xs text-muted-foreground underline underline-offset-4 disabled:opacity-50"
              >
                Isi sebagian — pilih can
              </button>
            </div>
          )}
          {tertua && (
            <Button variant="outline" className="h-11" disabled={sibuk} onClick={() => pilih({ jenis: "tandai" })}>
              <Snowflake className="size-4" /> Tandai Babonan
            </Button>
          )}
          {babonan && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11"
                disabled={sibuk || !bisaMuatBabonan}
                onClick={() => pilih({ jenis: "panen", isianId: babonan.id })}
              >
                Lepas: dimuat
              </Button>
              <Button variant="outline" className="h-11" disabled={sibuk} onClick={() => pilih({ jenis: "buang" })}>
                <Trash2 className="size-4" /> Lepas: dibuang
              </Button>
            </div>
          )}
          {!nonaktif && (rek.slotKosong.length > 0 || rek.rusak > 0) && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                className="h-11"
                disabled={sibuk || rek.slotKosong.length === 0}
                onClick={() => pilih({ jenis: "rusak" })}
              >
                <Ban className="size-4" /> Tandai rusak
              </Button>
              <Button variant="outline" className="h-11" disabled={sibuk || rek.rusak === 0} onClick={() => pilih({ jenis: "perbaiki" })}>
                <Hammer className="size-4" /> Sudah diperbaiki
              </Button>
            </div>
          )}
          {bolehMulaiMt && (
            <Button variant="ghost" className="h-10 text-muted-foreground" disabled={sibuk} onClick={() => pilih({ jenis: "mulai-mt" })}>
              <Wrench className="size-4" /> Mulai Maintenance
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// Formulir pilih slot di grid can (Isi sebagian, Tandai/Buang Babonan,
// Tandai rusak, Sudah diperbaiki). Pilihan efektif selalu ∩ slot yang boleh,
// supaya data yang berubah sesudah muat ulang tidak ikut terkirim.
function FormPilihSlot({
  rek,
  bolehDari,
  awal,
  catatan,
  tombol,
  ikon,
  teks,
  merusak,
  pilihSemua = true,
  sibuk,
  onKirim,
}: {
  rek: KeadaanRek;
  bolehDari: (pilihan: ReadonlySet<number>) => ReadonlySet<number>;
  awal: number[];
  catatan: string;
  tombol: (n: number) => string;
  ikon: ReactNode;
  pilihSemua?: boolean;
  teks?: string;
  merusak?: boolean;
  sibuk: boolean;
  onKirim: (slot: number[], teks: string) => void;
}) {
  const [pilihanMentah, setPilihan] = useState<Set<number>>(() => new Set(awal));
  const [isiTeks, setIsiTeks] = useState("");
  const bolehAwal = bolehDari(new Set());
  const pilihan = new Set([...pilihanMentah].filter((s) => bolehAwal.has(s)));
  const boleh = bolehDari(pilihan);
  const efektif = [...pilihan].filter((s) => boleh.has(s)).sort((a, b) => a - b);
  const galat = validasiPilihSlot(efektif, [...boleh]);
  const semuaDipilih = bolehAwal.size > 0 && [...bolehAwal].every((s) => pilihan.has(s));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5 rounded-xl border bg-muted/30 p-2.5">
        <GridCan mode="pilih" can={rek.can} varian={rek.varian} boleh={boleh} pilihan={new Set(efektif)} onUbah={setPilihan} disabled={sibuk} />
        <div className="flex items-center justify-between gap-2 text-xs">
          <span className="text-muted-foreground tabular-nums">
            Dipilih <b className="text-foreground">{efektif.length}</b> can
          </span>
          {pilihSemua && (
            <button
              type="button"
              disabled={sibuk}
              onClick={() => setPilihan(semuaDipilih ? new Set() : new Set(bolehAwal))}
              className="font-medium text-primary disabled:opacity-50"
            >
              {semuaDipilih ? "Hapus pilihan" : "Pilih semua"}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">{catatan}</p>
      {teks && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{teks}</span>
          <Textarea value={isiTeks} onChange={(e) => setIsiTeks(e.target.value)} rows={2} disabled={sibuk} />
        </label>
      )}
      <Button
        className="h-12 text-base"
        variant={merusak ? "destructive" : "default"}
        disabled={sibuk || galat !== null}
        onClick={() => onKirim(efektif, isiTeks.trim())}
      >
        {ikon} {tombol(efektif.length)}
      </Button>
    </div>
  );
}

function FormCatatan({ sibuk, onKirim }: { sibuk: boolean; onKirim: (catatan: string) => void }) {
  const [catatan, setCatatan] = useState("");
  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Catatan (mis. bocor, ganti can)</span>
        <Textarea value={catatan} onChange={(e) => setCatatan(e.target.value)} rows={3} disabled={sibuk} />
      </label>
      <p className="text-xs text-muted-foreground">Selama maintenance, rek tidak bisa diisi air.</p>
      <Button className="h-12 text-base" disabled={sibuk} onClick={() => onKirim(catatan.trim())}>
        <Wrench className="size-4" /> Mulai Maintenance
      </Button>
    </div>
  );
}
