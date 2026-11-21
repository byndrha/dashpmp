"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ChevronsUpDown, Building2, ExternalLink, MapPin } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PT_ROUTES } from "@/lib/pt-routes";
import { cn } from "@/lib/utils";
import type { PerusahaanSwitcherEntry } from "@/lib/queries/perusahaan";

export type PtSwitcherLocation = "mkesindo" | "pmputra" | "pmpersada" | "pmpakis" | "grup";

// Hanya dirender untuk akun berwenang lintas PT (superadmin / Direktur) —
// akun lain dikurung di rute PT-nya sendiri (requirePmputra()/
// (dashboard)/layout.tsx/requireGrupAccess()).
//
// Isi dropdown: PMP Group (Holding) paling atas, lalu PT dikelompokkan per
// lokasi (DashboardPerusahaan.Wilayah) — Ponorogo selalu pertama, lokasi
// lain urut abjad, PT tanpa lokasi paling bawah. "AktifPenuh" membuka rute
// PT-nya (PT_ROUTES); "StandaloneHTML" membuka StandaloneUrl di tab baru.
// "Draft" tidak pernah ada di `list` (disaring listPerusahaanForSwitcher).
const LOKASI_UTAMA = "Ponorogo";
const TANPA_LOKASI = "Lokasi belum diisi";

function kelompokkanPerLokasi(list: PerusahaanSwitcherEntry[]): { lokasi: string; items: PerusahaanSwitcherEntry[] }[] {
  const peta = new Map<string, PerusahaanSwitcherEntry[]>();
  for (const p of list) {
    const lokasi = p.Wilayah ?? TANPA_LOKASI;
    peta.set(lokasi, [...(peta.get(lokasi) ?? []), p]);
  }
  const bobot = (l: string) => (l === LOKASI_UTAMA ? 0 : l === TANPA_LOKASI ? 2 : 1);
  return [...peta.entries()]
    .sort(([a], [b]) => bobot(a) - bobot(b) || a.localeCompare(b, "id"))
    .map(([lokasi, items]) => ({
      lokasi,
      // Aktif Penuh dulu, laporan terpisah (StandaloneHTML) di belakang.
      items: items.sort((a, b) => Number(a.Status !== "AktifPenuh") - Number(b.Status !== "AktifPenuh") || a.Nama.localeCompare(b.Nama, "id")),
    }));
}

// Kotak inisial kecil sebagai penanda visual tiap PT ("MK", "PM", ...).
function Inisial({ nama, aktif }: { nama: string; aktif: boolean }) {
  const huruf = nama
    .replace(/^PT\.?\s+/i, "")
    .split(/\s+/)
    .slice(0, 2)
    .map((k) => k[0])
    .join("")
    .toUpperCase();
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-md border text-[10px] font-bold",
        aktif ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
      )}
    >
      {huruf}
    </span>
  );
}

// `children` (opsional) menggantikan isi tombol bawaan — dipakai blok merek
// di kepala sidebar (MerekSidebar), supaya nama PT tidak tampil dua kali.
export function PTSwitcher({
  list,
  current,
  children,
}: {
  list: PerusahaanSwitcherEntry[];
  current: PtSwitcherLocation;
  children?: ReactNode;
}) {
  const router = useRouter();
  const aktif = list.filter((p) => p.Status === "AktifPenuh");
  const active = aktif.find((p) => p.Kode === current);
  const kelompok = kelompokkanPerLokasi(list);

  function pilih(entity: PerusahaanSwitcherEntry) {
    if (entity.Status === "StandaloneHTML") {
      if (entity.StandaloneUrl) window.open(entity.StandaloneUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const href = entity.Kode ? PT_ROUTES[entity.Kode] : undefined;
    if (href) router.push(href);
  }

  return (
    <DropdownMenu>
      {children ? (
        <DropdownMenuTrigger
          className="flex w-full items-center gap-2 rounded-lg p-1.5 text-left outline-hidden hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-sidebar-ring data-popup-open:bg-sidebar-accent group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:p-0"
          aria-label="Pilih perusahaan"
        >
          {children}
          <ChevronsUpDown className="size-3.5 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </DropdownMenuTrigger>
      ) : (
        <DropdownMenuTrigger className="flex w-full items-center gap-2 rounded-md border border-sidebar-border bg-sidebar-accent/40 px-2 py-1.5 text-left text-xs hover:bg-sidebar-accent group-data-[collapsible=icon]:justify-center">
          <Building2 className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1 truncate font-medium group-data-[collapsible=icon]:hidden">
            {current === "grup" ? "PMP Group" : (active?.Nama ?? "Pilih PT")}
          </span>
          <ChevronsUpDown className="size-3 shrink-0 text-muted-foreground group-data-[collapsible=icon]:hidden" />
        </DropdownMenuTrigger>
      )}
      <DropdownMenuContent align="start" sideOffset={6} className="min-w-52 p-1.5">
        <DropdownMenuItem
          onClick={() => router.push("/grup")}
          className={cn("gap-2.5 px-2 py-1.5", current === "grup" && "bg-primary/5")}
          aria-current={current === "grup" ? "true" : undefined}
        >
          <span
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-md border",
              current === "grup" ? "border-primary/30 bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
            )}
          >
            <Building2 className="size-3.5" />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-xs font-medium">PMP Group</span>
            <span className="text-[11px] text-muted-foreground">Holding</span>
          </span>
        </DropdownMenuItem>

        {kelompok.map((g) => (
          <DropdownMenuGroup key={g.lokasi}>
            <DropdownMenuSeparator className="my-1.5" />
            <DropdownMenuLabel className="flex items-center gap-1 px-2 pb-1 pt-0.5 text-[10px] font-semibold uppercase tracking-wider">
              <MapPin className="size-3" />
              {g.lokasi}
            </DropdownMenuLabel>
            {g.items.map((entity) => {
              const terpilih = entity.Status === "AktifPenuh" && entity.Kode === current;
              return (
                // PT aktif ditandai latar sorot + inisial berwarna (tanpa
                // centang, supaya nama PT muat di dropdown selebar sidebar).
                <DropdownMenuItem
                  key={entity.PerusahaanID}
                  onClick={() => pilih(entity)}
                  className={cn("gap-2.5 px-2 py-1.5", terpilih && "bg-primary/5")}
                  aria-current={terpilih ? "true" : undefined}
                >
                  <Inisial nama={entity.Nama} aktif={terpilih} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className={cn("truncate text-xs", terpilih && "font-medium")} title={entity.Nama}>{entity.Nama}</span>
                    {entity.JenisBisnis && <span className="text-[11px] text-muted-foreground">{entity.JenisBisnis}</span>}
                  </span>
                  {entity.Status === "StandaloneHTML" && <ExternalLink className="size-3.5 text-muted-foreground" />}
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
