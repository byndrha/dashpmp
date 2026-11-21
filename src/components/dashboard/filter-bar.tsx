"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Filter } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export function FilterBar({
  wilayahList,
  showDateRange = true,
  bare = false,
  hanyaTombol = false,
}: {
  wilayahList?: string[];
  showDateRange?: boolean;
  // true = tanpa bingkai kartu sendiri, untuk halaman yang sudah menaruh
  // filter ini di dalam toolbar berbingkai (mis. /mkesindo/pemesanan).
  bare?: boolean;
  // true = di SEMUA ukuran layar filter tampil sebagai satu tombol ikon yang
  // membuka dropdown (dipakai /mkesindo/pemesanan, di kanan Buat Pemesanan).
  hanyaTombol?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [wilayah, setWilayah] = useState(searchParams.get("wilayah") ?? "all");
  const [mobileOpen, setMobileOpen] = useState(false);

  // "Sampai" is an exclusive upper bound in every query this filter feeds
  // (TransDate >= @from AND TransDate < @to) — from === to always yields a
  // zero-row range, not a one-day range, so it's blocked outright rather
  // than silently returning an empty result the user would mistake for
  // "no data that day".
  const sameDate = !!from && !!to && from === to;

  function applyFilter() {
    if (sameDate) return;
    // Starts from the CURRENT params (not a blank slate) so a page that
    // also has its own independent filter controls alongside this shared
    // bar (e.g. /mkesindo/pemesanan's document-status dropdowns) doesn't
    // get them wiped out just because this bar's own "Terapkan" was
    // clicked — this bar only ever sets/clears the 3 keys it actually
    // manages below.
    const params = new URLSearchParams(searchParams.toString());
    if (from) params.set("from", from);
    else params.delete("from");
    if (to) params.set("to", to);
    else params.delete("to");
    if (wilayah !== "all") params.set("wilayah", wilayah);
    else params.delete("wilayah");
    router.push(`${pathname}?${params.toString()}`);
  }

  // Lebar kotak: mode "bare" (toolbar Pemesanan) memakai kotak lebih ramping;
  // halaman lain tetap ukuran lama.
  const lebarTanggal = bare ? "w-[8.5rem]" : "w-40";
  const lebarWilayah = bare ? "w-36" : "w-48";

  // Jumlah filter yang sedang aktif di URL — penanda pada tombol Filter (HP).
  const jumlahAktif = ["from", "to", "wilayah"].filter((k) => searchParams.get(k)).length;

  const pilihWilayah = (lebar: string) =>
    wilayahList && (
      <Select value={wilayah} onValueChange={(value) => setWilayah(value ?? "all")}>
        <SelectTrigger className={lebar} aria-label="Wilayah">
          <SelectValue placeholder="Semua Wilayah">{(v: string) => (v === "all" ? "Semua Wilayah" : v)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Semua Wilayah</SelectItem>
          {wilayahList.map((w) => (
            <SelectItem key={w} value={w}>
              {w}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );

  return (
    <>
      {/* Layar HP: satu tombol "Filter" yang membuka popup berisi semua isian. */}
      <Popover open={mobileOpen} onOpenChange={setMobileOpen}>
        {hanyaTombol ? (
          <PopoverTrigger
            render={<Button variant="outline" size="icon" className="relative size-9" aria-label="Filter" title="Filter" />}
          >
            <Filter className="size-4" />
            {jumlahAktif > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                {jumlahAktif}
              </span>
            )}
          </PopoverTrigger>
        ) : (
          <PopoverTrigger render={<Button variant="outline" size="sm" className="w-fit sm:hidden" />}>
            <Filter className="size-4" />
            Filter
            {jumlahAktif > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold leading-4 text-primary-foreground">
                {jumlahAktif}
              </span>
            )}
          </PopoverTrigger>
        )}
        <PopoverContent align={hanyaTombol ? "end" : "start"} className="w-[min(18rem,calc(100vw-2rem))]">
          <div className="flex flex-col gap-3">
            {showDateRange && (
              <>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-dari" className="text-xs">
                    Dari tanggal
                  </Label>
                  <Input id="filter-dari" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="filter-sampai" className="text-xs">
                    Sampai tanggal
                  </Label>
                  <Input
                    id="filter-sampai"
                    type="date"
                    aria-invalid={sameDate}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={cn(sameDate && "border-destructive")}
                  />
                  {sameDate && (
                    <p className="text-[11px] text-destructive">
                      Tanggal &quot;Dari&quot; dan &quot;Sampai&quot; tidak boleh sama — tidak akan ada data.
                    </p>
                  )}
                </div>
              </>
            )}
            {wilayahList && (
              <div className="flex flex-col gap-1">
                <Label className="text-xs">Wilayah</Label>
                {pilihWilayah("w-full")}
              </div>
            )}
            <Button
              onClick={() => {
                applyFilter();
                if (!sameDate) setMobileOpen(false);
              }}
              disabled={sameDate}
            >
              Terapkan
            </Button>
          </div>
        </PopoverContent>
      </Popover>

      {/* Layar sm ke atas: isian sejajar dalam satu baris (kecuali mode hanyaTombol). */}
      <div
        className={cn(
          "hidden flex-wrap items-end gap-3",
          !hanyaTombol && "sm:flex",
          !bare && "rounded-lg border bg-card p-3"
        )}
      >
        {showDateRange && (
          <>
            <Input
              id="from"
              type="date"
              aria-label="Dari Tanggal"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className={lebarTanggal}
            />
            <Tooltip open={sameDate}>
              <TooltipTrigger
                render={
                  <Input
                    id="to"
                    type="date"
                    aria-label="Sampai Tanggal"
                    aria-invalid={sameDate}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    className={cn(lebarTanggal, sameDate && "border-destructive")}
                  />
                }
              />
              <TooltipContent>
                Tanggal &quot;Dari&quot; dan &quot;Sampai&quot; tidak boleh sama — tidak akan ada data. Contoh: Dari 1
                Jul 2026, Sampai 31 Jul 2026.
              </TooltipContent>
            </Tooltip>
          </>
        )}
        {pilihWilayah(lebarWilayah)}
        <Button onClick={applyFilter} disabled={sameDate}>
          Terapkan
        </Button>
      </div>
    </>
  );
}
