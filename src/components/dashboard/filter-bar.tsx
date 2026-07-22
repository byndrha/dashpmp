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
import { cn } from "@/lib/utils";

export function FilterBar({
  wilayahList,
  showDateRange = true,
}: {
  wilayahList?: string[];
  showDateRange?: boolean;
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
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (wilayah !== "all") params.set("wilayah", wilayah);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-col gap-2 sm:contents">
      <Button variant="outline" size="sm" className="w-fit sm:hidden" onClick={() => setMobileOpen((v) => !v)}>
        <Filter className="size-4" />
        Filter
      </Button>
      <div
        className={cn(
          "flex-wrap items-end gap-3 rounded-lg border bg-card p-3 sm:flex",
          mobileOpen ? "flex" : "hidden"
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
              className="w-40"
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
                    className={cn("w-40", sameDate && "border-destructive")}
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
        {wilayahList && (
          <Select value={wilayah} onValueChange={(value) => setWilayah(value ?? "all")}>
            <SelectTrigger className="w-48" aria-label="Wilayah">
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
        )}
        <Button onClick={applyFilter} disabled={sameDate}>
          Terapkan
        </Button>
      </div>
    </div>
  );
}
