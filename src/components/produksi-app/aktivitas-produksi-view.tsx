"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TimProduksiRoster } from "@/components/produksi-app/tim-produksi-roster";
import { MesinEventPanel } from "@/components/produksi-app/mesin-event-panel";
import { RiwayatAktivitasProduksi } from "@/components/produksi-app/riwayat-aktivitas-produksi";
import type { MesinRow } from "@/lib/queries/produksi-mesin";
import type { MesinEventRow } from "@/lib/queries/produksi-mesin-event";
import type { StafOperasionalOption } from "@/lib/queries/akun";
import type { AktivitasShiftInfo, QtyRecap, SusunanTimRow } from "@/lib/queries/aktivitas-produksi";
import type { TimRow, AnggotaTimRow } from "@/lib/queries/tim-produksi";
import { hitungTotalDenda, hitungKontribusiPerOrang } from "@/lib/aktivitas-produksi-shared";
import { upsertStafOperasionalAction, upsertKerusakanAction, setTimBertugasAction } from "@/app/mkesindo/produksi/actions";
import { TimSayaPanel } from "@/components/produksi-app/tim-saya-panel";

const UNSET = "__unset__";

export function QtyRecapCard({ qty, jumlahHadir }: { qty: QtyRecap; jumlahHadir: number }) {
  const kontribusi = hitungKontribusiPerOrang(qty.totalKantongEkivalen, jumlahHadir);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Rekap Produksi</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {qty.perMesin.map((m) => (
          <div key={m.mesinId} className="flex justify-between text-xs">
            <span>{m.mesinNama} (10KG)</span>
            <span className="tabular-nums">{m.qty10KG.toLocaleString("id-ID")}</span>
          </div>
        ))}
        <div className="flex justify-between border-t pt-2 text-xs">
          <span>Total 10KG</span>
          <span className="tabular-nums font-medium">{qty.total10KG.toLocaleString("id-ID")}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Total 5KG (shift ini)</span>
          <span className="tabular-nums font-medium">{qty.total5KG.toLocaleString("id-ID")}</span>
        </div>
        <div className="flex justify-between text-xs">
          <span>Kontribusi / Orang</span>
          <span className="tabular-nums font-medium">
            {kontribusi === null ? "Belum ada anggota hadir" : kontribusi.toLocaleString("id-ID", { maximumFractionDigits: 2 })}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function KerusakanCard({
  tanggalUsaha,
  shift,
  current,
  onSaved,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  current: AktivitasShiftInfo;
  onSaved: () => void;
}) {
  const [pecah, setPecah] = useState(String(current.pecahKemasanQty));
  const [jatuh, setJatuh] = useState(String(current.esJatuhQty));
  const [retur, setRetur] = useState(String(current.gantiReturnQty));
  const [sealer, setSealer] = useState(String(current.sealerJebolQty));
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const totalDenda = hitungTotalDenda(Number(pecah) || 0, Number(jatuh) || 0);

  function handleSave() {
    setError(null);
    startTransition(async () => {
      const result = await upsertKerusakanAction(tanggalUsaha, shift, {
        pecahKemasanQty: Number(pecah) || 0,
        esJatuhQty: Number(jatuh) || 0,
        gantiReturnQty: Number(retur) || 0,
        sealerJebolQty: Number(sealer) || 0,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">Kerusakan</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Pecah Kemasan (Rp1.000/kejadian)</Label>
            <Input type="number" min={0} value={pecah} onChange={(e) => setPecah(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Es Jatuh (Rp3.000/kejadian)</Label>
            <Input type="number" min={0} value={jatuh} onChange={(e) => setJatuh(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Ganti Return</Label>
            <Input type="number" min={0} value={retur} onChange={(e) => setRetur(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Sealer Jebol</Label>
            <Input type="number" min={0} value={sealer} onChange={(e) => setSealer(e.target.value)} />
          </div>
        </div>
        <p className="text-sm font-medium">Total Denda: Rp{totalDenda.toLocaleString("id-ID")}</p>
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="w-fit" disabled={pending} onClick={handleSave}>
          Simpan
        </Button>
      </CardContent>
    </Card>
  );
}

export function StafOperasionalSelect({
  tanggalUsaha,
  shift,
  stafOperasionalAkunId,
  stafOperasionalOptions,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  stafOperasionalAkunId: number | null;
  stafOperasionalOptions: StafOperasionalOption[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    startTransition(async () => {
      await upsertStafOperasionalAction(tanggalUsaha, shift, !value || value === UNSET ? null : Number(value));
      onChanged();
    });
  }

  return (
    <Select value={stafOperasionalAkunId ? String(stafOperasionalAkunId) : UNSET} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger>
        <SelectValue placeholder="Pilih Staf Operasional" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={UNSET}>Belum dipilih</SelectItem>
        {stafOperasionalOptions.map((o) => (
          <SelectItem key={o.akunId} value={String(o.akunId)}>
            {o.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

const BELUM_DIJADWALKAN = "__belum_dijadwalkan__";

export function TimBertugasSelect({
  tanggalUsaha,
  shift,
  timId,
  timList,
  onChanged,
}: {
  tanggalUsaha: string;
  shift: 1 | 2 | 3;
  timId: number | null;
  timList: TimRow[];
  onChanged: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function handleChange(value: string | null) {
    if (!value || value === BELUM_DIJADWALKAN) return;
    startTransition(async () => {
      await setTimBertugasAction(tanggalUsaha, shift, Number(value));
      onChanged();
    });
  }

  return (
    <Select value={timId != null ? String(timId) : BELUM_DIJADWALKAN} onValueChange={handleChange} disabled={pending}>
      <SelectTrigger>
        <SelectValue placeholder="Pilih Tim">
          {(v: string) =>
            v === BELUM_DIJADWALKAN ? "Pilih Tim" : (timList.find((t) => String(t.timId) === v)?.nama ?? "Pilih Tim")
          }
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={BELUM_DIJADWALKAN} disabled>
          Tim belum dijadwalkan — pilih Tim
        </SelectItem>
        {timList.map((t) => (
          <SelectItem key={t.timId} value={String(t.timId)}>
            {t.nama}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function AktivitasProduksiView({
  current,
  qty,
  susunanTim,
  stafOperasionalNama,
  mesinList,
  mesinEvents,
  stafOperasionalOptions,
  timList,
  timSaya,
  riwayat,
  onChanged,
}: {
  current: AktivitasShiftInfo;
  qty: QtyRecap;
  susunanTim: SusunanTimRow[];
  // Resolved by the caller (page.tsx) via getAkunNamaMap — null only for a
  // shift that has genuinely never had any activity recorded yet.
  stafOperasionalNama: string | null;
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  // Still needed here — passed through unchanged to RiwayatAktivitasProduksi
  // below, whose own "Ubah Aktivitas" dialog keeps the manual picker for
  // correcting past shifts (see riwayat-aktivitas-produksi.tsx, untouched
  // by this plan).
  stafOperasionalOptions: StafOperasionalOption[];
  timList: TimRow[];
  timSaya: { timId: number; nama: string; anggota: AnggotaTimRow[] } | null;
  riwayat: AktivitasShiftInfo[];
  onChanged: () => void;
}) {
  return (
    <div className="flex flex-col gap-4 p-4">
      <h2 className="text-sm font-semibold text-muted-foreground">
        {current.tanggalUsaha} — {current.shiftLabel}
      </h2>

      {timSaya && <TimSayaPanel timNama={timSaya.nama} anggota={timSaya.anggota} onChanged={onChanged} />}

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Tim Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <TimBertugasSelect tanggalUsaha={current.tanggalUsaha} shift={current.shift} timId={current.timId} timList={timList} onChanged={onChanged} />
        </CardContent>
      </Card>

      <Card size="sm">
        <CardHeader>
          <CardTitle className="text-sm">Staf Operasional Bertugas</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-1 pt-0">
          <p className="text-sm font-medium">{stafOperasionalNama ?? "Belum ada aktivitas tercatat"}</p>
          <p className="text-xs text-muted-foreground">
            Stok Es Sebelumnya (10KG): <span className="font-medium text-foreground">{current.stokEsSebelumnya10KG.toLocaleString("id-ID")}</span>
          </p>
        </CardContent>
      </Card>

      {current.timId == null ? (
        <p className="rounded-md border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
          Pilih Tim Bertugas terlebih dahulu sebelum mengisi data lain di shift ini.
        </p>
      ) : (
        <>
          <TimProduksiRoster tanggalUsaha={current.tanggalUsaha} shift={current.shift} susunanTim={susunanTim} canEdit onChanged={onChanged} />
          <MesinEventPanel mesinList={mesinList} events={mesinEvents} onChanged={onChanged} />
          <QtyRecapCard qty={qty} jumlahHadir={susunanTim.length} />
          <KerusakanCard tanggalUsaha={current.tanggalUsaha} shift={current.shift} current={current} onSaved={onChanged} />
        </>
      )}
      <RiwayatAktivitasProduksi riwayat={riwayat} stafOperasionalOptions={stafOperasionalOptions} timList={timList} onChanged={onChanged} />
    </div>
  );
}
