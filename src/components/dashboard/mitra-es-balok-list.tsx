"use client";

import dynamic from "next/dynamic";
import { useMemo, useState } from "react";
import { Plus, Phone, Ban, MoreVertical, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Pagination } from "@/components/dashboard/pagination";
import { formatRupiah } from "@/lib/format";
import type { MitraCard, SumberAgen } from "@/lib/queries/mitra-es-balok";

const AgenLocationsMap = dynamic(
  () => import("@/components/dashboard/agen-locations-map").then((m) => m.AgenLocationsMap),
  { ssr: false, loading: () => <Skeleton className="h-[320px] w-full rounded-lg" /> }
);

const PAGE_SIZE = 12;

function sumberLabel(sumber: SumberAgen, kode: string): string | null {
  if (kode === "pmputra") return null; // always merged, no badge needed
  if (sumber === "logistik") return "Logistik (Bersama)";
  return "Utama";
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
  const [page, setPage] = useState(1);

  // Derived from already-fetched cards rather than a separate query -- this
  // filter only needs the DISTINCT Wilayah values actually present in the
  // current list, not the full PMP_Wilayah master list (that's what
  // getWilayahOptions/Task 11's form Select is for).
  const wilayahOptionsFromCards = useMemo(() => {
    const set = new Set(cards.map((c) => c.wilayah).filter((w): w is string => !!w));
    return Array.from(set).sort();
  }, [cards]);

  const mapPoints = useMemo(
    () =>
      cards
        .filter((c): c is MitraCard & { latitude: number; longitude: number } => c.latitude != null && c.longitude != null)
        .map((c) => ({ agenId: c.agenId, nama: c.nama, wilayah: c.wilayah, latitude: c.latitude, longitude: c.longitude })),
    [cards]
  );

  const filtered = useMemo(() => {
    return cards.filter((c) => {
      if (search && !c.nama.toLowerCase().includes(search.toLowerCase())) return false;
      if (sumberFilter !== "all" && c.sumber !== sumberFilter) return false;
      if (statusFilter === "aktif" && !c.isActive) return false;
      if (statusFilter === "nonaktif" && c.isActive) return false;
      if (wilayahFilter !== "all" && c.wilayah !== wilayahFilter) return false;
      return true;
    });
  }, [cards, search, sumberFilter, statusFilter, wilayahFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const showSumberFilter = kode !== "pmputra";

  return (
    <div className="flex flex-col gap-4">
      {mapPoints.length > 0 && <AgenLocationsMap points={mapPoints} />}

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
              <SelectValue placeholder="Sumber" />
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
            <SelectValue placeholder="Status" />
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
            <SelectValue placeholder="Wilayah" />
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
        <Button onClick={onAddNew} className="ml-auto">
          <Plus className="size-4" />
          Tambah Mitra
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {visible.map((c) => (
          <Card key={`${c.sumber}-${c.agenId}`} className="cursor-pointer transition-colors hover:bg-accent/50" onClick={() => onSelect(c)}>
            <CardContent className="flex flex-col gap-1.5 p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium leading-tight">{c.nama}</p>
                <div className="flex shrink-0 items-center gap-1">
                  {!c.isActive && (
                    <Badge variant="destructive">
                      <Ban className="size-3" />
                      Nonaktif
                    </Badge>
                  )}
                  <DropdownMenu>
                    <DropdownMenuTrigger
                      render={<Button variant="ghost" size="icon" className="size-7" onClick={(e) => e.stopPropagation()} />}
                    >
                      <MoreVertical className="size-4" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenuItem onClick={() => onEdit(c)}>
                        <Pencil className="size-3.5" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => onSuspendToggle(c)}>
                        {c.isActive ? <Ban className="size-3.5" /> : <RotateCcw className="size-3.5" />}
                        {c.isActive ? "Nonaktifkan" : "Aktifkan"}
                      </DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => onDelete(c)}>
                        <Trash2 className="size-3.5" />
                        Hapus
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {sumberLabel(c.sumber, kode) && <Badge variant="secondary">{sumberLabel(c.sumber, kode)}</Badge>}
              {c.telepon && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Phone className="size-3" />
                  {c.telepon}
                </p>
              )}
              {c.wilayah && <p className="text-xs text-muted-foreground">{c.wilayah}</p>}
              <div className="mt-1 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  {formatRupiah(c.hargaBalokKecil)} / {formatRupiah(c.hargaBalokBesar)}
                </span>
                {c.maksimumHutang > 0 && <span className="text-muted-foreground">Maks. {formatRupiah(c.maksimumHutang)}</span>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {visible.length === 0 && <p className="py-8 text-center text-sm text-muted-foreground">Tidak ada Mitra yang cocok.</p>}

      <Pagination page={page} pageCount={pageCount} onChange={setPage} />
    </div>
  );
}
