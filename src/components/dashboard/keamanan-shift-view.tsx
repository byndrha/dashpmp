"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { formatDate, formatTime } from "@/lib/format";
import { SATPAM_SHIFT_LIST, SATPAM_SHIFT_LABEL, type SatpamShiftType } from "@/lib/satpam-shift";
import {
  getInspeksiUntukShiftAction,
  getPatroliUntukShiftAction,
  getTamuUntukShiftAction,
} from "@/app/mkesindo/(dashboard)/keamanan/actions";
import type { InspeksiKartuRow } from "@/lib/queries/satpam-inspeksi-shift";
import type { PatroliSesiLengkap } from "@/lib/queries/satpam-patroli";
import type { TamuKunjunganRow } from "@/lib/queries/satpam-tamu";
import { JENIS_FOTO_LABEL } from "@/lib/vehicle-check-types";
import { PATROLI_TITIK_LIST } from "@/lib/satpam-patroli-titik";

// Format judul kartu sama seperti Kartu Pengiriman di Laporan Shift
// (laporan-shift-detail.tsx: formatJudulRute) -- "[Jam Berangkat] - Lokasi
// Tujuan Terjauh (Wilayah, Kecamatan)" -- supaya kartu Inspeksi di sini
// terasa konsisten dengan kartu Jadwal yang sama di laporan pengiriman.
function formatJudulKartu(row: InspeksiKartuRow): string {
  const jam = row.jamAktualBerangkat ? formatTime(row.jamAktualBerangkat) : "-";
  if (!row.lokasiTerjauh) return jam;
  const lokasi = row.lokasiTerjauh.kecamatan
    ? `${row.lokasiTerjauh.wilayah}, ${row.lokasiTerjauh.kecamatan}`
    : row.lokasiTerjauh.wilayah;
  return `${jam} - ${lokasi}`;
}

export function KeamananShiftView({
  initialTanggalUsaha,
  initialShiftType,
  initialInspeksi,
  initialPatroli,
  initialTamu,
}: {
  initialTanggalUsaha: string;
  initialShiftType: SatpamShiftType;
  initialInspeksi: InspeksiKartuRow[];
  initialPatroli: PatroliSesiLengkap[];
  initialTamu: TamuKunjunganRow[];
}) {
  const [tanggalUsaha, setTanggalUsaha] = useState(initialTanggalUsaha);
  const [shiftType, setShiftType] = useState<SatpamShiftType>(initialShiftType);
  const [inspeksi, setInspeksi] = useState(initialInspeksi);
  const [patroli, setPatroli] = useState(initialPatroli);
  const [tamu, setTamu] = useState(initialTamu);
  const [pending, startTransition] = useTransition();
  const [expandedInspeksi, setExpandedInspeksi] = useState<Record<number, boolean>>({});
  const [expandedPatroli, setExpandedPatroli] = useState<Record<number, boolean>>({});

  function handleTampilkan() {
    startTransition(async () => {
      const [inspeksiResult, patroliResult, tamuResult] = await Promise.all([
        getInspeksiUntukShiftAction(tanggalUsaha, shiftType),
        getPatroliUntukShiftAction(tanggalUsaha, shiftType),
        getTamuUntukShiftAction(tanggalUsaha, shiftType),
      ]);
      if (!inspeksiResult.success) {
        toast.error(inspeksiResult.error);
        return;
      }
      if (!patroliResult.success) {
        toast.error(patroliResult.error);
        return;
      }
      if (!tamuResult.success) {
        toast.error(tamuResult.error);
        return;
      }
      setInspeksi(inspeksiResult.data);
      setPatroli(patroliResult.data);
      setTamu(tamuResult.data);
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-2 rounded-lg border bg-secondary/30 p-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Tanggal Usaha</label>
          <Input type="date" value={tanggalUsaha} onChange={(e) => setTanggalUsaha(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground">Shift Keamanan</label>
          <Select value={shiftType} onValueChange={(v) => setShiftType(v as SatpamShiftType)}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SATPAM_SHIFT_LIST.map((s) => (
                <SelectItem key={s} value={s}>
                  {SATPAM_SHIFT_LABEL[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button onClick={handleTampilkan} disabled={pending}>
          {pending ? "Memuat..." : "Tampilkan"}
        </Button>
      </div>

      <section className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Hasil Inspeksi Kendaraan</h3>
        {inspeksi.length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada inspeksi kendaraan pada shift ini.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {inspeksi.map((row) => {
              const expanded = expandedInspeksi[row.jadwalId] ?? false;
              return (
                <div key={row.jadwalId} className="rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandedInspeksi((prev) => ({ ...prev, [row.jadwalId]: !expanded }))}
                    className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium">{formatJudulKartu(row)}</span>
                      <span className="text-muted-foreground">
                        {row.vehicleNo ?? row.armadaNama} · {row.driverName ?? "-"}
                      </span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="flex flex-col gap-2 divide-y border-t">
                      {row.checks.length === 0 ? (
                        <p className="p-3 text-center text-muted-foreground">Belum ada cek kendaraan.</p>
                      ) : (
                        row.checks.map((check) => (
                          <div key={check.vehicleCheckId} className="flex flex-col gap-1.5 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <Badge variant={check.tipe === "BERANGKAT" ? "default" : "secondary"}>
                                {check.tipe === "BERANGKAT" ? "Cek Berangkat" : "Cek Datang"}
                              </Badge>
                              <span className="text-muted-foreground">{formatDate(check.checkedAt)} {formatTime(check.checkedAt)}</span>
                            </div>
                            <div className="grid grid-cols-3 gap-1 text-muted-foreground">
                              <span>Odometer: {check.odometerKM} km</span>
                              <span>BBM: {check.fuelBar}/4</span>
                              <span>Muatan: {check.muatanQty}</span>
                            </div>
                            {check.remark && <p className="text-muted-foreground">Catatan: {check.remark}</p>}
                            {check.photos.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {check.photos.map((p) => (
                                  // eslint-disable-next-line @next/next/no-img-element -- foto dari storage eksternal (Google Drive), bukan aset build statis
                                  <div key={p.jenisFoto} className="flex flex-col items-center gap-0.5">
                                    <img src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="size-16 rounded-md object-cover" />
                                    <span className="text-[10px] text-muted-foreground">{JENIS_FOTO_LABEL[p.jenisFoto]}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Hasil Patroli</h3>
        {patroli.length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada sesi patroli pada shift ini.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {patroli.map((sesi) => {
              const expanded = expandedPatroli[sesi.sesiId] ?? false;
              const titikTerisi = new Set(sesi.fotos.map((f) => f.titikPatroli).filter((t): t is string => t != null));
              return (
                <div key={sesi.sesiId} className="rounded-md border text-xs">
                  <button
                    type="button"
                    onClick={() => setExpandedPatroli((prev) => ({ ...prev, [sesi.sesiId]: !expanded }))}
                    className="flex w-full items-center gap-2 p-2 text-left hover:bg-muted/50"
                    aria-expanded={expanded}
                  >
                    {expanded ? (
                      <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="flex flex-col">
                      <span className="font-medium">{sesi.satpamNama}</span>
                      <span className="text-muted-foreground">
                        {formatTime(sesi.mulaiWaktu)}
                        {sesi.selesaiWaktu ? ` – ${formatTime(sesi.selesaiWaktu)}` : ", sedang berlangsung"}
                        {" · "}
                        {titikTerisi.size} dari {PATROLI_TITIK_LIST.length} titik
                      </span>
                    </div>
                  </button>
                  {expanded && (
                    <div className="flex flex-col gap-2 border-t p-2">
                      {sesi.fotos.length === 0 ? (
                        <p className="text-center text-muted-foreground">Belum ada foto.</p>
                      ) : (
                        <div className="flex flex-wrap gap-2">
                          {sesi.fotos.map((f) => (
                            // eslint-disable-next-line @next/next/no-img-element -- foto dari storage eksternal (Google Drive), bukan aset build statis
                            <div key={f.fotoId} className="flex w-20 flex-col items-center gap-0.5">
                              <img src={f.fotoPath} alt={f.titikPatroli ?? "Foto tambahan"} className="size-16 rounded-md object-cover" />
                              <span className="truncate text-[10px] text-muted-foreground" title={f.titikPatroli ?? "Foto Tambahan"}>
                                {f.titikPatroli ?? "Foto Tambahan"}
                              </span>
                              <span className="text-[10px] text-muted-foreground">{formatTime(f.waktuFoto)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-md border p-3">
        <h3 className="text-sm font-semibold">Daftar Tamu</h3>
        {tamu.length === 0 ? (
          <p className="text-xs text-muted-foreground">Tidak ada tamu pada shift ini.</p>
        ) : (
          <div className="flex flex-col gap-1.5 text-xs">
            {tamu.map((t) => (
              <div key={t.kunjunganId} className="flex flex-col gap-1 rounded-md border p-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{t.namaTamu}</span>
                  {t.waktuKeluar ? (
                    <span className="text-muted-foreground">
                      {formatTime(t.waktuMasuk)} – {formatTime(t.waktuKeluar)}
                    </span>
                  ) : (
                    <Badge variant="destructive">Belum Keluar</Badge>
                  )}
                </div>
                <p className="text-muted-foreground">
                  {t.tujuanKunjungan} — {t.dikunjungi}
                  {t.asalInstansi ? ` · ${t.asalInstansi}` : ""}
                  {t.nomorKendaraan ? ` · ${t.nomorKendaraan}` : ""}
                </p>
                {!t.waktuKeluar && (
                  <p className="text-muted-foreground">Masuk: {formatDate(t.waktuMasuk)} {formatTime(t.waktuMasuk)}</p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
