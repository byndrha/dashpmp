"use client";

import { useState } from "react";
import { ArrowLeft, Droplets, Snowflake, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  buangBabonanAction,
  isiAirAction,
  mulaiMaintenanceAction,
  selesaiMaintenanceAction,
  tandaiBabonanAction,
} from "@/app/produksi-operasional-actions";
import type { KodeProduksi } from "@/lib/produksi-denah";
import { hitungKematangan, tahapDari, type IsianAktif, type KeadaanRek, type KendaraanPilihan } from "@/lib/produksi-operasional";
import type { KendaraanArmada } from "@/lib/queries/produksi-do-erp";
import { formatUsia, singkatVarian, tanggalJamWib, WARNA_KEADAAN, WARNA_TAHAP } from "../warna-tahap";
import { FormPanen } from "./form-panen";
import type { Jalankan } from "./produksi-app";

type Tampilan =
  | { jenis: "menu" }
  | { jenis: "panen"; isianId: string }
  | { jenis: "isi-air" }
  | { jenis: "tandai" }
  | { jenis: "buang" }
  | { jenis: "mulai-mt" };

const JAM_MS = 3_600_000;

export interface PropsLembar {
  kode: KodeProduksi;
  rek: KeadaanRek | null;
  namaBak: string;
  armada: KendaraanArmada[];
  kendaraanAktif: KendaraanPilihan | null;
  sekarang: string;
  sibuk: boolean;
  jalankan: Jalankan;
  onKendaraanTerakhir: (k: KendaraanPilihan) => void;
  onTutup: () => void;
}

// Lembar bawah yang muncul saat kartu rek diketuk (spec §7): daftar isian
// aktif + aksi yang sesuai keadaan rek.
export function LembarAksiRek(props: PropsLembar) {
  const { rek, onTutup } = props;
  return (
    <Sheet open={rek !== null} onOpenChange={(o) => !o && onTutup()}>
      <SheetContent side="bottom" className="max-h-[92dvh] gap-0 overflow-y-auto rounded-t-2xl p-0">
        {rek && <IsiLembar key={rek.kolomId} {...props} rek={rek} />}
      </SheetContent>
    </Sheet>
  );
}

function IsiLembar({
  kode,
  rek,
  namaBak,
  armada,
  kendaraanAktif,
  sekarang,
  sibuk,
  jalankan,
  onKendaraanTerakhir,
  onTutup,
}: PropsLembar & { rek: KeadaanRek }) {
  const [tampilan, setTampilan] = useState<Tampilan>({ jenis: "menu" });
  const semuaIsian: IsianAktif[] = [...rek.isianProduksi, ...(rek.isianBabonan ? [rek.isianBabonan] : [])];
  const isianPanen = tampilan.jenis === "panen" ? semuaIsian.find((i) => i.id === tampilan.isianId) ?? null : null;
  const tertua = rek.isianProduksi[0] ?? null;

  const judul =
    tampilan.jenis === "panen"
      ? isianPanen?.jenis === "babonan"
        ? "Lepas Babonan — dimuat"
        : "Panen & Isi Air"
      : tampilan.jenis === "isi-air"
        ? "Isi Air"
        : tampilan.jenis === "tandai"
          ? "Tandai Babonan"
          : tampilan.jenis === "buang"
            ? "Lepas Babonan — dibuang"
            : tampilan.jenis === "mulai-mt"
              ? "Mulai Maintenance"
              : `${namaBak} · Rek ${rek.nomor}`;

  const kembali = () => setTampilan({ jenis: "menu" });

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
            {singkatVarian(rek.varian)} · kapasitas {rek.kapasitas} can · kosong {rek.canKosong}
          </SheetDescription>
        </div>
      </SheetHeader>

      {tampilan.jenis === "menu" && (
        <Menu
          rek={rek}
          sekarang={sekarang}
          sibuk={sibuk}
          tertua={tertua}
          pilih={setTampilan}
          selesaiMaintenance={async () => {
            const r = await jalankan(() => selesaiMaintenanceAction(kode, rek.kolomId), "Maintenance selesai.");
            if (r.success) onTutup();
          }}
        />
      )}

      {tampilan.jenis === "panen" &&
        (isianPanen ? (
          <FormPanen
            key={isianPanen.id}
            kode={kode}
            rek={rek}
            isian={isianPanen}
            namaBak={namaBak}
            armada={armada}
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

      {tampilan.jenis === "isi-air" && (
        <FormJumlah
          label="Jumlah can diisi air"
          maks={rek.canKosong}
          awal={rek.canKosong}
          catatan="Bawaan = semua can kosong. Kurangi kalau ada can rusak."
          tombol={(n) => `Isi Air ${n} can`}
          sibuk={sibuk}
          onKirim={async (n) => {
            const r = await jalankan(() => isiAirAction(kode, rek.kolomId, n === rek.canKosong ? null : n), `Rek ${rek.nomor} diisi air ${n} can.`);
            if (r.success) onTutup();
          }}
        />
      )}

      {tampilan.jenis === "tandai" && tertua && (
        <FormJumlah
          label={`Can dijadikan Babonan (isian ${tanggalJamWib(tertua.mulaiAt)}, sisa ${tertua.sisa})`}
          maks={tertua.sisa}
          awal={Math.min(2, tertua.sisa)}
          catatan="Can dipindah ke Babonan tanpa panen (penjaga suhu)."
          tombol={(n) => `Tandai ${n} can Babonan`}
          sibuk={sibuk}
          onKirim={async (n) => {
            const r = await jalankan(() => tandaiBabonanAction(kode, tertua.id, n), `${n} can ditandai Babonan.`);
            if (r.success) onTutup();
          }}
        />
      )}

      {tampilan.jenis === "buang" && rek.isianBabonan && (
        <FormJumlah
          label={`Can Babonan dibuang/dilebur (ada ${rek.babonan})`}
          maks={rek.babonan}
          awal={rek.babonan}
          catatan="Tidak dimuat ke kendaraan dan tidak ikut pencocokan DO."
          tombol={(n) => `Buang ${n} can Babonan`}
          teks={{ label: "Alasan (opsional)", wajib: false }}
          merusak
          sibuk={sibuk}
          onKirim={async (n, alasan) => {
            const r = await jalankan(() => buangBabonanAction(kode, rek.kolomId, n, alasan), `${n} can Babonan dibuang.`);
            if (r.success) onTutup();
          }}
        />
      )}

      {tampilan.jenis === "mulai-mt" && (
        <FormCatatan
          sibuk={sibuk}
          onKirim={async (catatan) => {
            const r = await jalankan(() => mulaiMaintenanceAction(kode, rek.kolomId, catatan), `Rek ${rek.nomor} masuk maintenance.`);
            if (r.success) onTutup();
          }}
        />
      )}
    </div>
  );
}

function Menu({
  rek,
  sekarang,
  sibuk,
  tertua,
  pilih,
  selesaiMaintenance,
}: {
  rek: KeadaanRek;
  sekarang: string;
  sibuk: boolean;
  tertua: IsianAktif | null;
  pilih: (t: Tampilan) => void;
  selesaiMaintenance: () => void;
}) {
  const now = new Date(sekarang);
  const mt = rek.maintenance;
  const nonaktif = rek.utama === "nonaktif";
  const bolehIsi = !nonaktif && !mt && rek.canKosong > 0;
  const bolehMulaiMt = !nonaktif && !mt && rek.isianProduksi.length === 0;

  return (
    <div className="flex flex-col gap-3">
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

      {rek.isianProduksi.length === 0 && !rek.isianBabonan && !mt && !nonaktif && (
        <p className="text-sm text-muted-foreground">Rek kosong.</p>
      )}

      {rek.isianProduksi.map((i, idx) => {
        const pct = hitungKematangan(new Date(i.mulaiAt), i.durasiBekuJam ?? 0, now);
        const w = WARNA_TAHAP[tahapDari(pct)];
        const matang = new Date(new Date(i.mulaiAt).getTime() + (i.durasiBekuJam ?? 0) * JAM_MS).toISOString();
        const usia = Math.floor((now.getTime() - new Date(i.mulaiAt).getTime()) / 60_000);
        return (
          <div key={i.id} className="rounded-lg border p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold">
                Isi {tanggalJamWib(i.mulaiAt)} · {i.sisa} can
              </span>
              <span className={cn("rounded-md border px-2 py-0.5 text-xs font-bold", w.latar, w.teks)}>
                {pct}% {w.label}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Usia {formatUsia(usia)} · matang ±{tanggalJamWib(matang)} · diisi {i.diisiOlehNama}
            </p>
            {idx > 0 && (
              <button
                type="button"
                disabled={sibuk}
                onClick={() => pilih({ jenis: "panen", isianId: i.id })}
                className="mt-1 text-xs font-medium text-primary underline underline-offset-4"
              >
                Panen isian ini
              </button>
            )}
          </div>
        );
      })}

      {rek.isianBabonan && (
        <div className={cn("rounded-lg border p-3 text-sm", WARNA_KEADAAN.babonan.latar, WARNA_KEADAAN.babonan.teks)}>
          <p className="flex items-center gap-1.5 font-semibold">
            <Snowflake className="size-4" /> Babonan {rek.babonan} can
            {rek.isianBabonan.pecah > 0 && ` (pecah ${rek.isianBabonan.pecah})`}
          </p>
          <p className="mt-1 text-xs opacity-80">Sejak {tanggalJamWib(rek.isianBabonan.mulaiAt)}</p>
        </div>
      )}

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
          <Button
            variant={tertua ? "outline" : "default"}
            className="h-12 text-base"
            disabled={sibuk}
            onClick={() => pilih({ jenis: "isi-air" })}
          >
            <Droplets className="size-5" /> Isi Air {rek.canKosong} can
          </Button>
        )}
        {tertua && (
          <Button variant="outline" className="h-11" disabled={sibuk} onClick={() => pilih({ jenis: "tandai" })}>
            <Snowflake className="size-4" /> Tandai Babonan
          </Button>
        )}
        {rek.isianBabonan && (
          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              className="h-11"
              disabled={sibuk}
              onClick={() => rek.isianBabonan && pilih({ jenis: "panen", isianId: rek.isianBabonan.id })}
            >
              Lepas: dimuat
            </Button>
            <Button variant="outline" className="h-11" disabled={sibuk} onClick={() => pilih({ jenis: "buang" })}>
              <Trash2 className="size-4" /> Lepas: dibuang
            </Button>
          </div>
        )}
        {bolehMulaiMt && (
          <Button variant="ghost" className="h-10 text-muted-foreground" disabled={sibuk} onClick={() => pilih({ jenis: "mulai-mt" })}>
            <Wrench className="size-4" /> Mulai Maintenance
          </Button>
        )}
      </div>
    </div>
  );
}

function FormJumlah({
  label,
  maks,
  awal,
  catatan,
  tombol,
  teks,
  merusak,
  sibuk,
  onKirim,
}: {
  label: string;
  maks: number;
  awal: number;
  catatan: string;
  tombol: (n: number) => string;
  teks?: { label: string; wajib: boolean };
  merusak?: boolean;
  sibuk: boolean;
  onKirim: (n: number, teks: string) => void;
}) {
  const [nilai, setNilai] = useState(String(awal));
  const [isiTeks, setIsiTeks] = useState("");
  const n = /^\d+$/.test(nilai.trim()) ? Number(nilai.trim()) : Number.NaN;
  const galat = Number.isNaN(n) || n < 1 ? "Minimal 1 can." : n > maks ? `Maksimal ${maks} can.` : null;
  const teksKurang = teks?.wajib && !isiTeks.trim();

  return (
    <div className="flex flex-col gap-3">
      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">{label}</span>
        <Input
          value={nilai}
          onChange={(e) => setNilai(e.target.value)}
          inputMode="numeric"
          className="h-12 text-center text-xl font-semibold"
          disabled={sibuk}
        />
      </label>
      <p className="text-xs text-muted-foreground">{catatan}</p>
      {teks && (
        <label className="flex flex-col gap-1">
          <span className="text-sm font-medium">{teks.label}</span>
          <Textarea value={isiTeks} onChange={(e) => setIsiTeks(e.target.value)} rows={2} disabled={sibuk} />
        </label>
      )}
      {galat && <p className="text-xs text-destructive">{galat}</p>}
      <Button
        className="h-12 text-base"
        variant={merusak ? "destructive" : "default"}
        disabled={sibuk || galat !== null || !!teksKurang}
        onClick={() => onKirim(n, isiTeks.trim())}
      >
        {tombol(Number.isNaN(n) ? 0 : n)}
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
