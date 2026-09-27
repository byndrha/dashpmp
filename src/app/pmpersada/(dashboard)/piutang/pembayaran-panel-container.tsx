// src/app/pmpersada/(dashboard)/piutang/pembayaran-panel-container.tsx
"use client";

import { useState } from "react";
import { EsBalokPembayaranPanel } from "@/components/dashboard/es-balok-pembayaran-panel";
import type { EsBalokPembayaranRow } from "@/lib/queries/piutang-priority-es-balok";

// EsBalokPembayaranPanel's own date state defaults internally to today (see
// its todayISO() usage) with no prop to seed it -- this wrapper's
// `initialRows` MUST correspond to today's date server-side (the page fetches
// them with `new Date()`) so the very first render never shows a mismatch
// between the picker's date and the rows displayed. On any later date change
// this component re-fetches via the Task 5 Server Action and swaps the rows
// passed down; EsBalokPembayaranPanel itself keeps owning the picker's value.
export function EsBalokPembayaranPanelContainer({
  initialRows,
  fetchByDate,
}: {
  initialRows: EsBalokPembayaranRow[];
  fetchByDate: (dateISO: string) => Promise<EsBalokPembayaranRow[]>;
}) {
  const [rows, setRows] = useState(initialRows);

  function handleDateChange(dateISO: string) {
    fetchByDate(dateISO).then(setRows);
  }

  return <EsBalokPembayaranPanel rows={rows} onDateChange={handleDateChange} />;
}
