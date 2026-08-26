"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const FIELDS = [
  { key: "hasDO", label: "SO -> DO", yes: "Sudah ada DO", no: "Belum ada DO" },
  { key: "hasSoInvoice", label: "SO -> SI", yes: "Sudah ada SI", no: "Belum ada SI" },
  { key: "hasDoInvoice", label: "DO -> SI", yes: "Sudah ada SI", no: "Belum ada SI" },
] as const;

// Three independent yes/no/all dropdowns for /mkesindo/pemesanan's
// document-completeness audit (SO->DO, SO->SI, DO->SI kept separate on
// purpose — see SalesOrderListRow.HasSoInvoice/HasDoInvoice — so a
// mismatch between them is filterable, not just a combined status).
// URL-param-driven like FilterBar, but a separate component rather than
// folding these into that shared bar (used by 8 other pages that have no
// use for document-status filters). Reads/writes on top of whatever
// FilterBar's own from/to/wilayah params already are, each ony ever
// touching its own key.
export function PemesananDocFilter() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function setField(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === "all") params.delete(key);
    else params.set(key, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap gap-2">
      {FIELDS.map((f) => {
        const value = searchParams.get(f.key) ?? "all";
        return (
          <Select key={f.key} value={value} onValueChange={(v) => setField(f.key, v ?? "all")}>
            <SelectTrigger className="w-44" aria-label={f.label}>
              <SelectValue placeholder={f.label}>
                {(v: string) => (v === "all" ? f.label : v === "yes" ? f.yes : f.no)}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{f.label}: Semua</SelectItem>
              <SelectItem value="yes">{f.yes}</SelectItem>
              <SelectItem value="no">{f.no}</SelectItem>
            </SelectContent>
          </Select>
        );
      })}
    </div>
  );
}
