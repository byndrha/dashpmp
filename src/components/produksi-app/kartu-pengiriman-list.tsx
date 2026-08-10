"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getWarehouseMapAction, produksiMulaiMuatAction } from "@/app/mkesindo/produksi/actions";
import type { DraftJadwalForProduksi } from "@/lib/queries/produksi-muatan";
import type { PalletPosisiRow } from "@/lib/queries/produksi-warehouse";

export function KartuPengirimanList({
  initialJadwal,
  onAfterMuat,
}: {
  initialJadwal: DraftJadwalForProduksi[];
  onAfterMuat: () => void;
}) {
  const [jadwalList, setJadwalList] = useState(initialJadwal);
  const [selected, setSelected] = useState<DraftJadwalForProduksi | null>(null);

  function handleDone(jadwalId: number) {
    setJadwalList((prev) => prev.filter((j) => j.JadwalID !== jadwalId));
    setSelected(null);
    onAfterMuat();
  }

  if (selected) {
    return (
      <IsiMuatanScreen
        jadwal={selected}
        onBack={() => setSelected(null)}
        onDone={() => handleDone(selected.JadwalID)}
      />
    );
  }

  if (jadwalList.length === 0) {
    return (
      <p className="p-4 text-center text-sm text-muted-foreground">
        Tidak ada Kartu Pengiriman yang perlu diisi muatan saat ini.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-4">
      {jadwalList.map((jadwal) => (
        <button
          key={jadwal.JadwalID}
          type="button"
          onClick={() => setSelected(jadwal)}
          className="rounded-lg border border-border p-3 text-left"
        >
          <p className="font-semibold">{jadwal.ArmadaNama}</p>
          <p className="text-xs text-muted-foreground">
            {new Date(jadwal.JamJadwal).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" })}
          </p>
          <p className="mt-1 text-sm">
            Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
          </p>
        </button>
      ))}
    </div>
  );
}

function IsiMuatanScreen({
  jadwal,
  onBack,
  onDone,
}: {
  jadwal: DraftJadwalForProduksi;
  onBack: () => void;
  onDone: () => void;
}) {
  const [posisi, setPosisi] = useState<PalletPosisiRow[] | null>(null);
  const [alokasi, setAlokasi] = useState<Record<number, { qty10: number; qty5: number }>>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    getWarehouseMapAction().then((result) => {
      if (result.success) {
        setPosisi(
          result.data
            .filter((p) => p.BatchIDAktif != null)
            .sort((a, b) => new Date(a.TanggalProduksi ?? 0).getTime() - new Date(b.TanggalProduksi ?? 0).getTime())
        );
      }
    });
  }, []);

  const totalQty10 = Object.values(alokasi).reduce((sum, a) => sum + a.qty10, 0);
  const totalQty5 = Object.values(alokasi).reduce((sum, a) => sum + a.qty5, 0);
  const cukup = totalQty10 >= jadwal.Qty10KGDibutuhkan && totalQty5 >= jadwal.Qty5KGDibutuhkan;

  function setAmbil(posisiId: number, field: "qty10" | "qty5", value: number, max: number) {
    setAlokasi((prev) => ({
      ...prev,
      [posisiId]: {
        qty10: prev[posisiId]?.qty10 ?? 0,
        qty5: prev[posisiId]?.qty5 ?? 0,
        [field]: Math.min(Math.max(0, value), max),
      },
    }));
  }

  function handleAmbilSemua(row: PalletPosisiRow) {
    setAlokasi((prev) => ({ ...prev, [row.PosisiID]: { qty10: row.SisaQty10KG ?? 0, qty5: row.SisaQty5KG ?? 0 } }));
  }

  function handleSubmit() {
    setError(null);
    if (!posisi) return;
    const alokasiList = posisi
      .filter((row) => alokasi[row.PosisiID] && (alokasi[row.PosisiID].qty10 > 0 || alokasi[row.PosisiID].qty5 > 0))
      .map((row) => ({
        batchId: row.BatchIDAktif as number,
        qty10KG: alokasi[row.PosisiID].qty10,
        qty5KG: alokasi[row.PosisiID].qty5,
      }));
    startTransition(async () => {
      const result = await produksiMulaiMuatAction({ jadwalId: jadwal.JadwalID, alokasi: alokasiList });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onDone();
    });
  }

  return (
    <div className="flex flex-col gap-3 p-4">
      <Button variant="outline" size="sm" onClick={onBack} className="w-fit">
        Kembali
      </Button>
      <p className="font-semibold">{jadwal.ArmadaNama}</p>
      <p className="text-sm text-muted-foreground">
        Dibutuhkan: {jadwal.Qty10KGDibutuhkan} kantong 10kg, {jadwal.Qty5KGDibutuhkan} kantong 5kg
      </p>
      <p className="text-sm">
        Sudah dialokasikan: {totalQty10} kantong 10kg, {totalQty5} kantong 5kg
      </p>

      {posisi === null ? (
        <p className="text-sm text-muted-foreground">Memuat data pallet...</p>
      ) : (
        <div className="flex flex-col gap-2">
          {posisi.map((row, index) => (
            <div
              key={row.PosisiID}
              className={index === 0 ? "rounded-lg border-2 border-amber-500 p-3" : "rounded-lg border border-border p-3"}
            >
              <div className="flex items-center justify-between">
                <p className="font-medium">
                  Pallet {row.Kode}
                  {index === 0 && <span className="ml-2 text-xs text-amber-600">Paling lama — ambil dulu</span>}
                </p>
                <Button size="sm" variant="outline" onClick={() => handleAmbilSemua(row)}>
                  Ambil semua sisa
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Sisa: {row.SisaQty10KG} kantong 10kg, {row.SisaQty5KG} kantong 5kg
              </p>
              <div className="mt-2 flex gap-2">
                <Input
                  type="number"
                  placeholder="Qty 10kg"
                  value={alokasi[row.PosisiID]?.qty10 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty10", Number(e.target.value), row.SisaQty10KG ?? 0)}
                />
                <Input
                  type="number"
                  placeholder="Qty 5kg"
                  value={alokasi[row.PosisiID]?.qty5 ?? ""}
                  onChange={(e) => setAmbil(row.PosisiID, "qty5", Number(e.target.value), row.SisaQty5KG ?? 0)}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button disabled={!cukup || pending} onClick={handleSubmit}>
        {pending ? "Memproses..." : "Konfirmasi Isi Muatan"}
      </Button>
    </div>
  );
}
