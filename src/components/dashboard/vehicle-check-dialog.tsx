"use client";

import { useState, useTransition } from "react";
import { Gauge, Fuel, Clock, Package } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { LiveCameraCaptureField } from "@/components/dashboard/live-camera-capture-field";
import { TruckCubeCarousel } from "@/components/dashboard/truck-cube-carousel";
import { TruckSideIllustration } from "@/components/dashboard/truck-side-illustration";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  JENIS_FOTO_LIST,
  JENIS_FOTO_LABEL,
  TRUCK_SIDE_PRIMARY_PHOTO,
  TRUCK_SIDE_SECONDARY_PHOTO,
  FUEL_BAR_MAX,
  type VehicleCheckRow,
  type VehicleCheckTipe,
  type FuelBar,
  type VehicleCheckPhoto,
  type JenisFotoKendaraan,
  type TruckSide,
} from "@/lib/vehicle-check-types";

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
      <div className="flex flex-wrap gap-4 text-muted-foreground">
        <span className="flex items-center gap-1">
          <Gauge className="size-3" />
          {check.odometerKM.toLocaleString("id-ID")} KM
        </span>
        <span className="flex items-center gap-1">
          <Fuel className="size-3" />
          {check.fuelBar} / {FUEL_BAR_MAX} bar
        </span>
        <span className="flex items-center gap-1">
          <Package className="size-3" />
          {check.muatanQty.toLocaleString("id-ID")} koli
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

function FuelBarSelector({ value, onChange }: { value: FuelBar; onChange: (v: FuelBar) => void }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-[11px] text-muted-foreground">Fuel Meter</span>
      <div className="flex items-end gap-1">
        <button
          type="button"
          onClick={() => onChange(0)}
          className={cn(
            "flex h-7 w-6 items-end justify-center rounded-sm border pb-0.5 text-[10px] font-medium transition-colors",
            value === 0 ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-muted-foreground"
          )}
          aria-label="Kosong (E)"
        >
          E
        </button>
        {([1, 2, 3, 4] as FuelBar[]).map((bar, i) => (
          <button
            key={bar}
            type="button"
            onClick={() => onChange(bar)}
            className={cn(
              "w-5 rounded-sm border transition-colors",
              bar <= value ? "border-primary bg-primary" : "border-border bg-muted"
            )}
            style={{ height: `${14 + i * 6}px` }}
            aria-label={`${bar} bar`}
          />
        ))}
      </div>
      <span className="text-[11px] text-muted-foreground">
        {value} / {FUEL_BAR_MAX} bar
      </span>
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
  onSubmitCheck: (input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }) => Promise<void>;
}) {
  const [activeSide, setActiveSide] = useState<TruckSide>("DEPAN");
  const [depanMainTarget, setDepanMainTarget] = useState<JenisFotoKendaraan>("DEPAN");
  const [belakangMainTarget, setBelakangMainTarget] = useState<JenisFotoKendaraan>("BELAKANG");
  const [photos, setPhotos] = useState<Partial<Record<JenisFotoKendaraan, string>>>({});
  const [uploading, setUploading] = useState<JenisFotoKendaraan | null>(null);
  const [odometerKM, setOdometerKM] = useState("");
  const [fuelBar, setFuelBar] = useState<FuelBar>(2);
  const [muatanQty, setMuatanQty] = useState("");
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
  const canSubmit = allPhotosReady && Number(odometerKM) > 0 && muatanQty !== "" && Number(muatanQty) >= 0 && !pending;

  function handleSubmit() {
    if (!canSubmit) return;
    setError(null);
    startTransition(async () => {
      try {
        await onSubmitCheck({
          tipe,
          odometerKM: Number(odometerKM),
          fuelBar,
          muatanQty: Number(muatanQty),
          photos: JENIS_FOTO_LIST.map((jenisFoto) => ({ jenisFoto, filePath: photos[jenisFoto] as string })),
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan cek kendaraan.");
      }
    });
  }

  function renderSideContent(side: TruckSide) {
    const primary = TRUCK_SIDE_PRIMARY_PHOTO[side];
    const secondary = TRUCK_SIDE_SECONDARY_PHOTO[side];
    const mainTarget = side === "DEPAN" ? depanMainTarget : side === "BELAKANG" ? belakangMainTarget : primary;
    const toggleTarget = secondary ? (mainTarget === primary ? secondary : primary) : null;
    const setMainTarget = side === "DEPAN" ? setDepanMainTarget : setBelakangMainTarget;

    return (
      <div className="relative flex h-full w-full flex-col gap-2 p-2">
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center p-8 text-muted-foreground/10">
          <TruckSideIllustration side={side} />
        </div>
        <div className="relative flex min-h-0 flex-1 gap-2">
          <LiveCameraCaptureField
            key={mainTarget}
            label={JENIS_FOTO_LABEL[mainTarget]}
            photoUrl={photos[mainTarget] ?? null}
            size="main"
            active={activeSide === side}
            disabled={uploading != null || pending}
            onCapture={(file) => handleCapture(file, mainTarget)}
          />
          {toggleTarget && (
            <LiveCameraCaptureField
              key={toggleTarget}
              label={JENIS_FOTO_LABEL[toggleTarget]}
              photoUrl={photos[toggleTarget] ?? null}
              size="toggle"
              active={false}
              disabled={uploading != null || pending}
              onCapture={() => {}}
              onTogglePress={() => setMainTarget(toggleTarget)}
            />
          )}
        </div>
        {side === "DEPAN" && (
          <div className="relative flex w-full flex-col gap-2">
            <Input
              type="number"
              inputMode="numeric"
              placeholder="Odometer (KM)"
              value={odometerKM}
              onChange={(e) => setOdometerKM(e.target.value)}
            />
            <FuelBarSelector value={fuelBar} onChange={setFuelBar} />
          </div>
        )}
        {side === "BELAKANG" && (
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            placeholder="Jumlah Koli/Unit Muatan"
            value={muatanQty}
            onChange={(e) => setMuatanQty(e.target.value)}
            className="relative"
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3">
      <p className="text-xs font-medium">{TIPE_LABEL[tipe]}</p>
      <TruckCubeCarousel
        activeSide={activeSide}
        onActiveSideChange={setActiveSide}
        sides={{
          DEPAN: renderSideContent("DEPAN"),
          KANAN: renderSideContent("KANAN"),
          BELAKANG: renderSideContent("BELAKANG"),
          KIRI: renderSideContent("KIRI"),
        }}
      />
      <div className="flex justify-end">
        <Button
          size="lg"
          disabled={!canSubmit}
          onClick={handleSubmit}
          className="bg-emerald-600 px-6 text-white hover:bg-emerald-700 disabled:bg-emerald-600/50 disabled:text-white/70"
        >
          {pending ? "Menyimpan..." : `Simpan ${TIPE_LABEL[tipe]}`}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export function VehicleCheckDialog({
  jadwalId: _jadwalId,
  armadaId: _armadaId,
  isSatpam,
  onUploadPhoto,
  onSubmitCheck,
  checks,
}: {
  jadwalId: number;
  armadaId: number;
  isSatpam: boolean;
  onUploadPhoto: (file: File, jenisFoto: JenisFotoKendaraan) => Promise<string>;
  onSubmitCheck: (input: {
    tipe: VehicleCheckTipe;
    odometerKM: number;
    fuelBar: FuelBar;
    muatanQty: number;
    photos: VehicleCheckPhoto[];
  }) => Promise<void>;
  checks: VehicleCheckRow[];
}) {
  const [open, setOpen] = useState(false);
  const berangkat = checks.find((c) => c.tipe === "BERANGKAT");
  const datang = checks.find((c) => c.tipe === "DATANG");
  const statusText = `Cek Keamanan Kendaraan — Berangkat: ${berangkat ? "sudah" : "belum"}, Datang: ${
    berangkat ? (datang ? "sudah" : "belum") : "-"
  }`;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" className="w-full justify-start text-left" />}>
        {statusText}
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Cek Keamanan Kendaraan</DialogTitle>
          <DialogDescription>Rekam kondisi kendaraan saat berangkat dan datang, khusus diisi oleh Satpam.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          {berangkat ? (
            <CheckSummary check={berangkat} />
          ) : isSatpam ? (
            <CheckForm tipe="BERANGKAT" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
          ) : (
            <p className="text-xs text-muted-foreground">Belum ada Cek Berangkat.</p>
          )}

          {datang ? (
            <CheckSummary check={datang} />
          ) : berangkat ? (
            isSatpam ? (
              <CheckForm tipe="DATANG" onUploadPhoto={onUploadPhoto} onSubmitCheck={onSubmitCheck} />
            ) : (
              <p className="text-xs text-muted-foreground">Belum ada Cek Datang.</p>
            )
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
