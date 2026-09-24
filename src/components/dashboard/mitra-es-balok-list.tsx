"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Phone, MapPin, Package, Ban, MoreVertical, Pencil, RotateCcw, Trash2, LayoutGrid, List } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/dashboard/pagination";
import { formatRupiah } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MitraCard, SumberAgen } from "@/lib/queries/mitra-es-balok";
import { SEGMENTASI_OPTIONS, type Segmentasi } from "@/lib/segmentasi-mitra";

const PAGE_SIZE = 12;

// Per-browser only (not synced anywhere), same pattern as MKEsindo's own
// mitra-list.tsx VIEW_MODE_STORAGE_KEY.
const VIEW_MODE_STORAGE_KEY = "mitra-es-balok-view-mode";
type ViewMode = "grid" | "baris";

const PIN_OPTIONS = [
  { value: "all", label: "Pin" },
  { value: "yes", label: "Sudah Pin" },
  { value: "no", label: "Belum Pin" },
] as const;

// Bucketed on (kapasitasBalokKecil + kapasitasBalokBesar) -- for PMPakis
// BalokBesar is always null, so this reduces to Kapasitas Kecil alone with
// no special-casing needed.
const CAPACITY_BUCKETS = [
  { value: "all", label: "Kapasitas" },
  { value: "unset", label: "Belum Diisi" },
  { value: "0-50", label: "1 - 50 /hari" },
  { value: "50-100", label: "51 - 100 /hari" },
  { value: "100-250", label: "101 - 250 /hari" },
  { value: "250-500", label: "251 - 500 /hari" },
  { value: "500-999999", label: "> 500 /hari" },
] as const;

function matchesCapacityBucket(totalCapacity: number | null, bucket: string): boolean {
  if (bucket === "all") return true;
  if (bucket === "unset") return totalCapacity == null;
  if (totalCapacity == null) return false;
  const [min, max] = bucket.split("-").map(Number);
  return totalCapacity > min && totalCapacity <= max;
}

function sumberLabel(sumber: SumberAgen, kode: string): string | null {
  if (kode === "pmputra") return null; // always merged, no badge needed
  if (sumber === "logistik") return "Logistik (Bersama)";
  return "Utama";
}

function segmentasiLabel(value: MitraCard["segmentasi"]): string | null {
  if (!value) return null;
  return SEGMENTASI_OPTIONS.find((s) => s.value === value)?.label ?? null;
}

function formatKapasitas(value: number | null): string {
  return value != null ? `${value.toLocaleString("id-ID")} /hari` : "Belum diisi";
}

export function MitraEsBalokList({
  kode,
  cards,
  onSelect,
  onAddNew,
  onEdit,
  onSuspendToggle,
  onDelete,
}: {
  kode: string;
  cards: MitraCard[];
  onSelect: (card: MitraCard) => void;
  onAddNew: () => void;
  onEdit: (card: MitraCard) => void;
  onSuspendToggle: (card: MitraCard) => void;
  onDelete: (card: MitraCard) => void;
}) {
  const [search, setSearch] = useState("");
  const [sumberFilter, setSumberFilter] = useState<"all" | SumberAgen>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "aktif" | "nonaktif">("all");
  const [wilayahFilter, setWilayahFilter] = useState("all");
  const [segmentasiFilter, setSegmentasiFilter] = useState<"all" | Segmentasi>("all");
  const [kapasitasFilter, setKapasitasFilter] = useState("all");
  const [pinFilter, setPinFilter] = useState<"all" | "yes" | "no">("all");
  const [page, setPage] = useState(1);
  // Starts "grid" for SSR/first render (avoids hydration mismatch), then
  // reads the stored per-viewer preference once on mount -- same reasoning
  // as MKEsindo's mitra-list.tsx.
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  useEffect(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_STORAGE_KEY);
      // Reads a per-viewer preference once on mount, not derivable from render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "grid" || stored === "baris") setViewMode(stored);
    } catch {
      // Private-window/blocked storage -- stay on the SSR default.
    }
  }, []);
  function setViewModePersisted(mode: ViewMode) {
    setViewMode(mode);
    try {
      localStorage.setItem(VIEW_MODE_STORAGE_KEY, mode);
    } catch {
      // Ignore -- per-viewer convenience only, never required to work.
    }
  }

  // Derived from already-fetched cards rather than a separate query -- this
  // filter only needs the DISTINCT Wilayah values actually present in the
  // current list, not the full PMP_Wilayah master list (that's what
  // getWilayahOptions/the form Select is for).
  const wilayahOptionsFromCards = useMemo(() => {
    const set = new Set(cards.map((c) => c.wilayah).filter((w): w is string => !!w));
    return Array.from(set).sort();
  }, [cards]);

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (search && !c.nama.toLowerCase().includes(search.toLowerCase())) return false;
      if (sumberFilter !== "all" && c.sumber !== sumberFilter) return false;
      if (statusFilter === "aktif" && !c.isActive) return false;
      if (statusFilter === "nonaktif" && c.isActive) return false;
      if (wilayahFilter !== "all" && c.wilayah !== wilayahFilter) return false;
      if (segmentasiFilter !== "all" && c.segmentasi !== segmentasiFilter) return false;
      const totalCapacity = c.kapasitasBalokKecil == null && c.kapasitasBalokBesar == null
        ? null
        : (c.kapasitasBalokKecil ?? 0) + (c.kapasitasBalokBesar ?? 0);
      if (!matchesCapacityBucket(totalCapacity, kapasitasFilter)) return false;
      const hasPin = c.latitude != null && c.longitude != null;
      if (pinFilter === "yes" && !hasPin) return false;
      if (pinFilter === "no" && hasPin) return false;
      return true;
    });
  }, [cards, search, sumberFilter, statusFilter, wilayahFilter, segmentasiFilter, kapasitasFilter, pinFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showSumberFilter = kode !== "pmputra";
  // PMPakis only sells Balok Kecil -- Balok Besar is never shown here.
  // User decision 2026-09-24.
  const isPmpakis = kode === "pmpakis";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
          placeholder="Cari nama Mitra..."
          className="max-w-64"
        />
        {showSumberFilter && (
          <Select
            value={sumberFilter}
            onValueChange={(v) => {
              setSumberFilter(v as "all" | SumberAgen);
              setPage(1);
            }}
          >
            <SelectTrigger className="w-40">
              <SelectValue>
                {() => (sumberFilter === "all" ? "Semua Sumber" : sumberFilter === "utama" ? "Utama" : "Logistik (Bersama)")}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Sumber</SelectItem>
              <SelectItem value="utama">Utama</SelectItem>
              <SelectItem value="logistik">Logistik (Bersama)</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select
          value={statusFilter}
          onValueChange={(v) => {
            setStatusFilter(v as "all" | "aktif" | "nonaktif");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue>
              {() => (statusFilter === "all" ? "Semua Status" : statusFilter === "aktif" ? "Aktif" : "Nonaktif")}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Status</SelectItem>
            <SelectItem value="aktif">Aktif</SelectItem>
            <SelectItem value="nonaktif">Nonaktif</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={wilayahFilter}
          onValueChange={(v) => {
            setWilayahFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{() => (wilayahFilter === "all" ? "Semua Wilayah" : wilayahFilter)}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Wilayah</SelectItem>
            {wilayahOptionsFromCards.map((w) => (
              <SelectItem key={w} value={w}>
                {w}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={segmentasiFilter}
          onValueChange={(v) => {
            setSegmentasiFilter(v as "all" | Segmentasi);
            setPage(1);
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue>
              {() => (segmentasiFilter === "all" ? "Segmentasi" : SEGMENTASI_OPTIONS.find((s) => s.value === segmentasiFilter)?.label)}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Segmentasi</SelectItem>
            {SEGMENTASI_OPTIONS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={kapasitasFilter}
          onValueChange={(v) => {
            setKapasitasFilter(v ?? "all");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue>{() => CAPACITY_BUCKETS.find((b) => b.value === kapasitasFilter)?.label ?? "Kapasitas"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {CAPACITY_BUCKETS.map((b) => (
              <SelectItem key={b.value} value={b.value}>
                {b.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select
          value={pinFilter}
          onValueChange={(v) => {
            setPinFilter(v as "all" | "yes" | "no");
            setPage(1);
          }}
        >
          <SelectTrigger className="w-28">
            <SelectValue>{() => PIN_OPTIONS.find((p) => p.value === pinFilter)?.label ?? "Pin"}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            {PIN_OPTIONS.map((p) => (
              <SelectItem key={p.value} value={p.value}>
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-md border p-0.5">
            <Button
              variant={viewMode === "grid" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              title="Tampilan grid"
              onClick={() => setViewModePersisted("grid")}
            >
              <LayoutGrid className="size-3.5" />
            </Button>
            <Button
              variant={viewMode === "baris" ? "secondary" : "ghost"}
              size="icon"
              className="size-7"
              title="Tampilan baris"
              onClick={() => setViewModePersisted("baris")}
            >
              <List className="size-3.5" />
            </Button>
          </div>
          <Button onClick={onAddNew}>
            <Plus className="size-4" />
            Tambah Mitra
          </Button>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        Menampilkan {visible.length} dari {filtered.length} Mitra.
      </p>

      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((c) => (
            <Card
              key={`${c.sumber}-${c.agenId}`}
              className={cn("cursor-pointer py-3.5 transition-colors hover:bg-accent/50", !c.isActive && "opacity-60")}
              onClick={() => onSelect(c)}
            >
              <CardContent className="flex flex-col gap-2 px-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{c.nama}</p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-1">
                      {sumberLabel(c.sumber, kode) && (
                        <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                          {sumberLabel(c.sumber, kode)}
                        </Badge>
                      )}
                      <Badge variant={c.segmentasi ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                        {segmentasiLabel(c.segmentasi) ?? "Belum Ditentukan"}
                      </Badge>
                      {!c.isActive && (
                        <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                          Nonaktif
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <MitraActionsMenu card={c} onEdit={onEdit} onSuspendToggle={onSuspendToggle} onDelete={onDelete} />
                  </div>
                </div>

                <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1.5">
                    <Phone className="size-3" /> {c.telepon || "-"}
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="size-3" /> {c.wilayah || "-"}
                  </span>
                  {c.alamat && <span className="truncate pl-[18px]">{c.alamat}</span>}
                </div>

                <div className="flex flex-col gap-1 border-t pt-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Balok Kecil: <span className="text-foreground">{formatRupiah(c.hargaBalokKecil)}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <Package className="size-3" />
                      {formatKapasitas(c.kapasitasBalokKecil)}
                    </span>
                  </div>
                  {!isPmpakis && (
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">
                        Balok Besar: <span className="text-foreground">{formatRupiah(c.hargaBalokBesar)}</span>
                      </span>
                      <span className="inline-flex items-center gap-1 text-muted-foreground">
                        <Package className="size-3" />
                        {formatKapasitas(c.kapasitasBalokBesar)}
                      </span>
                    </div>
                  )}
                  {c.maksimumHutang > 0 && <span className="text-muted-foreground">Maks. Hutang: {formatRupiah(c.maksimumHutang)}</span>}
                </div>
              </CardContent>
            </Card>
          ))}
          {visible.length === 0 && (
            <p className="col-span-full py-8 text-center text-sm text-muted-foreground">Tidak ada Mitra yang cocok.</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col divide-y rounded-lg border">
          {visible.map((c) => (
            <div
              key={`${c.sumber}-${c.agenId}`}
              className={cn(
                "flex cursor-pointer flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-sm hover:bg-accent/50",
                !c.isActive && "opacity-60"
              )}
              onClick={() => onSelect(c)}
            >
              <div className="min-w-40 flex-1">
                <p className="truncate font-medium">{c.nama}</p>
                <div className="mt-0.5 flex flex-wrap items-center gap-1">
                  {sumberLabel(c.sumber, kode) && (
                    <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                      {sumberLabel(c.sumber, kode)}
                    </Badge>
                  )}
                  <Badge variant={c.segmentasi ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                    {segmentasiLabel(c.segmentasi) ?? "Belum Ditentukan"}
                  </Badge>
                  {!c.isActive && (
                    <Badge variant="destructive" className="h-5 px-1.5 text-[10px]">
                      Nonaktif
                    </Badge>
                  )}
                </div>
              </div>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <Phone className="size-3" /> {c.telepon || "-"}
              </span>
              <span className="inline-flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                <MapPin className="size-3" /> {c.wilayah || "-"}
              </span>
              <span className="shrink-0 text-xs text-muted-foreground">
                Balok Kecil: <span className="text-foreground">{formatRupiah(c.hargaBalokKecil)}</span>
              </span>
              {!isPmpakis && (
                <span className="shrink-0 text-xs text-muted-foreground">
                  Balok Besar: <span className="text-foreground">{formatRupiah(c.hargaBalokBesar)}</span>
                </span>
              )}
              <div className="ml-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
                <MitraActionsMenu card={c} onEdit={onEdit} onSuspendToggle={onSuspendToggle} onDelete={onDelete} />
              </div>
            </div>
          ))}
          {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Mitra yang cocok.</p>}
        </div>
      )}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}

function MitraActionsMenu({
  card,
  onEdit,
  onSuspendToggle,
  onDelete,
}: {
  card: MitraCard;
  onEdit: (card: MitraCard) => void;
  onSuspendToggle: (card: MitraCard) => void;
  onDelete: (card: MitraCard) => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" className="size-7" onClick={(e) => e.stopPropagation()} />}>
        <MoreVertical className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onEdit(card)}>
          <Pencil className="size-3.5" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onSuspendToggle(card)}>
          {card.isActive ? <Ban className="size-3.5" /> : <RotateCcw className="size-3.5" />}
          {card.isActive ? "Nonaktifkan" : "Aktifkan"}
        </DropdownMenuItem>
        <DropdownMenuItem variant="destructive" onClick={() => onDelete(card)}>
          <Trash2 className="size-3.5" />
          Hapus
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
