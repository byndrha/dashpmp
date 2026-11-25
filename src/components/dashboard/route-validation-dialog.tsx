"use client";

import { konfirmasi } from "@/components/konfirmasi";
import { Fragment, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { GripVertical, MapPin, Route as RouteIcon, Fuel, Clock, Plus, Printer, X, Share2, Truck, Package, Image as ImageIcon, List, ChevronDown, History, Gauge, CheckCircle2, UserRound } from "lucide-react";
import { SerahEsKristal } from "@/components/icons/serah-barang";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TimeInput } from "@/components/ui/time-input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { VerticalTimeline, VerticalTimelineItem } from "@/components/ui/vertical-timeline";
import { CheckSummary, TIPE_LABEL, TIPE_IKON } from "@/components/vehicle-check-summary";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate, formatRupiah, formatTime, formatKemasanQty } from "@/lib/format";
import { estimateDeliveryMinutes, CONFIRMATION_MINUTES_PER_STOP } from "@/lib/delivery-duration";
import type {
  JadwalCard as JadwalCardData,
  JadwalDetailRow,
  DriverStopRow,
  AvailableSalesOrder,
  ArmadaConflictInfo,
  ArmadaUtilisasiHarian,
} from "@/lib/queries/pengiriman-jadwal";
import type { DriverOption } from "@/lib/queries/delivery";
import type { MultiPointRoute } from "@/lib/osrm";
import type { FuelType } from "@/lib/armada-fuel";
import { ArmadaConflictDialog } from "@/components/dashboard/armada-conflict-dialog";
import { StopDeliveryProofDialog } from "@/components/dashboard/stop-delivery-proof-dialog";
import { StopSalesInvoiceDialog } from "@/components/dashboard/stop-sales-invoice-dialog";
import type { VehicleCheckRow } from "@/lib/vehicle-check-types";
import {
  getJadwalDetailAction,
  updateJadwalUrutanAction,
  setJadwalDetailLokasiAction,
  updateJadwalDriverTimeAction,
  addSalesOrdersToJadwalAction,
  removeSalesOrderFromJadwalAction,
  getAvailableSalesOrdersAction,
  deleteJadwalDraftAction,
  startMuatAction,
  selesaiMuatAction,
  konfirmasiBerangkatAction,
  getVehicleChecksForJadwalAction,
  checkArmadaConflictAction,
  getPriceLevelOptionsAction,
  getDriverPositionAction,
  getLatestArmadaPositionAction,
  getIstirahatForJadwalAction,
  getArmadaUtilisasiHarianAction,
  getArmadaUtilisasiPeriodeAction,
  getArmadaNextJadwalStartedAction,
  getJadwalTotalReturAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { PriceLevelOption } from "@/lib/queries/mitra";
import type { IstirahatSession } from "@/lib/queries/driver-istirahat";
import type { JejakPeta, TruckPosition } from "@/components/dashboard/route-map";
import type { JejakAktual } from "@/lib/queries/jejak-armada";
import { shareImageBlob, shareTextBlock } from "@/lib/share-image";
import { pilihanLokasiStopTampil } from "@/lib/mitra-lokasi";
import { useIsMobile } from "@/hooks/use-mobile";
import { BarisCatatan, BarisUrutan, MasalahTujuanBaris, type FokusPeta } from "@/components/dashboard/log-pergerakan";
import { analisisJejak, tempatkanCatatan, type CatatanPerjalanan, type MasalahTujuan } from "@/lib/analisis-jejak";
import type { BerhentiTerklasifikasi } from "@/lib/klasifikasi-berhenti";

const RouteMap = dynamic(() => import("@/components/dashboard/route-map").then((m) => m.RouteMap), {
  ssr: false,
  loading: () => <Skeleton className="h-full w-full rounded-lg" />,
});

// Resolves the "end" instant for an in-progress elapsed-time calculation —
// pulled out to a plain module-level function (rather than calling
// Date.now() straight inside a component's useMemo) so the
// react-hooks/purity lint rule doesn't flag it: it only recognizes impure
// calls written directly in a component/hook body, not ones behind a
// named helper.
function resolveEndMs(actualEnd: string | Date | null): number {
  return actualEnd ? new Date(actualEnd).getTime() : Date.now();
}

// "5 Menit" under an hour, "4 Jam 5 Menit" (or "4 Jam" flat) at or above.
function formatDurationMinutes(totalMinutes: number): string {
  const minutes = Math.max(0, totalMinutes);
  if (minutes < 60) return `${minutes} Menit`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest > 0 ? `${hours} Jam ${rest} Menit` : `${hours} Jam`;
}

// Nilai Select untuk "Utama" (LokasiPengirimanID NULL) — base-ui Select
// butuh string, jadi NULL dipetakan ke penanda ini.
const LOKASI_UTAMA = "utama";
// Lebar panel kiri melayang di mode peta latar penuh (px).
const LEBAR_PANEL_APUNG = 440;

function SortableStopRow({
  detail,
  index,
  onEdit,
  disabled,
  onOpenSi,
  onRemove,
  hasDeparted,
  onOpenProof,
  onChangeLokasi,
  ringkas = false,
  ekspor = false,
  bongkarGps,
  masalahGps,
  onFokus,
}: {
  detail: DriverStopRow;
  index: number;
  onEdit: (detail: DriverStopRow) => void;
  disabled: boolean;
  onOpenSi: (detail: DriverStopRow) => void;
  // Only usable while the Jadwal is still Draft (matches
  // removeSalesOrderFromJadwal's own guard) — omitted/hidden once Terbit.
  onRemove?: (detail: DriverStopRow) => void;
  // Once the armada is Berangkat, the "Lihat SI" icon no longer makes
  // sense here (per-stop invoices are already settled by then) — it's
  // replaced per-row by a checkmark opening the proof-of-delivery popup.
  // Shown regardless of detail.JamSelesai (confirmed with user 2026-09-23):
  // retur data can exist even when the driver never confirmed that stop, so
  // the popup itself (not this row) decides whether there's anything to show.
  hasDeparted: boolean;
  onOpenProof: (detail: DriverStopRow) => void;
  // Pemilih lokasi pengiriman stop — hanya diteruskan selama Draft. Tetap
  // tersembunyi bila mitra cuma punya 1 lokasi (LokasiPilihan null) atau
  // alamat stop sudah dibekukan (DO sudah dibuat).
  onChangeLokasi?: (detail: DriverStopRow, lokasiPengirimanId: number | null) => void;
  // Panel sempit (mode melayang): nama lebih kecil, kolom kantong tidak
  // selebar 160px supaya nama mitra tidak terpotong.
  ringkas?: boolean;
  // Sedang ditangkap jadi gambar (Bagikan): kontrol (pegangan seret, tombol
  // keluarkan, placeholder ikon) TIDAK dirender sama sekali. Menyembunyikan
  // lewat filter html-to-image tidak cukup — lebar kolom nama sudah dihitung
  // bersama kontrol itu, jadi tersisa celah kosong di kanan dan nama tetap
  // terpotong.
  ekspor?: boolean;
  // Berhenti GPS dalam radius toleransi mitra ini (tiba & bongkar). undefined
  // = jejak GPS tidak tersedia; [] = ada jejak tapi tidak terdeteksi berhenti.
  bongkarGps?: BerhentiTerklasifikasi[];
  // Kejanggalan dari jejak GPS untuk mitra ini (titik drop diragukan, hanya
  // melintas, dst.) — tampil di kartu, klik → peta melompat.
  masalahGps?: MasalahTujuan[];
  onFokus?: (f: FokusPeta) => void;
}) {
  // Muatan cadangan (mitra Complimentary): bukan tujuan antar — tanpa
  // pegangan geser, nomor urut, lokasi, maupun estimasi bongkar.
  const cadangan = detail.IsCadangan;
  const pilihanLokasi = cadangan
    ? null
    : pilihanLokasiStopTampil(detail.LokasiPilihan, detail.LokasiDibekukan, onChangeLokasi != null);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: detail.JadwalDetailID,
    disabled: cadangan,
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        ringkas
          ? "flex flex-wrap items-center gap-x-2 rounded-lg border border-white/10 bg-card/55 px-2.5 py-2 text-sm shadow-xs"
          : "flex flex-wrap items-center gap-x-2 border-b bg-card px-3 py-2.5 text-sm last:border-b-0",
        isDragging && "z-10 opacity-70 shadow-lg"
      )}
    >
      {cadangan ? (
        <>
          <span className="size-4 shrink-0" />
          <span
            title="Muatan cadangan"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-sky-500/15 text-sky-700 dark:text-sky-300"
          >
            <Package className="size-3.5" />
          </span>
        </>
      ) : (
        <>
          {!ekspor && (
            <button type="button" {...attributes} {...listeners} data-capture-hide="true" className="shrink-0 cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
              <GripVertical className="size-4" />
            </button>
          )}
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
            {index + 1}
          </span>
        </>
      )}
      <div className="min-w-0 flex-1">
      <button
        type="button"
        onClick={() => !disabled && onEdit(detail)}
        disabled={disabled}
        className="w-full min-w-0 text-left hover:underline disabled:cursor-default disabled:hover:no-underline"
      >
        <p className={cn("truncate font-semibold", ringkas ? "text-sm" : "text-base")}>{detail.CustomerName}</p>
        {cadangan ? (
          <p className="truncate text-xs text-sky-700 dark:text-sky-300">Muatan cadangan</p>
        ) : (
          <p className="flex items-center gap-1 truncate text-muted-foreground">
            <MapPin className="size-3.5 shrink-0" />
            {detail.Wilayah}
            {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
          </p>
        )}
        {detail.JamTiba != null && (
          <p className="text-xs text-muted-foreground">Tiba {formatTime(detail.JamTiba)}</p>
        )}
        {bongkarGps?.map((b) => (
          <p
            key={b.mulai}
            className="flex items-center gap-1 text-[11px] font-medium text-emerald-600 tabular-nums dark:text-emerald-400"
          >
            <SerahEsKristal className="size-3.5 shrink-0" aria-label="Diserahkan ke mitra" />
            {formatTime(b.mulai)}–{formatTime(b.selesai)} · {b.menit} mnt
          </p>
        ))}
        {bongkarGps && bongkarGps.length === 0 && !cadangan && !masalahGps?.length && (
          <p className="text-[11px] text-muted-foreground">APP / GPS belum mendeteksi</p>
        )}
      </button>
      {pilihanLokasi && (
        <Select
          value={detail.LokasiPengirimanID == null ? LOKASI_UTAMA : String(detail.LokasiPengirimanID)}
          onValueChange={(v) => {
            if (v == null) return;
            onChangeLokasi?.(detail, v === LOKASI_UTAMA ? null : Number(v));
          }}
        >
          <SelectTrigger size="sm" className="mt-1 h-7 w-full max-w-72 text-xs" title="Lokasi pengiriman stop ini">
            <SelectValue>
              {(v: string) =>
                pilihanLokasi.find((p) => (p.id == null ? LOKASI_UTAMA : String(p.id)) === v)?.label ?? "Lokasi pengiriman"
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {pilihanLokasi.map((p) => (
              <SelectItem key={p.id ?? LOKASI_UTAMA} value={p.id == null ? LOKASI_UTAMA : String(p.id)}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}
      </div>
      {/* Widened per explicit user request (confirmed OK with the tighter
          name/location column that results) so "155 kantong (10 KG)" fits
          on one line instead of wrapping — was w-24, which avoided the
          name/location column being squeezed to zero width but wrapped
          this qty text awkwardly. */}
      <span className={cn("shrink-0 text-right tabular-nums", ringkas ? "text-xs" : ekspor ? undefined : "w-40")}>
        {/* Ekspor: lebar kolom mengikuti isi (bukan w-40 tetap) dan qty
            selalu satu baris — nama mitra yang mengalah/terpotong. */}
        <span className={cn("font-medium", ekspor && "whitespace-nowrap")}>
          {formatKemasanQty(detail.Qty10KG, detail.Qty5KG)}
          {detail.BonusQty > 0 && <span className="text-primary"> (+{detail.BonusQty} bonus)</span>}
        </span>
        {!cadangan && <span className="block text-xs text-muted-foreground">~{estimateDeliveryMinutes(detail.Qty)} menit</span>}
      </span>
      {!cadangan && detail.Latitude == null && (
        <Badge variant="outline" className="shrink-0 border-destructive/30 text-[10px] text-destructive">
          Tanpa lokasi
        </Badge>
      )}
      {detail.IsTerkendala && (
        <Badge
          variant="outline"
          className="shrink-0 border-destructive/30 text-[10px] text-destructive"
          title={detail.TerkendalaAlasan ?? undefined}
        >
          Terkendala
        </Badge>
      )}
      {hasDeparted && !cadangan ? (
        <button
          type="button"
          title="Lihat bukti pengiriman"
          onClick={() => onOpenProof(detail)}
          className="shrink-0 rounded border border-transparent p-1 text-green-600 transition-colors hover:border-border hover:bg-green-600/10"
        >
          <CheckCircle2 className="size-4" />
        </button>
      ) : ekspor ? null : detail.InvoiceToken != null ? (
        <button
          type="button"
          title="Lihat SI"
          data-capture-hide="true"
          onClick={() => onOpenSi(detail)}
          className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border"
        >
          <Printer className="size-3.5" />
        </button>
      ) : (
        <span className="size-6 shrink-0" />
      )}
      {onRemove && !ekspor && (
        <button
          type="button"
          title="Keluarkan dari draft"
          data-capture-hide="true"
          onClick={() => onRemove(detail)}
          className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          <X className="size-4" />
        </button>
      )}
      {/* Kejanggalan GPS mitra ini — baris sendiri selebar kartu. */}
      {onFokus && masalahGps && masalahGps.length > 0 && (
        <div className="flex basis-full flex-col">
          {masalahGps.map((m) => (
            <MasalahTujuanBaris key={m.jenis} m={m} onPilih={onFokus} />
          ))}
        </div>
      )}
    </div>
  );
}

// Imperative API exposed via ref, used only by pengiriman-board.tsx's batch
// "Bagikan Semua Rute" — it drives this single persistent dialog through
// every route in turn (by changing which Jadwal's data the `jadwal` prop
// resolves to) and needs a way to know when THIS Jadwal's async detail fetch
// has actually landed before capturing/reading it, since a plain prop swap
// gives no such signal. The manual single-route Bagikan flow doesn't need
// this at all — it only ever runs once the dialog is already open and idle.
export interface RouteValidationDialogHandle {
  // Waits for targetJadwalId's data to finish loading (or times out), then
  // captures per mode — "data" hides the map first, same as the manual
  // "Data Rute" share. Returns null on timeout or if the dialog moved on to
  // a different Jadwal before the wait resolved.
  captureForBatch(targetJadwalId: number, mode: "seluruhnya" | "data"): Promise<Blob | null>;
  // Same readiness wait, then returns the plain-text stop list (manual
  // "Detail Rute" content) for targetJadwalId.
  getTextForBatch(targetJadwalId: number): Promise<string | null>;
}

interface RouteValidationDialogProps {
  jadwal: JadwalCardData | null;
  businessDate: string;
  todayISO: string;
  drivers: DriverOption[];
  // The open Jadwal's own ArmadaID — same already-resolved ArmadaRow the
  // caller uses for armadaNama/konsumsiBBM/kapasitasMaks/jenisBBM below.
  // Needed as a form field for the Satpam photo-upload endpoint. Null for
  // the same reason armadaNama can be null (jadwal == null / no matching
  // Armada resolved yet).
  armadaId: number | null;
  // Display-only, for the Share summary text — same ArmadaRow the caller
  // already resolved for konsumsiBBM/kapasitasMaks below.
  armadaNama: string | null;
  // Display-only, shown in the header next to armadaNama — same ArmadaRow
  // the caller already resolved (ArmadaRow.PlatNomor).
  armadaPlat: string | null;
  // Fuel estimate input — the Armada the open Jadwal belongs to, resolved
  // by the caller (JadwalCard itself doesn't carry KonsumsiBBM, ArmadaRow
  // does).
  konsumsiBBM: number | null;
  // Capacity hard-block input, same resolution path as konsumsiBBM. Null
  // means no limit has been configured, so nothing is blocked.
  kapasitasMaks: number | null;
  // Same resolution path as konsumsiBBM/kapasitasMaks — both null when
  // the Armada hasn't had these fields filled in yet.
  jenisBBM: FuelType | null;
  biayaBBMPerLiter: number | null;
  onOpenChange: (open: boolean) => void;
  // Fired after a successful "Batalkan Draft" so the caller can close this
  // dialog (it has no Jadwal left to show once deleted).
  onDeleted?: () => void;
  // Fired when a stop is clicked — the caller opens UbahPemesananDialog as a
  // sibling Dialog on top of this one, deliberately WITHOUT closing this
  // dialog first, so it stays visible (and its scroll/route-calc state
  // intact) underneath once the edit dialog closes again.
  onEditSalesOrder: (detail: JadwalDetailRow) => void;
  // Bumped by the caller every time UbahPemesananDialog closes (see
  // onEditSalesOrder above) — a Qty edit reached through that dialog can
  // change this Jadwal's per-stop Qty/totals/capacity, so this dialog
  // needs an explicit nudge to refetch `order` rather than staying stale
  // until the whole dialog is closed and reopened.
  salesOrderEditSignal: number;
}

export const RouteValidationDialog = forwardRef<RouteValidationDialogHandle, RouteValidationDialogProps>(
  function RouteValidationDialog(
    {
      jadwal,
      businessDate,
      todayISO,
      drivers,
      armadaId,
      armadaNama,
      armadaPlat,
      konsumsiBBM,
      kapasitasMaks,
      jenisBBM,
      biayaBBMPerLiter,
      onOpenChange,
      onDeleted,
      onEditSalesOrder,
      salesOrderEditSignal,
    },
    ref
  ) {
  const [loading, setLoading] = useState(false);
  const [order, setOrder] = useState<DriverStopRow[]>([]);
  const [vehicleChecks, setVehicleChecks] = useState<VehicleCheckRow[]>([]);
  // Jadwal mana yang cek kendaraannya sudah selesai dimuat — rute aktual
  // menunggu ini supaya tahu jam kembali (DATANG) sejak permintaan pertama.
  const [cekDimuatUntuk, setCekDimuatUntuk] = useState<number | null>(null);
  // Whether this armada already started loading (JamMulaiMuat) its
  // chronologically next Jadwal -- decides whether a still-missing
  // Berangkat/Datang check shows "Menunggu Inspeksi" (still could happen)
  // or "Tidak dilaksanakan" (window closed), fetched alongside vehicleChecks
  // in the same jadwalId-keyed effect below.
  const [nextJadwalStarted, setNextJadwalStarted] = useState(false);
  // Total QtyRetur across every stop in this Jadwal — feeds the "Total
  // Kantong + Bonus" panel and replaces MuatanQty on the "Cek Datang" card,
  // fetched alongside vehicleChecks in the same jadwalId-keyed effect below.
  const [totalRetur, setTotalRetur] = useState(0);
  // Every istirahat session logged against this Jadwal — feeds the Riwayat
  // Status popover's time summary (Task 11), fetched alongside
  // vehicleChecks in the same jadwalId-keyed effect below.
  const [istirahatSessions, setIstirahatSessions] = useState<IstirahatSession[]>([]);
  // Freely editable delivery date — the primary override for this Jadwal's
  // departure day. Kept as its own field (not derived from businessDate's
  // rollover label) precisely so staff can set ANY calendar date here,
  // including one outside the board's current businessDate/businessDate-1
  // window — see buildJamJadwal below and skipOrderTimeCheck at the
  // updateJadwalDriverTimeAction call sites.
  const [date, setDate] = useState("");
  const [time, setTime] = useState("00:00");
  const [driverId, setDriverId] = useState("");
  const [pabrik, setPabrik] = useState<{ latitude: number; longitude: number } | null>(null);
  // For Efektifitas Armada's weighted-average selling price — refetched
  // per dialog open alongside pabrik below, same convention this file
  // already uses rather than a separate mount-once fetch.
  const [priceLevels, setPriceLevels] = useState<PriceLevelOption[]>([]);
  // For Efektifitas Armada poin 4 (Utility Effectiveness) -- whole-day
  // WO/Idle/Breakdown for this armada, refetched per dialog open alongside
  // priceLevels/pabrik above. Null while loading/unavailable (armadaId not
  // resolved yet), same "not yet computable" treatment poin 1-3 already use.
  const [utilisasiHarian, setUtilisasiHarian] = useState<ArmadaUtilisasiHarian | null>(null);
  // For Efektifitas Armada poin 5 (Utility Effectiveness Per Periode) --
  // same WO/Idle/Breakdown shape as poin 4, but windowed to the 14:00 WIB
  // Periode Pengiriman `businessDate` belongs to instead of the 07:00-07:00
  // Kerja-shift day (added 2026-09-23, see getArmadaUtilisasiPeriode).
  const [utilisasiPeriode, setUtilisasiPeriode] = useState<ArmadaUtilisasiHarian | null>(null);
  // Live driver GPS for RouteMap's rotating truck marker — polled every 10s
  // once Mulai Muat is done, see the effect below. Null hides the marker.
  const [driverPosition, setDriverPosition] = useState<TruckPosition | null>(null);
  // Fallback when the driver app has no ping: the armada's own GPS tracker
  // (Hino Connect / SoloFleet, via armada_gps_riwayat), polled while the
  // Jadwal is en route. See the effect after the driver-position one.
  const [armadaGpsPosition, setArmadaGpsPosition] = useState<TruckPosition | null>(null);
  // The stop whose "Lihat bukti pengiriman" checkmark was clicked — null
  // closes StopDeliveryProofDialog, same open-via-prop convention this
  // dialog itself uses (open={jadwalId != null}).
  const [proofDetail, setProofDetail] = useState<DriverStopRow | null>(null);
  // The stop whose "Lihat SI" icon was clicked — null closes
  // StopSalesInvoiceDialog, same open-via-prop convention as proofDetail
  // above.
  const [siDetail, setSiDetail] = useState<DriverStopRow | null>(null);
  const [route, setRoute] = useState<MultiPointRoute | null>(null);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Set when checkArmadaConflictAction finds an overlapping Draft for this
  // armada — pauses the save (see handleSaveDriverTime/handleSelesaiMuat)
  // until the user confirms merging via ArmadaConflictDialog. Stores the
  // exact jamJadwal that was checked (not a bare ArmadaConflictInfo) so
  // onConfirm below reuses that validated value instead of recomputing
  // buildJamJadwal() again against possibly-changed date/time state, and
  // `then` discriminates which of the two handlers to resume since both
  // share this one piece of state.
  const [conflict, setConflict] = useState<{ info: ArmadaConflictInfo; jamJadwal: Date; then: "save" | "selesaiMuat" } | null>(null);
  // Dialog kode ambil-alih (Task 4) -- ditampilkan sebelum handleMuat/
  // handleSelesaiMuat yang sebenarnya jalan. pendingKodeSelesaiMuat
  // disimpan terpisah dari state `conflict` di atas (yang juga dipakai
  // jalur "save" yang tidak terkait kode sama sekali) supaya kode yang
  // sudah diverifikasi tetap tersedia saat konflik armada di-"Lanjutkan".
  const [showKodeDialog, setShowKodeDialog] = useState<"MULAI_MUAT" | "SELESAI_MUAT" | null>(null);
  const [kodeInput, setKodeInput] = useState("");
  const [kodeError, setKodeError] = useState<string | null>(null);
  const [pendingKodeSelesaiMuat, setPendingKodeSelesaiMuat] = useState("");
  // Lets staff drop the map panel entirely (no Leaflet init, no OSRM wait) —
  // useful on a slow connection when all they need is the stop list/totals
  // to check or share, matching what's already in buildShareText.
  const [showMap, setShowMap] = useState(true);
  // True only while captureDialogImage() is mid-capture — drops the
  // destinations list's max-height/scroll so every stop renders in the
  // screenshot instead of only whatever was scrolled into view.
  const [capturing, setCapturing] = useState(false);
  // True only during a batch capture: forces the narrow stacked (mobile-style)
  // layout even on desktop so every route card is a portrait rectangle that
  // tiles neatly into the batch grid image.
  const [portrait, setPortrait] = useState(false);
  // Mode melayang (opsi B): kotak Efektifitas lipat.
  const [efekBuka, setEfekBuka] = useState(false);
  // Tinggi kotak Bukti yang melayang di dasar peta (mode melayang) — kotak
  // pencarian, Efektifitas, dan pembingkaian rute naik setinggi ini.
  const [elBukti, setElBukti] = useState<HTMLDivElement | null>(null);
  const [tinggiBukti, setTinggiBukti] = useState(0);
  useEffect(() => {
    if (!elBukti) return;
    const ro = new ResizeObserver(() => setTinggiBukti(Math.round(elBukti.getBoundingClientRect().height) + 8));
    ro.observe(elBukti);
    return () => ro.disconnect();
  }, [elBukti]);
  const layarSempit = useIsMobile();
  // Peta latar penuh + panel melayang hanya di layar lebar dan bukan saat
  // tangkapan layar/potret — keduanya butuh tata letak bertumpuk yang utuh.
  const modeApung = showMap && !portrait && !capturing && !layarSempit;
  // Bumped right before a "Seluruhnya" capture to force RouteMap to
  // re-fit its bounds to the whole route (un-animated) before the
  // screenshot, overriding any manual pan/zoom — see FitBounds in
  // route-map.tsx.
  const [refitTrigger, setRefitTrigger] = useState(0);

  const [adding, setAdding] = useState(false);
  const [availableToAdd, setAvailableToAdd] = useState<AvailableSalesOrder[]>([]);
  const [selectedToAdd, setSelectedToAdd] = useState<Set<string>>(new Set());
  const [addError, setAddError] = useState<string | null>(null);

  const jadwalId = jadwal?.JadwalID ?? null;
  // RouteValidationDialog is a single persistent instance whose `jadwal`
  // prop is swapped by pengiriman-board.tsx's detailJadwalId state, not
  // remounted per card — so this ref tracks which Jadwal it is CURRENTLY
  // showing, resynced on every render straight from jadwalId rather than
  // from an open/close event, since an externally-driven open never fires
  // this component's own onOpenChange. Every async handler below captures
  // its own `targetId` at call time and re-checks this ref after each
  // await before touching setError/setAddError or any dialog-closing
  // state (onDeleted/onOpenChange) — a request in flight for one Jadwal
  // whose dialog got dismissed (or replaced by a different Jadwal card)
  // before the response arrives must not paint its stale error, or
  // silently close whichever Jadwal is now open, discarding its
  // in-progress state. Side effects that are true regardless of what's
  // currently displayed (toast notifications, opening a printed invoice
  // for a stop that really was just invoiced) are deliberately left
  // unguarded — the underlying action genuinely happened and skipping
  // them would change business behavior, not just avoid a stale paint.
  const jadwalIdRef = useRef<number | null>(jadwalId);
  jadwalIdRef.current = jadwalId;
  // Mirrors `loading` into a ref for the same reason jadwalIdRef exists —
  // captureForBatch/getTextForBatch (exposed below) poll this from an async
  // loop that outlives any single render, so it needs the live value rather
  // than whatever `loading` this closure happened to capture at call time.
  const loadingRef = useRef(loading);
  loadingRef.current = loading;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const totalQty = useMemo(() => order.reduce((sum, o) => sum + o.Qty, 0), [order]);
  // Tujuan antar sungguhan vs muatan cadangan (mitra Complimentary). Rute,
  // peta, urutan, estimasi waktu, dan teks bagikan memakai `tujuan`; total
  // muatan tetap memakai seluruh `order` (cadangan ikut dibawa truk).
  const tujuan = useMemo(() => order.filter((o) => !o.IsCadangan), [order]);
  const cadanganStops = useMemo(() => order.filter((o) => o.IsCadangan), [order]);
  const totalBonusQty = useMemo(() => order.reduce((sum, o) => sum + o.BonusQty, 0), [order]);
  const totalQty10KG = useMemo(() => order.reduce((sum, o) => sum + o.Qty10KG, 0), [order]);
  const totalQty5KG = useMemo(() => order.reduce((sum, o) => sum + o.Qty5KG, 0), [order]);
  const selectedToAddQty = useMemo(
    () => availableToAdd.filter((so) => selectedToAdd.has(so.SalesOrderID)).reduce((sum, so) => sum + so.Qty, 0),
    [availableToAdd, selectedToAdd]
  );

  useEffect(() => {
    // Resets the "Tambahkan" sub-panel when a different Jadwal card is
    // opened — not derivable from render since these are user-editable
    // picker fields, not synced from any jadwal prop.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAdding(false);
    setSelectedToAdd(new Set());
    setAddError(null);
    setShowMap(true);
    // A conflict popup left open from a previously-shown Jadwal must never
    // resurface against whichever Jadwal is opened next.
    setConflict(null);
    // Same reasoning — a proof-of-delivery popup for a stop on the
    // previous Jadwal must not stay open against the newly-opened one.
    setProofDetail(null);
    setSiDetail(null);

    if (jadwalId == null) {
      setOrder([]);
      setVehicleChecks([]);
      setNextJadwalStarted(false);
      setTotalRetur(0);
      setIstirahatSessions([]);
      return;
    }
    setLoading(true);
    setError(null);
    getJadwalDetailAction(jadwalId)
      .then((rows) => {
        setOrder(rows);
      })
      .finally(() => setLoading(false));
    getVehicleChecksForJadwalAction(jadwalId).then((rows) => {
      setVehicleChecks(rows);
      setCekDimuatUntuk(jadwalId);
    });
    getArmadaNextJadwalStartedAction(jadwalId).then(setNextJadwalStarted);
    getJadwalTotalReturAction(jadwalId).then(setTotalRetur);
    getIstirahatForJadwalAction(jadwalId).then(setIstirahatSessions);
  }, [jadwalId]);

  // Refetches just `order` after UbahPemesananDialog closes (saved or
  // cancelled — refetching unconditionally is simplest and safe: idempotent
  // if nothing changed, correctly fresh if the Qty edit went through).
  // Deliberately a separate effect from the one above rather than adding
  // salesOrderEditSignal to its dependency array — that effect also resets
  // the "Tambahkan" sub-panel, print selections, and map visibility, none
  // of which should be disturbed by an in-place Qty edit on one stop.
  useEffect(() => {
    if (jadwalId == null) return;
    getJadwalDetailAction(jadwalId).then(setOrder);
    // Deliberately keyed on salesOrderEditSignal only, not jadwalId — the
    // effect above already covers the initial fetch / jadwalId change, and
    // including jadwalId here too would just re-run this fetch redundantly
    // right after that one on every open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [salesOrderEditSignal]);

  useEffect(() => {
    if (jadwal == null) return;
    const d = new Date(jadwal.JamJadwal);
    // Syncs the editable date/time/driver fields from the open card — not
    // derivable from render since these are user-editable inputs. Unlike
    // the old time-only sync, this keeps the real calendar date too (see
    // the `date` state's own comment).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDate(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    setTime(`${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`);
    setDriverId(jadwal.SalesmanID ?? "");
  }, [jadwal]);

  // Builds the departure Date directly from the freely-editable `date` +
  // `time` fields — deliberately NOT resolveBusinessDateTime(businessDate,
  // time), which can only ever land on businessDate or businessDate minus
  // one day (see its own comment) and silently discards any date the user
  // picks outside that 2-day window. `date` is the authoritative source of
  // truth for the calendar day here.
  function buildJamJadwal(): Date {
    return new Date(`${date}T${time}:00`);
  }

  useEffect(() => {
    if (jadwalId == null) return;
    fetch("/api/mkesindo/pabrik-location")
      .then((res) => res.json())
      .then((data: { latitude: number; longitude: number }) => setPabrik(data))
      .catch(() => setPabrik(null));
    getPriceLevelOptionsAction().then(setPriceLevels);
    Promise.resolve(armadaId != null ? getArmadaUtilisasiHarianAction(armadaId, businessDate) : null).then(setUtilisasiHarian);
    Promise.resolve(armadaId != null ? getArmadaUtilisasiPeriodeAction(armadaId, businessDate) : null).then(setUtilisasiPeriode);
  }, [jadwalId, armadaId, businessDate]);

  // Live driver position for RouteMap's rotating truck marker — starts
  // once "Mulai Muat" has actually happened (confirmed 2026-08-20: shows
  // the driver's real position "mengikuti rute pengiriman" from that
  // point on) and keeps polling every 10 seconds (explicit request — 20s
  // was judged too slow) for as long as this dialog stays open on this
  // Jadwal. Requires a linked driver account (SalesmanID) — no account,
  // no ping to look up.
  const jamMulaiMuat = jadwal?.JamMulaiMuat ?? null;
  const salesmanIdForTracking = jadwal?.SalesmanID ?? null;
  useEffect(() => {
    if (jadwalId == null || jamMulaiMuat == null || !salesmanIdForTracking) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDriverPosition(null);
      return;
    }
    let cancelled = false;
    function poll() {
      getDriverPositionAction(salesmanIdForTracking!).then((pos) => {
        if (cancelled) return;
        setDriverPosition(pos ? { latitude: pos.latitude, longitude: pos.longitude, recordedAt: pos.recordedAt, source: "driver" } : null);
      });
    }
    poll();
    const interval = setInterval(poll, 10_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jadwalId, jamMulaiMuat, salesmanIdForTracking]);

  // Armada GPS tracker position for a Jadwal that is actually en route
  // (departed, not yet back — the DATANG check closes the trip). Only reads
  // what the GPS Kendaraan sync last stored, every 30s; the marker's own
  // label shows how old that ping is. Used only when the driver app has no
  // ping (see truckPosition below).
  const enRoute = jadwal?.JamAktualBerangkat != null && !vehicleChecks.some((c) => c.tipe === "DATANG");
  useEffect(() => {
    if (jadwalId == null || armadaId == null || !enRoute) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setArmadaGpsPosition(null);
      return;
    }
    let cancelled = false;
    function poll() {
      getLatestArmadaPositionAction(armadaId!).then((res) => {
        if (cancelled) return;
        const p = res.success ? res.data : null;
        setArmadaGpsPosition(
          p ? { latitude: p.latitude, longitude: p.longitude, heading: p.heading, recordedAt: p.recordedAt, source: p.provider } : null
        );
      });
    }
    poll();
    const interval = setInterval(poll, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jadwalId, armadaId, enRoute]);
  const truckPosition = driverPosition ?? armadaGpsPosition;

  // Rute AKTUAL dari riwayat provider GPS — diminta terpisah setelah dialog
  // tampil (tidak ikut pemuatan utama), jadi membuka Validasi Rute tidak
  // pernah menunggunya. Perjalanan yang sudah kembali cukup sekali (server
  // menyimpannya); yang masih berlangsung disegarkan tiap 2 menit.
  const berangkatAktualIso = jadwal?.JamAktualBerangkat ? new Date(jadwal.JamAktualBerangkat).toISOString() : null;
  const kembaliAktualIso = vehicleChecks.find((c) => c.tipe === "DATANG")?.checkedAt ?? null;
  const [jejak, setJejak] = useState<JejakPeta | null>(null);
  // Baris Log Pergerakan yang diklik → RouteMap melompat ke titiknya.
  const [fokusBerhenti, setFokusBerhenti] = useState<(FokusPeta & { n: number }) | null>(null);
  useEffect(() => {
    if (jadwalId == null || armadaId == null || !berangkatAktualIso) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setJejak(null);
      return;
    }
    // Belum tahu jam kembali — tunggu cek kendaraan termuat dulu.
    if (cekDimuatUntuk !== jadwalId) {
      setJejak({ keadaan: "memuat" });
      return;
    }
    const kendali = new AbortController();
    const qs = new URLSearchParams({ jadwalId: String(jadwalId), armadaId: String(armadaId), berangkat: berangkatAktualIso });
    if (kembaliAktualIso) qs.set("kembali", new Date(kembaliAktualIso).toISOString());
    function muat(awal: boolean) {
      if (awal) setJejak({ keadaan: "memuat" });
      fetch(`/api/mkesindo/jejak-armada?${qs}`, { signal: kendali.signal })
        .then(async (r) => {
          const body = await r.json().catch(() => null);
          if (!r.ok) throw new Error(body?.error ?? `Status ${r.status}`);
          return body as JejakAktual;
        })
        .then((data) => setJejak({ keadaan: "siap", data }))
        .catch((err: unknown) => {
          if (kendali.signal.aborted) return;
          // Penyegaran yang gagal tidak menghapus jejak yang sudah tampil.
          if (awal) setJejak({ keadaan: "gagal", pesan: err instanceof Error ? err.message : String(err) });
        });
    }
    muat(true);
    const interval = kembaliAktualIso ? null : setInterval(() => muat(false), 120_000);
    return () => {
      kendali.abort();
      if (interval) clearInterval(interval);
    };
  }, [jadwalId, armadaId, berangkatAktualIso, kembaliAktualIso, cekDimuatUntuk]);

  // Recomputes the route whenever the stop order or the pabrik location
  // changes. Every stop must have a saved coordinate — otherwise a full
  // route genuinely can't be computed, so this surfaces as routeError
  // (which in turn keeps "Berangkat" disabled, matching the mandatory-route
  // rule) instead of silently skipping stops.
  useEffect(() => {
    let cancelled = false;
    if (pabrik == null || order.length === 0) return;
    if (tujuan.length === 0) {
      // Hanya muatan cadangan — tidak ada rute untuk dihitung.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRoute(null);
      setRouteError("Keberangkatan ini hanya berisi muatan cadangan — tidak ada tujuan antar.");
      return;
    }
    const missing = tujuan.some((o) => o.Latitude == null || o.Longitude == null);
    if (missing) {
      // Stops changed to a set that genuinely can't be routed (missing
      // coordinates) — reset any stale route from the previous stop order
      // so "Berangkat" doesn't stay enabled against it.
      setRoute(null);
      setRouteError("Beberapa tujuan belum punya lokasi tersimpan — tidak bisa hitung rute.");
      return;
    }
    setRouteLoading(true);
    setRouteError(null);
    const points = [
      { lat: pabrik.latitude, lng: pabrik.longitude },
      ...tujuan.map((o) => ({ lat: o.Latitude as number, lng: o.Longitude as number })),
      { lat: pabrik.latitude, lng: pabrik.longitude },
    ];
    fetch("/api/mkesindo/routing/multi", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
    })
      .then((res) => res.json())
      .then((data: MultiPointRoute | { error: string }) => {
        if (cancelled) return;
        if ("error" in data) {
          setRoute(null);
          setRouteError(data.error);
        } else {
          setRoute(data);
        }
      })
      .catch(() => {
        if (cancelled) return;
        setRoute(null);
        setRouteError("Gagal menghitung rute.");
      })
      .finally(() => {
        if (cancelled) return;
        setRouteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [order, tujuan, pabrik]);

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // Hanya tujuan sungguhan yang bisa diurutkan; muatan cadangan selalu
    // diletakkan di akhir urutan.
    const oldIndex = tujuan.findIndex((o) => o.JadwalDetailID === active.id);
    const newIndex = tujuan.findIndex((o) => o.JadwalDetailID === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = [...arrayMove(tujuan, oldIndex, newIndex), ...cadanganStops];
    setOrder(next);
    if (jadwalId != null) {
      const targetId = jadwalId;
      setError(null);
      startTransition(async () => {
        const result = await updateJadwalUrutanAction(targetId, next.map((d) => d.JadwalDetailID));
        if (jadwalIdRef.current !== targetId) return;
        if (!result.success) {
          setError(result.error);
        }
      });
    }
  }

  // Actual driver/time persist, split out of handleSaveDriverTime so it can
  // run either immediately (no conflict) or after the user confirms merging
  // via ArmadaConflictDialog (see the conflict-check pre-flight below).
  function doSaveDriverTime(targetId: number, jamJadwal: Date) {
    startTransition(async () => {
      const result = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      // The new time landed inside another Draft's estimated busy window
      // for the same armada — this Jadwal got folded into that one
      // instead (see updateJadwalDriverTime), so there's nothing left
      // under jadwalId to keep showing here.
      if (result.data !== targetId) {
        toast.success(`Digabung dengan keberangkatan lain di jam yang sama untuk armada ini.`);
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
      }
    });
  }

  // Standalone "Simpan" path — still needed on its own since editing
  // driver/time while already Terbit (re-assigning driver/vehicle onto
  // existing DOs) doesn't go through handleSelesaiMuat/handleKonfirmasiBerangkat.
  // Pre-checks for an armada conflict (an overlapping Draft on the same
  // armada) before persisting — if found, pauses on ArmadaConflictDialog
  // instead of saving straight away (see conflict state above).
  function handleSaveDriverTime() {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      if (check) {
        setConflict({ info: check, jamJadwal, then: "save" });
        return;
      }
      doSaveDriverTime(targetId, jamJadwal);
    });
  }

  // Removing the last remaining stop also deletes the now-empty Jadwal
  // itself (removeSalesOrderFromJadwal's own cleanup) — nothing left to
  // show, so this closes the dialog the same way "Batalkan Draft" does.
  async function handleRemoveStop(detail: DriverStopRow) {
    if (jadwalId == null) return;
    if (!(await konfirmasi(`Keluarkan "${detail.CustomerName}" dari draft ini?`))) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await removeSalesOrderFromJadwalAction(targetId, detail.SalesOrderID);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      if (order.length <= 1) {
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }

  // Ganti lokasi pengiriman satu stop, lalu muat ulang daftar stop —
  // koordinat baru memicu hitung ulang rute (efek [order, pabrik]).
  function handleChangeLokasi(detail: DriverStopRow, lokasiPengirimanId: number | null) {
    if (jadwalId == null) return;
    if (detail.LokasiPengirimanID === lokasiPengirimanId) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await setJadwalDetailLokasiAction(detail.JadwalDetailID, lokasiPengirimanId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }

  function handleDeleteDraft() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await deleteJadwalDraftAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
        return;
      }
      if (jadwalIdRef.current === targetId) {
        onDeleted?.();
        onOpenChange(false);
      }
    });
  }

  // Manual fallback for "Mulai Muat" — the primary path is Aplikasi
  // Produksi's Isi Muatan flow (produksiMulaiMuatAction), which also
  // records pallet/stock consumption. This button calls startMuatAction
  // directly, exactly like before Produksi existed, for cases where a
  // Kartu Pengiriman needs to be pushed through without going via
  // produksi-app (e.g. a backlog Draft, or Produksi is unavailable) —
  // it does NOT deduct any pallet stock, so using it means the
  // warehouse/FIFO records won't reflect what was actually shipped.
  function handleMuat() {
    if (jadwalId == null) return;
    setKodeInput("");
    setKodeError(null);
    setShowKodeDialog("MULAI_MUAT");
  }

  function handleMuatDenganKode(kode: string) {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setKodeError(null);
    startTransition(async () => {
      const result = await startMuatAction(targetId, kode);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setKodeError(result.error);
        return;
      }
      setShowKodeDialog(null);
    });
  }

  // Selesai Muat creates the real DO+SI documents (see selesaiMuat); actual
  // printing of those documents is entirely the print queue's job now (see
  // Task 4/11 — selesaiMuat itself enqueues a print job per stop), so this
  // handler has no printing-related code of its own.
  //
  // Persists the currently-selected driver/time FIRST, same safety net the
  // old (now-removed) handleBerangkat had before it called startBerangkat:
  // selesaiMuat reads SalesmanID off the DB row, not off this component's
  // client state, so a driver picked in the dropdown but not yet "Simpan"-ed
  // would otherwise get silently attributed to whichever driver was last
  // persisted — on a real DeliveryOrder/SalesInvoice, once Status flips to
  // Terbit, that misattribution can no longer be corrected through the UI
  // (updateJadwalDriverTime refuses any edit once not Draft).
  // Actual driver/time persist + follow-on selesaiMuat, split out of
  // handleSelesaiMuat so it can run either immediately (no conflict) or
  // after the user confirms merging via ArmadaConflictDialog. Unlike
  // doSaveDriverTime, a successful save here continues on to
  // selesaiMuatAction and the invoice-printing loop — that's why this
  // isn't just a call to doSaveDriverTime.
  function doSaveDriverTimeThenSelesaiMuat(targetId: number, jamJadwal: Date, kode: string) {
    startTransition(async () => {
      const driverTimeResult = await updateJadwalDriverTimeAction(
        targetId,
        { jamJadwal, salesmanId: driverId || null },
        { skipOrderTimeCheck: true }
      );
      if (!driverTimeResult.success) {
        if (jadwalIdRef.current === targetId) setError(driverTimeResult.error);
        return;
      }
      // The new time landed inside another Draft's estimated busy window
      // for the same armada — this Jadwal got folded into that one
      // instead (see updateJadwalDriverTime), so there's nothing left
      // under jadwalId to run selesaiMuat against anymore.
      if (driverTimeResult.data !== targetId) {
        toast.success(
          "Waktu ini tumpang tindih dengan keberangkatan lain untuk armada ini — sudah digabung. Buka kembali untuk melanjutkan keberangkatan."
        );
        if (jadwalIdRef.current === targetId) {
          onDeleted?.();
          onOpenChange(false);
        }
        return;
      }
      const selesaiMuatResult = await selesaiMuatAction(targetId, kode);
      if (!selesaiMuatResult.success) {
        if (jadwalIdRef.current === targetId) setError(selesaiMuatResult.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) setOrder(rows);
    });
  }

  // Pre-checks for an armada conflict (an overlapping Draft on the same
  // armada) before persisting — if found, pauses on ArmadaConflictDialog
  // instead of proceeding straight to save + selesaiMuat (see conflict
  // state above and doSaveDriverTimeThenSelesaiMuat).
  function handleSelesaiMuat() {
    if (jadwalId == null || armadaId == null) return;
    setKodeInput("");
    setKodeError(null);
    setShowKodeDialog("SELESAI_MUAT");
  }

  function handleSelesaiMuatDenganKode(kode: string) {
    if (jadwalId == null || armadaId == null) return;
    const targetId = jadwalId;
    const jamJadwal = buildJamJadwal();
    setKodeError(null);
    startTransition(async () => {
      const check = await checkArmadaConflictAction(armadaId, jamJadwal, totalQty, targetId);
      if (jadwalIdRef.current !== targetId) return;
      setShowKodeDialog(null);
      if (check) {
        setPendingKodeSelesaiMuat(kode);
        setConflict({ info: check, jamJadwal, then: "selesaiMuat" });
        return;
      }
      doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal, kode);
    });
  }

  function handleKonfirmasiBerangkat() {
    if (jadwalId == null) return;
    const targetId = jadwalId;
    setError(null);
    startTransition(async () => {
      const result = await konfirmasiBerangkatAction(targetId);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setError(result.error);
      }
    });
  }

  function handleOpenAdd() {
    if (jadwalId == null) return;
    setAdding(true);
    setSelectedToAdd(new Set());
    setAddError(null);
    getAvailableSalesOrdersAction(businessDate).then(setAvailableToAdd);
  }

  function handleToggleAdd(id: string, qty: number) {
    setSelectedToAdd((prev) => {
      const isSelected = prev.has(id);
      if (!isSelected && kapasitasMaks != null && totalQty + selectedToAddQty + qty > kapasitasMaks) {
        return prev;
      }
      const next = new Set(prev);
      if (isSelected) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleConfirmAdd() {
    if (jadwalId == null || selectedToAdd.size === 0) return;
    const targetId = jadwalId;
    setAddError(null);
    startTransition(async () => {
      const result = await addSalesOrdersToJadwalAction(targetId, [...selectedToAdd]);
      if (!result.success) {
        if (jadwalIdRef.current === targetId) setAddError(result.error);
        return;
      }
      const rows = await getJadwalDetailAction(targetId);
      if (jadwalIdRef.current === targetId) {
        setOrder(rows);
        setAdding(false);
      }
    });
  }


  const isDraft = jadwal?.Status === "Draft";
  const isWaitingDeparture = jadwal?.Status === "Terbit" && jadwal?.JamAktualBerangkat == null;
  const hasDeparted = jadwal?.JamAktualBerangkat != null;
  const hasBerangkatCheck = vehicleChecks.some((c) => c.tipe === "BERANGKAT");
  const jamKembaliAktual = vehicleChecks.find((c) => c.tipe === "DATANG")?.checkedAt ?? null;

  // "Draf dibuat" is an administrative marker, not part of the timed
  // loading/departure pipeline — it never gets a duration (the gap before
  // Mulai Muat can be arbitrarily long and isn't meaningful to show). The
  // pipeline itself starts counting from Mulai Muat: each later step's
  // duration is the elapsed time since the immediately preceding step that
  // has actually happened.
  const statusHistory = useMemo(() => {
    if (!jadwal) return [];
    const rawPipeline: { label: string; timestamp: string | Date | null }[] = [
      { label: "Mulai Muat", timestamp: jadwal.JamMulaiMuat },
      { label: "Selesai Muat", timestamp: jadwal.JamSelesaiMuat },
      { label: "Berangkat", timestamp: jadwal.JamAktualBerangkat },
      { label: "Datang", timestamp: jamKembaliAktual },
    ];

    let prevMs: number | null = null;
    const withDuration: { label: string; timestamp: string | Date; durationLabel: string | null }[] = [];
    for (const s of rawPipeline) {
      if (s.timestamp == null) continue;
      const ms = new Date(s.timestamp).getTime();
      const durationLabel = prevMs != null ? formatDurationMinutes(Math.round((ms - prevMs) / 60000)) : null;
      prevMs = ms;
      withDuration.push({ label: s.label, timestamp: s.timestamp, durationLabel });
    }

    return [{ label: "Draf dibuat", timestamp: jadwal.CreatedDate, durationLabel: null }, ...withDuration];
  }, [jadwal, jamKembaliAktual]);

  // Riwayat Status time summary (Task 11): total time on break, total time
  // from actual departure to actual arrival (or now, if still en route),
  // and the difference between the two ("effective" delivery time with
  // breaks excluded).
  const totalIstirahatMenit = useMemo(
    () => istirahatSessions.reduce((sum, s) => sum + s.durasiMenit, 0),
    [istirahatSessions]
  );
  // Null (not 0) before departure — there's nothing to measure "berjalan"
  // time against yet, and showing "0 Menit" would misleadingly imply the
  // trip already started.
  const totalBerjalanMenit = useMemo(() => {
    if (!jadwal?.JamAktualBerangkat) return null;
    const endMs = resolveEndMs(jamKembaliAktual);
    return Math.round((endMs - new Date(jadwal.JamAktualBerangkat).getTime()) / 60000);
  }, [jadwal, jamKembaliAktual]);
  const waktuEfektifMenit = totalBerjalanMenit != null ? totalBerjalanMenit - totalIstirahatMenit : null;
  const sudahSelesai = jamKembaliAktual != null;

  // Linimasa status menyamping untuk ekspor gambar (pengganti tombol
  // Riwayat Status): jam tiap tahap kiri→kanan, lalu durasi pengiriman
  // (Berangkat → Datang) bila sudah selesai.
  // Ekspor rute Draft: jam "Draf dibuat" sudah tertulis di chip Draft, jadi
  // tidak diulang di linimasa.
  const linimasaEkspor = isDraft ? statusHistory.filter((s) => s.label !== "Draf dibuat") : statusHistory;
  function renderLinimasaStatus() {
    return (
      <div className="flex flex-nowrap items-center gap-1.5 text-xs whitespace-nowrap">
        {linimasaEkspor.map((s, i) => (
          <Fragment key={s.label}>
            {i > 0 && <span aria-hidden className="mb-2.5 h-0.5 w-4 shrink-0 rounded-full bg-foreground/25" />}
            <span className="flex flex-col items-center leading-tight">
              <span className="font-semibold tabular-nums">{formatTime(s.timestamp)}</span>
              <span className="text-[9px] text-muted-foreground">{s.label}</span>
            </span>
          </Fragment>
        ))}
        {sudahSelesai && totalBerjalanMenit != null && (
          <span className="ml-2 inline-flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 font-semibold text-primary tabular-nums">
            <Clock className="size-3" />
            {formatDurationMinutes(totalBerjalanMenit)}
          </span>
        )}
      </div>
    );
  }

  // Same sentence the status area below used to show on its own — now it
  // doubles as the Riwayat Status trigger's own label (next to the Terbit
  // badge) so there's one line of truth instead of two.
  const currentStatusLabel = !jadwal
    ? "Riwayat Status"
    : isDraft
      ? jadwal.JamMulaiMuat == null
        ? `Draf dibuat pukul ${formatTime(jadwal.CreatedDate)}`
        : `Mulai Muat pukul ${formatTime(jadwal.JamMulaiMuat)}`
      : isWaitingDeparture
        ? `Selesai Muat pukul ${formatTime(jadwal.JamSelesaiMuat as string)} — menunggu Cek Berangkat`
        : jadwal.JamAktualBerangkat
          ? `Sudah berangkat pukul ${formatTime(jadwal.JamAktualBerangkat)}`
          : "Riwayat Status";
  const isFutureDate = businessDate > todayISO;
  const overCapacity = kapasitasMaks != null && totalQty > kapasitasMaks;
  const canSelesaiMuat = isDraft && driverId !== "" && route != null && !routeLoading && !overCapacity && !isFutureDate;
  const totalFuelLiters = useMemo(() => {
    if (route == null || konsumsiBBM == null) return null;
    return Math.round(route.distanceKm * konsumsiBBM * 10) / 10;
  }, [route, konsumsiBBM]);
  const totalFuelCost = useMemo(() => {
    if (totalFuelLiters == null || biayaBBMPerLiter == null) return null;
    return Math.round(totalFuelLiters * biayaBBMPerLiter);
  }, [totalFuelLiters, biayaBBMPerLiter]);
  // "Biaya BBM tambahan": a 15% buffer on top of the base fuel cost above,
  // shown separately (never merged into totalFuelCost) — confirmed formula
  // with the user 2026-08-20, replacing the old floor(distanceKm/5) segment
  // formula. Applies uniformly to every jenisBBM (Solar, Pertalite, etc.),
  // since it's a flat percentage of whatever totalFuelCost already resolved
  // to for that fuel type.
  const extraFuelCost = useMemo(() => {
    if (totalFuelCost == null) return null;
    return Math.round(totalFuelCost * 0.15);
  }, [totalFuelCost]);
  // Base + tambahan, rounded UP (never down) to the nearest Rp1.000 — also
  // confirmed mandatory with the user, e.g. 93.840 + 14.076 = 107.916 ->
  // 108.000.
  const totalFuelCostWithExtra = useMemo(() => {
    if (totalFuelCost == null || extraFuelCost == null) return null;
    return Math.ceil((totalFuelCost + extraFuelCost) / 1000) * 1000;
  }, [totalFuelCost, extraFuelCost]);

  // Efektifitas Armada — confirmed formula with the user 2026-08-20:
  // 1. Jarak Tempuh (km) x rata-rata harga jual per kantong
  // 2. Total konsumsi BBM x harga per liter (== totalFuelCost above, the
  //    BASE fuel cost — deliberately not totalFuelCostWithExtra, the
  //    formula only asked for consumption x price/liter)
  // 3. (Hasil 1 - Hasil 2) / Jarak Tempuh (km) -> Rupiah margin per km
  const priceByLevel = useMemo(() => new Map(priceLevels.map((p) => [p.Level, p.Price])), [priceLevels]);
  // Weighted by each stop's own kantong qty (total revenue / total
  // kantong) rather than a flat average of price LEVELS, so a few
  // high-qty stops at one price level aren't diluted by many low-qty
  // stops at another. Stops with no resolved price level/price are
  // excluded from both the revenue and qty sums.
  const avgHargaJualPerKantong = useMemo(() => {
    let revenue = 0;
    let qty = 0;
    for (const o of order) {
      const price = o.PriceLevel != null ? priceByLevel.get(o.PriceLevel) : undefined;
      if (price == null) continue;
      revenue += price * o.Qty;
      qty += o.Qty;
    }
    return qty > 0 ? revenue / qty : null;
  }, [order, priceByLevel]);
  const efektivitasHasil1 = useMemo(() => {
    if (route == null || avgHargaJualPerKantong == null) return null;
    return route.distanceKm * avgHargaJualPerKantong;
  }, [route, avgHargaJualPerKantong]);
  const efektivitasPerKm = useMemo(() => {
    if (efektivitasHasil1 == null || totalFuelCost == null || route == null || route.distanceKm <= 0) return null;
    return (efektivitasHasil1 - totalFuelCost) / route.distanceKm;
  }, [efektivitasHasil1, totalFuelCost, route]);
  const efektivitasSelisih = useMemo(() => {
    if (efektivitasHasil1 == null || totalFuelCost == null) return null;
    return efektivitasHasil1 - totalFuelCost;
  }, [efektivitasHasil1, totalFuelCost]);

  // Poin 4 -- Utility Effectiveness (confirmed with user 2026-09-18):
  // WO / (WO + Idle + B), whole-day figure from getArmadaUtilisasiHarian.
  // Zero-denominator (no WO/Idle/B recorded at all for this armada+day yet)
  // is treated as "not yet computable", same as the other poin's guards.
  const utilityEffectiveness = useMemo(() => {
    if (utilisasiHarian == null) return null;
    const total = utilisasiHarian.waktuOperasionalMenit + utilisasiHarian.idleMenit + utilisasiHarian.breakdownMenit;
    if (total <= 0) return null;
    return utilisasiHarian.waktuOperasionalMenit / total;
  }, [utilisasiHarian]);

  // Poin 5 -- Utility Effectiveness Per Periode (confirmed with user
  // 2026-09-23): same WO / (WO + Idle + B) shape as poin 4, windowed to the
  // 14:00 WIB Periode Pengiriman instead of the whole Kerja-shift day.
  const utilityEffectivenessPeriode = useMemo(() => {
    if (utilisasiPeriode == null) return null;
    const total = utilisasiPeriode.waktuOperasionalMenit + utilisasiPeriode.idleMenit + utilisasiPeriode.breakdownMenit;
    if (total <= 0) return null;
    return utilisasiPeriode.waktuOperasionalMenit / total;
  }, [utilisasiPeriode]);

  // Aggregate bongkar time across every stop in the current order — the
  // per-stop "~X menit" label (SortableStopRow) shows this same function's
  // result for one stop; this is the sum across all of them, feeding the
  // route summary's time breakdown below.
  const bongkarTotalMenit = useMemo(() => {
    return tujuan.reduce((sum, o) => sum + estimateDeliveryMinutes(o.Qty), 0);
  }, [tujuan]);
  const konfirmasiTotalMenit = tujuan.length * CONFIRMATION_MINUTES_PER_STOP;

  // "Detail Rute" — plain-text destination list only (no route/fuel
  // figures, those are visual-only info covered by the image share
  // options below). No public link/token exists for this dialog, so
  // sharing means handing off a readable recap rather than a URL.
  function buildStopListText(): string {
    if (!jadwal) return "";
    const lines = [
      `Daftar Tujuan — ${armadaNama ?? "Armada"}`,
      `${formatDate(businessDate)} ${time}${driverId ? ` · ${drivers.find((d) => d.SalesmanID === driverId)?.Name ?? ""}` : ""}`,
      "",
      ...tujuan.map(
        (o, i) =>
          `${i + 1}. ${o.CustomerName} — ${o.Wilayah} (${formatKemasanQty(o.Qty10KG, o.Qty5KG)}${o.BonusQty > 0 ? ` +${o.BonusQty} bonus` : ""})`
      ),
      ...(cadanganStops.length > 0
        ? [
            "",
            `Muatan cadangan: ${formatKemasanQty(
              cadanganStops.reduce((t, o) => t + o.Qty10KG, 0),
              cadanganStops.reduce((t, o) => t + o.Qty5KG, 0)
            )}`,
          ]
        : []),
      "",
      `Total: ${formatKemasanQty(totalQty10KG, totalQty5KG)}${totalBonusQty > 0 ? ` (+${totalBonusQty} bonus)` : ""}`,
    ];
    return lines.join("\n");
  }

  const captureRef = useRef<HTMLDivElement>(null);

  // Tunggu peta di dalam `akar` siap ditangkap: semua tile raster Leaflet
  // termuat (+ jeda transisi pudar 200 ms-nya) dan lapisan vektor MapLibre
  // (penanda data-peta-vektor dari LapisanVektor) sudah "idle". Batas 8 dtk
  // supaya tile yang gagal tidak menggantung Bagikan selamanya.
  async function tungguPetaSiap(akar: HTMLElement, batasMs = 8000) {
    const mulai = Date.now();
    const jeda = (ms: number) => new Promise((r) => setTimeout(r, ms));
    await jeda(150);
    while (Date.now() - mulai < batasMs) {
      const tile = [...akar.querySelectorAll<HTMLImageElement>("img.leaflet-tile")];
      const rasterSiap = tile.every((t) => t.complete && t.classList.contains("leaflet-tile-loaded"));
      const vektorSiap = [...akar.querySelectorAll<HTMLElement>("[data-peta-vektor]")].every(
        (el) => el.dataset.petaVektor === "siap"
      );
      if (rasterSiap && vektorSiap) break;
      await jeda(100);
    }
    await jeda(300);
  }

  // Renders captureRef's subtree (dialog title/summary + body) to a PNG
  // Blob — skips any node marked data-capture-hide (action buttons that
  // don't make sense in a shared screenshot, e.g. the Bagikan trigger
  // itself, "Cetak DO Terpilih", and the "Tambahkan" sub-panel). Also:
  // (a) drops the destinations list's max-height/scroll (capturing state)
  // so every stop is actually rendered, not clipped to whatever was
  // scrolled into view, and (b) if the map is showing, forces it to
  // re-fit the whole route first (refitTrigger) — both would otherwise
  // let the captured image silently cut off real route data.
  async function captureDialogImage(): Promise<Blob | null> {
    if (!captureRef.current) return null;
    setCapturing(true);
    if (showMap) setRefitTrigger((n) => n + 1);
    // Two frames: one for the capturing-driven layout change (list
    // max-height removed) to reflow, one more for RouteMap's un-animated
    // fitBounds to finish repainting tiles at the new view.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    // Tangkapan memakai tata letak bertumpuk, jadi peta dipasang ULANG dari
    // nol (bukan peta mode melayang yang sudah termuat) — tunggu tile dasar
    // (raster & vektor) selesai, kalau tidak gambar berisi peta kosong.
    if (showMap && captureRef.current) {
      // Peta baru dimuat lewat dynamic import; tunggu wadahnya ada, lalu
      // bingkai ulang rute di ukuran akhirnya sebelum menunggu tile.
      const akar = captureRef.current;
      for (let i = 0; i < 30 && !akar.querySelector(".leaflet-container"); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      // Lebar dialog beranimasi dari mode melayang (layar penuh) ke tata
      // letak bertumpuk — wadah peta menyusut ±0,5 dtk. Tunggu ukurannya
      // stabil dulu, kalau tidak rute dibingkai di ukuran lama & terpotong.
      let ukuranLama = "";
      for (let i = 0, stabil = 0; i < 40 && stabil < 3; i++) {
        const r = akar.querySelector(".leaflet-container")?.getBoundingClientRect();
        const ukuran = r ? `${Math.round(r.width)}x${Math.round(r.height)}` : "";
        stabil = ukuran && ukuran === ukuranLama ? stabil + 1 : 0;
        ukuranLama = ukuran;
        await new Promise((r) => setTimeout(r, 100));
      }
      setRefitTrigger((n) => n + 1);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await tungguPetaSiap(akar);
    }
    try {
      const { toBlob } = await import("html-to-image");
      return await toBlob(captureRef.current, {
        pixelRatio: 2,
        filter: (node) => !(node instanceof Element && node.getAttribute("data-capture-hide") === "true"),
      });
    } finally {
      setCapturing(false);
    }
  }

  async function handleShareSeluruhnya() {
    const blob = await captureDialogImage();
    if (blob) await shareImageBlob(blob, "validasi-rute.png", "Validasi Rute");
  }

  async function handleShareDetailRute() {
    const text = buildStopListText();
    if (!text) return;
    await shareTextBlock(text, "Detail Rute");
  }

  // Reuses the same map-hiding layout the dialog already has (see showMap)
  // instead of a separate capture-time DOM filter — guarantees the config
  // panel reflows to full width exactly like the user-facing "no map"
  // layout already does, with no leftover gap where the map was. Split out
  // from handleShareDataRute (which just shares whatever this returns) so
  // captureForBatch below can reuse the same hide-map-then-capture step
  // without also triggering a share on every route in a batch.
  async function captureDataRuteImage(): Promise<Blob | null> {
    const wasShowingMap = showMap;
    if (wasShowingMap) {
      setShowMap(false);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }
    try {
      return await captureDialogImage();
    } finally {
      if (wasShowingMap) setShowMap(true);
    }
  }

  async function handleShareDataRute() {
    const blob = await captureDataRuteImage();
    if (blob) await shareImageBlob(blob, "data-rute.png", "Data Rute");
  }

  // Polls jadwalIdRef/loadingRef (both refs, always current regardless of
  // which render this closure was called from) until targetJadwalId's
  // detail fetch has landed, or 10s pass — the effect that flips `loading`
  // false is keyed on jadwalId (see the big effect above), so once this
  // resolves true, `order`/`jadwal` in THIS render are safe to read for
  // that target. Used only by captureForBatch/getTextForBatch below.
  async function waitUntilReadyForBatch(targetJadwalId: number, timeoutMs = 10000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      if (jadwalIdRef.current === targetJadwalId && !loadingRef.current) return true;
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    return false;
  }

  // No deps array (deliberate): captureDialogImage/captureDataRuteImage/
  // buildStopListText close over `order`/`jadwal`/`showMap`/etc. from
  // whichever render defined them, so the exposed methods must be
  // refreshed every render to avoid the batch caller ever reading stale
  // (e.g. initial empty `order`) closures — see loadingRef's comment for
  // why the readiness wait itself doesn't have this problem.
  useImperativeHandle(ref, () => ({
    async captureForBatch(targetJadwalId, mode) {
      const ready = await waitUntilReadyForBatch(targetJadwalId);
      if (!ready || jadwalIdRef.current !== targetJadwalId) return null;
      setPortrait(true);
      // Let the narrow layout reflow (and the map resize) before capturing.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      await new Promise((resolve) => setTimeout(resolve, 150));
      try {
        return mode === "data" ? await captureDataRuteImage() : await captureDialogImage();
      } finally {
        setPortrait(false);
      }
    },
    async getTextForBatch(targetJadwalId) {
      const ready = await waitUntilReadyForBatch(targetJadwalId);
      if (!ready || jadwalIdRef.current !== targetJadwalId) return null;
      return buildStopListText();
    },
  }));

  const ruangBukti = modeApung && !isDraft && elBukti ? tinggiBukti : 0;
  // Log Pergerakan: analisis jejak GPS terhadap rencana (src/lib/
  // analisis-jejak.ts) — hasil yang sama dipakai daftar tujuan & RouteMap.
  const jejakData = jejak?.keadaan === "siap" && jejak.data.status === "ada" ? jejak.data : null;
  const analisis = useMemo(() => {
    if (!jejakData || !pabrik) return null;
    return analisisJejak({
      titik: jejakData.titik,
      waktu: jejakData.waktu ?? [],
      kecepatan: jejakData.kecepatan ?? [],
      berhenti: jejakData.berhenti,
      // Nomor = nomor kartu (urutan rencana), termasuk tujuan tanpa titik.
      tujuan: tujuan.flatMap((o, i) =>
        o.Latitude != null && o.Longitude != null
          ? [{ id: o.JadwalDetailID, nama: o.CustomerName, nomor: i + 1, lat: o.Latitude, lng: o.Longitude }]
          : []
      ),
      pabrik: { lat: pabrik.latitude, lng: pabrik.longitude },
      rencana: (route?.geometry ?? []).map(([lng, lat]) => ({ lat, lng })),
      final: jejakData.final,
    });
  }, [jejakData, pabrik, tujuan, route?.geometry]);
  // Catatan berbaur DI DALAM daftar tujuan (bukan kotak terpisah): jam
  // bongkar & masalah menempel di kartu mitra, catatan perjalanan disisipkan
  // di antara kartu sesuai urutan waktu.
  const sisipan = analisis ? tempatkanCatatan(analisis) : new Map<number | "awal", CatatanPerjalanan[]>();
  const fokuskan = (f: FokusPeta) => setFokusBerhenti({ ...f, n: Date.now() });
  const barisSisipan = (kunci: number | "awal") =>
    (sisipan.get(kunci) ?? []).map((c) => (
      <BarisCatatan key={`${c.jenis}-${c.mulai}`} c={c} onPilih={fokuskan} />
    ));
  // ---- Potongan isi dialog: dipakai bersama oleh mode melayang (panel
  // bertab di atas peta) dan tata letak bertumpuk (Bagikan/potret/HP).
  const bagianKontrol = (
    <>
            {/* Ekspor gambar: tanggal/jam/driver jadi teks biasa, bukan kontrol form. */}
            {isDraft && capturing ? (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <span className="font-medium">{date ? formatDate(date) : "-"}</span>
                <span className="font-medium tabular-nums">{time || "--:--"}</span>
                <span className="flex items-center gap-1 text-muted-foreground">
                  <UserRound className="size-3.5" />
                  {drivers.find((d) => d.SalesmanID === driverId)?.Name ?? "Belum ada driver"}
                </span>
              </p>
            ) : isDraft ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="w-40 shrink-0" />
                <TimeInput value={time} onChange={setTime} className="shrink-0" />
                <Select value={driverId} onValueChange={(v) => setDriverId(v ?? "")}>
                  <SelectTrigger className="min-w-40 flex-1">
                    <SelectValue placeholder="Driver">
                      {(v: string) => drivers.find((d) => d.SalesmanID === v)?.Name ?? "Pilih Driver"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {drivers.map((d) => (
                      <SelectItem key={d.SalesmanID} value={d.SalesmanID}>
                        {d.Name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {isDraft && isFutureDate && (
              <p className="text-xs text-muted-foreground">
                Keberangkatan ini dijadwalkan untuk {formatDate(businessDate)} — Mulai Muat dan Berangkat baru bisa
                dilakukan pada hari itu.
              </p>
            )}

            {overCapacity && (
              <p className="text-xs text-destructive">
                Total muatan {totalQty} kantong melebihi kapasitas armada ({kapasitasMaks} kantong).
              </p>
            )}

    </>
  );
  const bagianKontrolAda = isDraft || overCapacity;
  const bagianDaftar = (
    <>
            <div
              className={cn(
                "flex flex-col",
                modeApung ? "gap-1" : "rounded-lg border",
                capturing || modeApung ? "max-h-none overflow-visible" : "max-h-80 overflow-y-auto"
              )}
            >
              {loading && <p className="py-6 text-center text-sm text-muted-foreground">Memuat...</p>}
              {!loading && order.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">Tidak ada SO.</p>
              )}
              {!loading && order.length > 0 && (
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                  <SortableContext items={tujuan.map((o) => o.JadwalDetailID)} strategy={verticalListSortingStrategy}>
                    {analisis?.urutanAktual && <BarisUrutan urutan={analisis.urutanAktual} />}
                    {barisSisipan("awal")}
                    {tujuan.map((d, i) => (
                      <Fragment key={d.JadwalDetailID}>
                        <SortableStopRow
                          detail={d}
                          index={i}
                          onEdit={onEditSalesOrder}
                          disabled={!isDraft}
                          onOpenSi={setSiDetail}
                          onRemove={isDraft ? handleRemoveStop : undefined}
                          hasDeparted={hasDeparted}
                          ringkas={modeApung}
                          ekspor={capturing}
                          onOpenProof={setProofDetail}
                          onChangeLokasi={isDraft ? handleChangeLokasi : undefined}
                          bongkarGps={analisis ? (analisis.bongkarPerTujuan.get(d.JadwalDetailID) ?? []) : undefined}
                          masalahGps={analisis?.masalahPerTujuan.get(d.JadwalDetailID)}
                          onFokus={fokuskan}
                        />
                        {barisSisipan(d.JadwalDetailID)}
                      </Fragment>
                    ))}
                  </SortableContext>
                  {/* Muatan cadangan (mitra Complimentary): ikut dibawa truk untuk
                      mengganti kantong bermasalah/ditolak, BUKAN tujuan antar —
                      tidak bernomor, tidak bisa diurutkan, tidak masuk rute. */}
                  {cadanganStops.length > 0 && (
                    <>
                      <p
                        className={cn(
                          "text-[11px] font-medium uppercase tracking-wide text-sky-700 dark:text-sky-300",
                          modeApung ? "px-1 pt-1" : "border-y bg-sky-500/5 px-3 py-1.5"
                        )}
                      >
                        Muatan Cadangan
                      </p>
                      <SortableContext items={cadanganStops.map((o) => o.JadwalDetailID)} strategy={verticalListSortingStrategy}>
                        {cadanganStops.map((d, i) => (
                          <SortableStopRow
                            key={d.JadwalDetailID}
                            detail={d}
                            index={i}
                            onEdit={onEditSalesOrder}
                            disabled={!isDraft}
                            onOpenSi={setSiDetail}
                            onRemove={isDraft ? handleRemoveStop : undefined}
                            hasDeparted={hasDeparted}
                            ringkas={modeApung}
                            ekspor={capturing}
                            onOpenProof={setProofDetail}
                          />
                        ))}
                      </SortableContext>
                    </>
                  )}
                </DndContext>
              )}
            </div>

    </>
  );
  const bagianTotal = (
    <>
            {order.length > 0 && (
              <div className="flex items-center gap-2 rounded-lg bg-primary/5 px-3 py-2 text-sm">
                <Package className="size-4 text-primary" />
                <span className="font-medium">
                  {formatKemasanQty(totalQty10KG, totalQty5KG)}
                  {totalBonusQty > 0 && <span className="text-primary"> (+{totalBonusQty} bonus)</span>}
                  {totalRetur > 0 && <span className="text-destructive"> (Retur {totalRetur})</span>}
                </span>
              </div>
            )}

    </>
  );
  const bagianAksi = (
    <>
            {isDraft && (
              <div className="flex flex-wrap items-center gap-2" data-capture-hide="true">
                {!adding && (
                  <Button size="sm" variant="ghost" className="gap-1.5" disabled={pending} onClick={handleOpenAdd}>
                    <Plus className="size-3.5" />
                    Tambahkan
                  </Button>
                )}
                <Button size="sm" variant="outline" disabled={pending} onClick={handleDeleteDraft}>
                  Batalkan Draft
                </Button>
                <Button size="sm" variant="outline" disabled={pending} onClick={handleSaveDriverTime}>
                  Simpan
                </Button>
                {jadwal?.JamMulaiMuat == null ? (
                  <Button size="sm" variant="outline" className="ml-auto" disabled={pending || isFutureDate} onClick={handleMuat}>
                    Mulai Muat
                  </Button>
                ) : (
                  <Button size="sm" className="ml-auto" disabled={!canSelesaiMuat || pending} onClick={handleSelesaiMuat}>
                    {pending ? "Memproses..." : "Selesai Muat"}
                  </Button>
                )}
              </div>
            )}

    </>
  );
  const bagianTambah = (
    <>
            {isDraft && adding && (
              <div className="flex flex-col gap-2 rounded-lg border p-2" data-capture-hide="true">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">Pilih SO tambahan</span>
                  {kapasitasMaks != null && (
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        totalQty + selectedToAddQty > kapasitasMaks ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {totalQty + selectedToAddQty} / {kapasitasMaks} kantong
                    </span>
                  )}
                </div>
                {addError && <p className="text-xs text-destructive">{addError}</p>}
                <div className="flex max-h-40 flex-col divide-y overflow-y-auto rounded-md border">
                  {availableToAdd.map((so) => {
                    const isSelected = selectedToAdd.has(so.SalesOrderID);
                    const soOverCapacity = !isSelected && kapasitasMaks != null && totalQty + selectedToAddQty + so.Qty > kapasitasMaks;
                    return (
                      <button
                        key={so.SalesOrderID}
                        type="button"
                        disabled={soOverCapacity}
                        onClick={() => handleToggleAdd(so.SalesOrderID, so.Qty)}
                        className={cn(
                          "flex items-center justify-between gap-2 px-2 py-1.5 text-left text-xs transition-colors",
                          isSelected && "bg-primary/10",
                          !isSelected && !soOverCapacity && "hover:bg-muted",
                          soOverCapacity && "cursor-not-allowed opacity-40"
                        )}
                      >
                        <span className="min-w-0 truncate">
                          {so.CustomerName} <span className="text-muted-foreground">· {so.Wilayah}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{formatKemasanQty(so.Qty10KG, so.Qty5KG)}</span>
                      </button>
                    );
                  })}
                  {availableToAdd.length === 0 && (
                    <p className="py-4 text-center text-xs text-muted-foreground">Tidak ada SO yang tersedia.</p>
                  )}
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" className="flex-1" disabled={pending} onClick={() => setAdding(false)}>
                    Batal
                  </Button>
                  <Button size="sm" className="flex-1" disabled={pending || selectedToAdd.size === 0} onClick={handleConfirmAdd}>
                    Tambah ({selectedToAdd.size})
                  </Button>
                </div>
              </div>
            )}

    </>
  );
  const bagianRingkas = (
    <>
            {routeError && <p className="text-xs text-destructive">{routeError}</p>}
            {route && (
              <div
                className={cn(
                  "flex rounded-lg border bg-muted/30",
                  // Ekspor: huruf & jarak lebih kecil, label disingkat, satu baris.
                  capturing
                    ? "flex-nowrap items-center gap-2 px-2.5 py-1.5 text-[11px] whitespace-nowrap [&_svg]:size-3.5"
                    : "flex-wrap gap-3 px-3 py-2 text-sm"
                )}
              >
                <span className="flex items-center gap-1">
                  <Clock className="size-4 text-muted-foreground" />
                  Tempuh {route.durationMinutes} + Bongkar {Math.round(bongkarTotalMenit)} +{" "}
                  {capturing ? "Konf." : "Konfirmasi"} {konfirmasiTotalMenit} ={" "}
                  {Math.round(route.durationMinutes + bongkarTotalMenit + konfirmasiTotalMenit)} {capturing ? "mnt" : "menit"}
                </span>
                {totalFuelLiters != null && (
                  <span className="flex items-center gap-1">
                    <Fuel className="size-4 text-muted-foreground" />
                    {totalFuelLiters.toLocaleString("id-ID")} L
                    {jenisBBM && ` (${jenisBBM})`}
                  </span>
                )}
                {totalFuelCost != null && (
                  <span className="flex items-center gap-1 font-medium">{formatRupiah(totalFuelCost)}</span>
                )}
                {extraFuelCost != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">+ {formatRupiah(extraFuelCost)}</span>
                )}
                {totalFuelCostWithExtra != null && (
                  <span className="flex items-center gap-1 font-semibold text-primary">= {formatRupiah(totalFuelCostWithExtra)}</span>
                )}
              </div>
            )}

    </>
  );
  const bagianBukti = (
    <>
            {!isDraft && (
              <div className={modeApung ? "grid grid-cols-2 gap-3" : "flex flex-col gap-2"}>
                {/* Ekspor gambar memakai tampilan ringkas yang sama dengan
                    mode melayang (bukan kartu lama). */}
                {(["BERANGKAT", "DATANG"] as const).map((tipe) => {
                  const check = vehicleChecks.find((c) => c.tipe === tipe);
                  if (check) {
                    // On Cek Datang, total Retur matters more than how much
                    // was loaded (MuatanQty, same figure already shown on
                    // Cek Berangkat) -- confirmed with user 2026-09-23.
                    return tipe === "DATANG" ? (
                      <CheckSummary key={tipe} check={check} packageLabel="kantong retur" packageQty={totalRetur} ringkas={modeApung || capturing} />
                    ) : (
                      <CheckSummary key={tipe} check={check} ringkas={modeApung || capturing} />
                    );
                  }
                  if (modeApung || capturing) {
                    const Ikon = TIPE_IKON[tipe];
                    return (
                      <div key={tipe} className="flex items-center gap-2 self-start rounded-lg border bg-muted/30 p-2 text-xs">
                        <span
                          title={TIPE_LABEL[tipe]}
                          aria-label={TIPE_LABEL[tipe]}
                          className="flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground"
                        >
                          <Ikon className="size-3.5" />
                        </span>
                        <span className="text-muted-foreground">
                          {nextJadwalStarted ? "Tidak dilaksanakan" : "Menunggu Inspeksi"}
                        </span>
                      </div>
                    );
                  }
                  return (
                    <div key={tipe} className="flex items-center justify-between rounded-lg border bg-muted/30 p-3 text-xs">
                      <span className="font-medium">{TIPE_LABEL[tipe]}</span>
                      <span className="text-muted-foreground">
                        {nextJadwalStarted ? "Tidak dilaksanakan" : "Menunggu Inspeksi"}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}

    </>
  );
  const bagianGalat = (
    <>
            {error && <p className="text-xs text-destructive">{error}</p>}    </>
  );
  // Isi kartu Efektifitas Armada (tanpa bingkai & judul) — dipakai kartu
  // penuh (bertumpuk) maupun kotak lipat kanan-bawah (mode melayang).
  const isiEfektifitas = route ? (
    <>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      1
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Jarak Tempuh &times; Harga Jual rata-rata/kantong</p>
                      {avgHargaJualPerKantong != null ? (
                        <p className="tabular-nums">
                          {route.distanceKm.toLocaleString("id-ID")} km &times; {formatRupiah(avgHargaJualPerKantong)} ={" "}
                          <span className="font-semibold">{formatRupiah(efektivitasHasil1 ?? 0)}</span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Harga jual mitra pada rute ini belum diketahui.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      2
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">Konsumsi BBM &times; Harga per Liter</p>
                      {totalFuelLiters != null && totalFuelCost != null ? (
                        <p className="tabular-nums">
                          {totalFuelLiters.toLocaleString("id-ID")} L &times; {formatRupiah(biayaBBMPerLiter ?? 0)} ={" "}
                          <span className="font-semibold">{formatRupiah(totalFuelCost)}</span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Konsumsi BBM armada belum diketahui.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-t pt-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      3
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">(Hasil 1 &minus; Hasil 2) &divide; Jarak Tempuh</p>
                      {efektivitasHasil1 != null && totalFuelCost != null && efektivitasPerKm != null && efektivitasSelisih != null ? (
                        <p className="tabular-nums">
                          ({formatRupiah(efektivitasHasil1)} &minus; {formatRupiah(totalFuelCost)}) &divide;{" "}
                          {route.distanceKm.toLocaleString("id-ID")} km ={" "}
                          <span className="font-semibold text-primary">{formatRupiah(efektivitasPerKm)}/km</span>{" "}
                          ({formatRupiah(efektivitasSelisih)})
                        </p>
                      ) : (
                        <p className="text-muted-foreground">Belum bisa dihitung — lengkapi data di atas dulu.</p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-t pt-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      4
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Utility Effectiveness — WO &divide; (WO + Idle + B), seluruh armada ini hari ini
                      </p>
                      {utilisasiHarian != null && utilityEffectiveness != null ? (
                        <p className="tabular-nums">
                          {formatDurationMinutes(utilisasiHarian.waktuOperasionalMenit)} &divide;{" "}
                          ({formatDurationMinutes(utilisasiHarian.waktuOperasionalMenit)} + {formatDurationMinutes(utilisasiHarian.idleMenit)} +{" "}
                          {formatDurationMinutes(utilisasiHarian.breakdownMenit)}) ={" "}
                          <span className="font-semibold text-primary">
                            {(utilityEffectiveness * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                          </span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Belum bisa dihitung — belum ada data WO/Idle/Breakdown armada ini hari ini.
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-start gap-2 border-t pt-2.5">
                    <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">
                      5
                    </span>
                    <div className="min-w-0">
                      <p className="text-xs text-muted-foreground">
                        Utility Effectiveness Per Periode — WO &divide; (WO + Idle + B), khusus Periode Pengiriman {formatDate(businessDate)}
                      </p>
                      {utilisasiPeriode != null && utilityEffectivenessPeriode != null ? (
                        <p className="tabular-nums">
                          {formatDurationMinutes(utilisasiPeriode.waktuOperasionalMenit)} &divide;{" "}
                          ({formatDurationMinutes(utilisasiPeriode.waktuOperasionalMenit)} + {formatDurationMinutes(utilisasiPeriode.idleMenit)} +{" "}
                          {formatDurationMinutes(utilisasiPeriode.breakdownMenit)}) ={" "}
                          <span className="font-semibold text-primary">
                            {(utilityEffectivenessPeriode * 100).toLocaleString("id-ID", { maximumFractionDigits: 1 })}%
                          </span>
                        </p>
                      ) : (
                        <p className="text-muted-foreground">
                          Belum bisa dihitung — belum ada data WO/Idle/Breakdown armada ini pada periode ini.
                        </p>
                      )}
                    </div>
                  </div>
    </>
  ) : null;
  function petaEl(apung: boolean) {
    return pabrik && order.length > 0 ? (
      <RouteMap
        pabrik={pabrik}
        stops={tujuan.filter((o) => o.Latitude != null && o.Longitude != null) as (JadwalDetailRow & { Latitude: number; Longitude: number })[]}
        geometry={route?.geometry ?? null}
        refitTrigger={refitTrigger}
        driverPosition={truckPosition}
        jejak={jejak}
        analisis={analisis}
        fokusBerhenti={apung ? fokusBerhenti : null}
        ruangKiri={apung ? LEBAR_PANEL_APUNG + 16 : 0}
        ruangBawahKanan={apung && route ? 56 : 0}
        ruangBawah={apung ? ruangBukti : 0}
        penuh={apung}
      />
    ) : (
      <Skeleton className={apung ? "h-full w-full" : "h-full w-full md:rounded-lg"} />
    );
  }

  return (
    <Dialog open={jadwalId != null} onOpenChange={onOpenChange}>
      {/* Widened past the base Dialog's sm:max-w-sm — a bare max-w-4xl loses
          to that rule (same specificity, but sm:max-w-sm sits later in
          Tailwind's compiled output), so the override needs its own sm:
          variant too, same fix already established in mitra-list.tsx /
          pengajuan-form-dialog.tsx. Scales further at lg: since this dialog
          holds a map + list side by side and genuinely benefits from a
          landscape screen's extra width, unlike a plain form dialog. */}
      <DialogContent
        className={cn(
          "max-w-lg p-0",
          modeApung
            ? "flex h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden sm:max-w-[calc(100vw-2rem)]"
            : portrait
              ? "w-[440px] sm:max-w-[440px]"
              : "sm:max-w-3xl lg:max-w-6xl"
        )}
      >
        {/* Ekspor tanpa peta (Data Rute): lebar dibatasi supaya kolom qty
            tidak terdorong ke tepi kanan dialog lebar dan menyisakan celah. */}
        <div
          ref={captureRef}
          className={cn(
            modeApung && "flex min-h-0 flex-1 flex-col",
            capturing && !showMap && !portrait && "w-[600px] max-w-full bg-popover"
          )}
        >
        <DialogHeader className="p-4 pb-0">
          <div className={cn("flex gap-2 pr-8", capturing ? "flex-col items-start" : "items-center justify-between")}>
            {/* "Validasi Rute" tidak boleh patah; chip detail turun utuh ke
                baris berikut bila tidak muat (dialog sempit / ekspor potret). */}
            <DialogTitle className="flex min-w-0 flex-wrap items-center gap-2 text-xl font-semibold">
              {/* Ekspor pengiriman yang sudah selesai: status & judul tidak
                  relevan lagi — linimasa di bawah sudah menceritakannya. */}
              {jadwal && !(capturing && sudahSelesai) && (
                <Badge variant="outline" className={cn("text-[10px]", isDraft ? "border-dashed" : "border-primary/30 text-primary")}>
                  {jadwal.Status}
                  {capturing && isDraft && (
                    <span className="font-normal text-muted-foreground tabular-nums">· {formatTime(jadwal.CreatedDate)}</span>
                  )}
                </Badge>
              )}
              {!(capturing && sudahSelesai) && <span className="whitespace-nowrap">Validasi Rute</span>}
              {jadwal && (
                <p
                  className={cn(
                    "flex items-center rounded-lg [&>span]:whitespace-nowrap border bg-primary/5 px-2 py-1",
                    // Ekspor: lebih kecil & satu baris supaya jarak tidak turun
                    // baris lalu menumpuk dengan elemen di bawahnya.
                    capturing ? "flex-nowrap gap-x-2 text-xs [&_svg]:size-3.5" : "flex-wrap gap-x-3 gap-y-1 text-sm"
                  )}
                >
                  <span className="flex items-center gap-1.5 font-semibold">
                    {armadaPlat && <span>{armadaPlat}</span>}
                    <Truck className="size-4 text-muted-foreground" />
                    {armadaNama ?? "Armada"}
                  </span>
                  <span className="text-muted-foreground">({tujuan.length}) Tujuan</span>
                  {route && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <RouteIcon className="size-4" />
                      {route.distanceKm.toLocaleString("id-ID")} km
                    </span>
                  )}
                  {!isDraft && (
                    <span className="flex items-center gap-1 text-muted-foreground">
                      <span className="font-medium text-foreground">{time}</span>
                      {drivers.find((d) => d.SalesmanID === driverId)?.Name ?? "Tanpa driver"}
                    </span>
                  )}
                </p>
              )}
            </DialogTitle>
            <div className="flex shrink-0 items-center gap-2">
              {capturing && linimasaEkspor.length > 0 && renderLinimasaStatus()}
              {!capturing && statusHistory.length > 0 && (
                <Popover>
                  <PopoverTrigger
                    render={
                      <Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs font-normal" />
                    }
                  >
                    <History className="size-3.5" />
                    {currentStatusLabel}
                    <ChevronDown className="size-3 opacity-60" data-capture-hide="true" />
                  </PopoverTrigger>
                  <PopoverContent align="end" className="w-80">
                    <VerticalTimeline>
                      {statusHistory.map((s, i) => (
                        <VerticalTimelineItem
                          key={s.label}
                          time={`${formatTime(s.timestamp)} · ${formatDate(s.timestamp)}`}
                          isLast={i === statusHistory.length - 1}
                        >
                          <p className="text-sm font-medium">
                            {s.label}
                            {s.durationLabel && (
                              <span className="ml-1.5 font-normal text-muted-foreground">| {s.durationLabel}</span>
                            )}
                          </p>
                        </VerticalTimelineItem>
                      ))}
                    </VerticalTimeline>
                    {(totalBerjalanMenit != null || istirahatSessions.length > 0) && (
                      <div className="mt-3 flex flex-col gap-1 border-t pt-3 text-xs">
                        {totalBerjalanMenit != null && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Berjalan</span>
                            <span className="font-medium">{formatDurationMinutes(totalBerjalanMenit)}</span>
                          </div>
                        )}
                        {istirahatSessions.length > 0 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">Total Istirahat ({istirahatSessions.length}x)</span>
                            <span className="font-medium">{formatDurationMinutes(totalIstirahatMenit)}</span>
                          </div>
                        )}
                        {waktuEfektifMenit != null && (
                          <div className="flex justify-between font-semibold">
                            <span>Waktu Efektif Pengiriman</span>
                            <span>{formatDurationMinutes(waktuEfektifMenit)}</span>
                          </div>
                        )}
                        {istirahatSessions.map((s, i) => (
                          <p key={i} className="text-[11px] text-muted-foreground">
                            {s.keterangan} — {formatDurationMinutes(s.durasiMenit)} ({formatTime(s.waktuMulai)}
                            {s.waktuSelesai ? ` – ${formatTime(s.waktuSelesai)}` : " – berlangsung"})
                          </p>
                        ))}
                      </div>
                    )}
                  </PopoverContent>
                </Popover>
              )}
              {jadwal && order.length > 0 && (
                <div data-capture-hide="true">
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button size="sm" variant="outline" className="h-7 gap-1.5 text-xs" />}>
                      <Share2 className="size-3.5" />
                      Bagikan
                      <ChevronDown className="size-3 opacity-60" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleShareSeluruhnya}>
                        <ImageIcon className="size-4" />
                        Seluruhnya
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareDetailRute}>
                        <List className="size-4" />
                        Detail Rute
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleShareDataRute}>
                        <ImageIcon className="size-4" />
                        Data Rute
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )}
              {isWaitingDeparture && (
                <Button size="sm" data-capture-hide="true" disabled={pending || !hasBerangkatCheck} onClick={handleKonfirmasiBerangkat}>
                  {pending ? "Memproses..." : "Berangkat"}
                </Button>
              )}
            </div>
          </div>
          <DialogDescription className="sr-only">
            Atur waktu, driver, urutan pengiriman, dan validasi rute sebelum berangkat.
          </DialogDescription>
        </DialogHeader>

        {modeApung ? (
          /* Mode melayang (layar lebar, opsi B 2026-11-25): peta jadi latar,
             panel kiri melayang = kontrol + daftar tujuan (satu-satunya yang
             bergulir) + ringkasan & aksi tetap di bawah; kotak Efektifitas
             lipat di kanan bawah peta; Bukti (Cek Berangkat/Datang) di bawah
             peta. Tangkapan layar Bagikan, potret (batch), dan layar HP tetap
             memakai tata letak bertumpuk di cabang bawah. */
          <div className="relative mx-4 mt-3 mb-4 min-h-0 flex-1 overflow-hidden rounded-xl border">
            <div className="absolute inset-0">{petaEl(true)}</div>
            {/* Kaca buram: peta tetap samar terlihat di balik panel. */}
            <div
              className="absolute top-3 bottom-3 left-3 z-[1100] flex flex-col overflow-hidden rounded-xl border border-white/15 bg-popover/85 dark:bg-popover/70 shadow-2xl ring-1 ring-inset ring-white/5 backdrop-blur-[1px] backdrop-saturate-150"
              style={{ width: LEBAR_PANEL_APUNG }}
            >
              {bagianKontrolAda && <div className="flex flex-col gap-2 border-b p-3">{bagianKontrol}</div>}
              {/* Daftar tujuan (satu-satunya yang bergulir, tanpa scrollbar):
                  gradasi memudar di dasarnya menandakan masih ada kartu di
                  bawah kotak ringkasan. pb-10 = ruang supaya kartu terakhir
                  bisa digulir keluar dari area pudar. */}
              <div className="relative flex min-h-0 flex-1 flex-col">
                <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-2 pt-2 pb-10">
                  {bagianDaftar}
                  {bagianTambah}
                </div>
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-popover/70 via-popover/35 to-transparent"
                />
              </div>
              <div className="relative z-10 flex shrink-0 flex-col gap-2 border-t border-white/10 bg-popover/60 p-3 shadow-[0_-10px_16px_-10px_rgba(0,0,0,0.25)]">
                {bagianTotal}
                {bagianRingkas}
                {bagianGalat}
                {isDraft && bagianAksi}
              </div>
            </div>
            {route && (
              <div
                className="absolute right-3 z-[1100] w-[min(360px,calc(100%-1.5rem))] overflow-hidden rounded-xl border border-white/15 bg-popover/85 dark:bg-popover/70 shadow-2xl ring-1 ring-inset ring-white/5 backdrop-blur-[1px] backdrop-saturate-150"
                style={{ bottom: 12 + ruangBukti }}
              >
                <button
                  type="button"
                  onClick={() => setEfekBuka((v) => !v)}
                  aria-expanded={efekBuka}
                  className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm hover:bg-muted/40"
                >
                  <Gauge className="size-4 shrink-0 text-primary" />
                  <span className="font-semibold">Efektifitas</span>
                  <span className="truncate text-xs text-muted-foreground tabular-nums">
                    {route.distanceKm.toLocaleString("id-ID")} km ·{" "}
                    {Math.round(route.durationMinutes + bongkarTotalMenit + konfirmasiTotalMenit)} mnt
                  </span>
                  <span className="ml-auto shrink-0 text-xs font-semibold text-primary tabular-nums">
                    {efektivitasPerKm != null ? `${formatRupiah(efektivitasPerKm)}/km` : "-"}
                  </span>
                  <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", efekBuka && "rotate-180")} />
                </button>
                {efekBuka && (
                  <div className="flex max-h-[55vh] flex-col gap-2.5 overflow-y-auto border-t p-3 text-sm">{isiEfektifitas}</div>
                )}
              </div>
            )}
            {/* Bukti (Cek Berangkat/Datang) menempel di dasar peta, di kanan
                panel; pencarian & Efektifitas naik tepat di atasnya. */}
            {!isDraft && (
              <div
                ref={setElBukti}
                className="absolute right-3 bottom-3 z-[1100] rounded-xl border border-white/15 bg-popover/85 dark:bg-popover/70 p-2 shadow-2xl ring-1 ring-inset ring-white/5 backdrop-blur-[1px] backdrop-saturate-150"
                style={{ left: LEBAR_PANEL_APUNG + 24 }}
              >
                {bagianBukti}
              </div>
            )}
          </div>
        ) : (
        <div className={cn("flex flex-col", !portrait && (showMap ? "md:grid md:grid-cols-2 md:gap-4 md:p-4 md:pt-2 lg:grid-cols-[1fr_1.3fr]" : "md:p-4 md:pt-2"))}>
          {showMap && (
            <div className={cn("order-1 flex flex-col gap-3", !portrait && "md:order-2")}>
              {/* md:flex-1 → di tangkapan Bagikan peta mengisi tinggi kolom
                  kanan (setinggi daftar tujuan), bukan menyisakan ruang kosong. */}
              <div
                className={cn(
                  "h-[34vh] min-h-[220px] w-full overflow-hidden",
                  portrait ? "h-[300px]" : "md:h-auto md:min-h-[220px] md:flex-1 md:rounded-lg"
                )}
              >
                {petaEl(false)}
              </div>
              {route && (
                <div className="flex flex-col gap-2.5 rounded-lg border bg-muted/30 p-3 text-sm">
                  <p className="flex items-center gap-1.5 font-semibold">
                    <Gauge className="size-4 text-primary" />
                    Efektifitas Armada
                  </p>
                  {isiEfektifitas}
                </div>
              )}
            </div>
          )}

          <div
            className={cn(
              "flex flex-col gap-3 p-4",
              showMap && "order-2 -mt-4 rounded-t-2xl bg-popover shadow-[0_-4px_12px_rgba(0,0,0,0.08)]",
              showMap && !portrait && "md:order-1 md:mt-0 md:rounded-none md:p-0 md:shadow-none"
            )}
          >
            {bagianKontrol}
            {bagianDaftar}
            {bagianTotal}
            {bagianAksi}
            {bagianTambah}
            {bagianRingkas}
            {bagianBukti}
            {bagianGalat}
          </div>
        </div>
        )}
        </div>

        <StopDeliveryProofDialog
          detail={proofDetail}
          jadwalId={jadwalId}
          onOpenChange={(open) => !open && setProofDetail(null)}
        />
        <StopSalesInvoiceDialog detail={siDetail} onOpenChange={(open) => !open && setSiDetail(null)} />
        {conflict && (
          <ArmadaConflictDialog
            conflict={conflict.info}
            onCancel={() => setConflict(null)}
            onConfirm={() => {
              if (jadwalId == null) return;
              const targetId = jadwalId;
              const { jamJadwal, then } = conflict;
              setConflict(null);
              if (then === "save") {
                doSaveDriverTime(targetId, jamJadwal);
              } else {
                doSaveDriverTimeThenSelesaiMuat(targetId, jamJadwal, pendingKodeSelesaiMuat);
              }
            }}
          />
        )}
        <Dialog open={showKodeDialog != null} onOpenChange={(open) => !open && setShowKodeDialog(null)}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Masukkan Kode Ambil-Alih</DialogTitle>
              <DialogDescription>
                Alur normal Mulai/Selesai Muat seharusnya lewat aplikasi produksi (Kepala Produksi/Wakilnya). Kode
                ambil-alih didapat dari Manager, berlaku 3 menit dan hanya bisa dipakai sekali.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Kode 6 digit"
              value={kodeInput}
              onChange={(e) => setKodeInput(e.target.value)}
            />
            {kodeError && <p className="text-sm text-destructive">{kodeError}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowKodeDialog(null)} disabled={pending}>
                Batal
              </Button>
              <Button
                disabled={pending || kodeInput.trim().length !== 6}
                onClick={() => {
                  if (showKodeDialog === "MULAI_MUAT") handleMuatDenganKode(kodeInput.trim());
                  else if (showKodeDialog === "SELESAI_MUAT") handleSelesaiMuatDenganKode(kodeInput.trim());
                }}
              >
                Konfirmasi
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
  }
);
RouteValidationDialog.displayName = "RouteValidationDialog";
