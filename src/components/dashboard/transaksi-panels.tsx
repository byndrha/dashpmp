"use client";

import { useEffect, useRef, useState } from "react";
import { WilayahDeliveryPanel } from "@/components/dashboard/wilayah-delivery-panel";
import { MitraDOPanel } from "@/components/dashboard/mitra-do-panel";
import type { WilayahDeliverySummary } from "@/lib/queries/delivery";
import type { MitraDOMonthly } from "@/lib/queries/mitra-do";
import type { MitraContactLogSummaryEntry } from "@/lib/queries/mitra-contact-log";

// Panel Kartu Transaksi dihapus 2026-11-25: fungsinya pindah ke panel
// Transaksi DO per Mitra (klik angka tanggal = popover transaksi hari itu,
// chip "2×" = lebih dari satu DO sehari, tombol "Export Transaksi") dan ke
// modul Pemesanan (chip SI Lunas + ekspor).
export function TransaksiPanels({
  wilayahDelivery,
  mitraDO,
  contactLogSummary,
  initialMarketingFilter,
}: {
  wilayahDelivery: WilayahDeliverySummary[];
  mitraDO: MitraDOMonthly;
  contactLogSummary: MitraContactLogSummaryEntry[];
  // Seeded from Kinerja Marketing's "?marketing=" deep link (Pemasaran) —
  // clicking a Marketing there lands here pre-filtered, scrolled straight
  // to the DO-per-Mitra panel instead of the page top.
  initialMarketingFilter?: string;
}) {
  // Lifted here (not local to MitraDOPanel) so clicking a Wilayah tile below
  // can drive it directly — this is the single shared "which region is the
  // DO-per-Mitra panel currently filtered to" state.
  const [mitraDOWilayah, setMitraDOWilayah] = useState("all");
  const [mitraDOMarketing, setMitraDOMarketing] = useState(initialMarketingFilter || "all");
  const mitraDORef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (initialMarketingFilter) mitraDORef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    // Only ever meant to fire once, off the value the page loaded with.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleWilayahClick(wilayah: string) {
    setMitraDOWilayah(wilayah);
    mitraDORef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex flex-col gap-4">
      <WilayahDeliveryPanel data={wilayahDelivery} onWilayahClick={handleWilayahClick} />

      <div ref={mitraDORef}>
        <MitraDOPanel
          data={mitraDO}
          contactLogSummary={contactLogSummary}
          wilayahFilter={mitraDOWilayah}
          onWilayahFilterChange={setMitraDOWilayah}
          marketingFilter={mitraDOMarketing}
          onMarketingFilterChange={setMitraDOMarketing}
        />
      </div>
    </div>
  );
}
