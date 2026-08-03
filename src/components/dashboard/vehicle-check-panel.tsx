"use client";

import { useState, useTransition } from "react";
import { Gauge, Fuel, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CameraCaptureField } from "@/components/dashboard/camera-capture-field";
import { formatTime } from "@/lib/format";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelLevel,
  type VehicleCheckPhoto,
  type JenisFotoKendaraan,
} from "@/lib/queries/vehicle-check";

const FUEL_LEVELS: FuelLevel[] = ["E", "1/4", "1/2", "3/4", "F"];
const TIPE_LABEL: Record<VehicleCheckTipe, string> = { BERANGKAT: "Cek Berangkat", DATANG: "Cek Datang" };

function CheckSummary({ check }: { check: VehicleCheckRow }) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/30 p-3 text-xs">
      <div className="flex items-center justify-between">
        <span className="font-medium">{TIPE_LABEL[check.tipe]}</span>
        <span className="flex items-center gap-1 text-muted-foreground">
          <Clock className="size-3" />
          {formatTime(check.checkedAt)}
        </span>
      </div>
      <div className="flex gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <Gauge className="size-3" />
          {check.odometerKM.toLocaleString("id-ID")} KM
        </span>
        <span className="flex items-center gap-1">
          <Fuel className="size-3" />
          {check.fuelLevel}
        </span>
      </div>
      <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
        {check.photos.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element -- served from public/uploads, not a static build asset
          <img key={p.jenisFoto} src={p.filePath} alt={JENIS_FOTO_LABEL[p.jenisFoto]} className="h-14 w-full rounded object-cover" />
        ))}
      </div>
    </div>
  );
}

function CheckForm({
  tipe,
  onUploadPhoto,
  onSubmitCheck,
}: {
  tipe: VehicleCheckTipe;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: { tipe: VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel; photos: VehicleCheckPhoto[] }) => Promise<void>;
}) {
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelLevel, setFuelLevel] = useState<FuelLevel>("1/2");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleCapture(file: File, jenisFoto: JenisFotoKendaraan) {
    setError(null);
    setUploading(jenisFoto);
    try {
      const path = await onUploadPhoto(file, jenisFoto);
      setPhotos((prev) => ({ ...prev, [jenisFoto]: path }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah foto.");
    } finally {
      setUploading(null);
    }
  }

  const allPhotosReady = JENIS_FOTO_LIST.every((j) => photos[j] != null);
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await onSubmitCheck({
          tipe,
          odometerKM: Number(odometerKM),
          fuelLevel,
          photos: JENIS_FOTO_LIST.map((jenisFoto) => ({ jenisFoto, filePath: photos[jenisFoto] as string })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan cek kendaraan.");
      }
    });
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs font-medium">{TIPE_LABEL[tipe]}</p>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {JENIS_FOTO_LIST.map((jenisFoto) => (
          <CameraCaptureField
            key={jenisFoto}
            label={JENIS_FOTO_LABEL[jenisFoto]}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, jenisFoto)}
          />
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          placeholder="Odometer (KM)"
          className="w-40"
          value={odometerKM}
          onChange={(e) => setOdometerKM(e.target.value)}
        />
        <Select value={fuelLevel} onValueChange={(v) => v && setFuelLevel(v as FuelLevel)}>
          <SelectTrigger className="w-28">
            <SelectValue>{() => fuelLevel}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {FUEL_LEVELS.map((level) => (
              <SelectItem key={level} value={level}>
                {level}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" disabled={!canSubmit} onClick={handleSubmit}>
          {pending ? "Menyimpan..." : `Simpan ${TIPE_LABEL[tipe]}`}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-[10px] text-muted-foreground">
        Foto wajib diambil langsung dari kamera. Catatan: sebagian browser tetap menampilkan pintasan galeri di
        antarmuka kameranya sendiri — ini batasan platform, bukan sesuatu yang bisa diblokir sepenuhnya dari sisi
        web.
      </p>
    </div>
  );
}

export function VehicleCheckPanel({
  jadwalId,
  armadaId,
  isSatpam,
  onUploadPhoto,
  onSubmitCheck,
  checks,
}: {
  jadwalId: number;
  armadaId: number;
  isSatpam: boolean;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: { tipe: VehicleCheckTipe; odometerKM: number; fuelLevel: FuelLevel; photos: VehicleCheckPhoto[] }) => Promise<void>;
  checks: VehicleCheckRow[];
}) {
  const berangkat = checks.find((c) => c.tipe === "BERANGKAT");
  const datang = checks.find((c) => c.tipe === "DATANG");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cek Keamanan Kendaraan</CardTitle>
        <CardDescription>Rekam kondisi kendaraan saat berangkat dan datang, khusus diisi oleh Satpam.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {berangkat ? <CheckSummary check={berangkat} /> : isSatpam ? (
          <CheckForm tipe="BERANGKAT" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
        ) : (
          <p className="text-xs text-muted-foreground">Belum ada Cek Berangkat.</p>
        )}

        {berangkat && (datang ? <CheckSummary check={datang} /> : isSatpam ? (
          <CheckForm tipe="DATANG" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
        ) : (
          <p className="text-xs text-muted-foreground">Belum ada Cek Datang.</p>
        ))}
      </CardContent>
    </Card>
  );
}
