"use client";

import { useState, useTransition } from "react";
import { DndContext, PointerSensor, useSensor, useSensors, closestCenter, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { toast } from "sonner";
import { GripVertical, Printer as PrinterIcon, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { formatDate, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PrintQueuePoller, triggerPrintQueuePollNow } from "@/components/dashboard/print-queue-poller";
import {
  getPrintQueueHistoryAction,
  cancelPrintQueueJobAction,
  reorderPendingPrintQueueAction,
  retryPrintQueueJobAction,
  setPrintFormatSettingsAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";
import type { PrintQueueHistoryRow } from "@/lib/queries/print-queue";
import type { PrintFormatSettings } from "@/lib/queries/print-format-settings";

const STATUS_BADGE_CLASS: Record<PrintQueueHistoryRow["status"], string> = {
  Pending: "border-border text-muted-foreground",
  Printing: "border-blue-500/30 text-blue-600",
  Dicetak: "border-green-600/30 text-green-600",
  Error: "border-destructive/30 text-destructive",
  Dibatalkan: "border-border text-muted-foreground line-through",
};

function StatusBadge({ status }: { status: PrintQueueHistoryRow["status"] }) {
  return (
    <Badge variant="outline" className={STATUS_BADGE_CLASS[status]}>
      {status}
    </Badge>
  );
}

function SortableHistoryRow({
  row,
  onRetry,
  onCancel,
  busy,
}: {
  row: PrintQueueHistoryRow;
  onRetry: (id: number) => void;
  onCancel: (id: number) => void;
  busy: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: row.printQueueId,
    disabled: row.status !== "Pending",
  });

  // Plain <tr>, not the <TableRow> wrapper — ui/table.tsx's TableRow is a
  // bare function component around <tr {...props} />, and its prop type
  // (React.ComponentProps<"tr">) isn't guaranteed to forward `ref` the way
  // an intrinsic element does. dnd-kit's setNodeRef MUST attach to the real
  // DOM node to measure drag transforms, so this row uses the exact same
  // "native element + ref={setNodeRef}" pattern route-validation-dialog.tsx's
  // own SortableStopRow already uses (there on a <div>, here on a <tr>).
  return (
    <tr
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn("border-b transition-colors hover:bg-muted/50", isDragging && "z-10 bg-muted/50 opacity-70 shadow-lg")}
    >
      <TableCell className="w-6">
        {row.status === "Pending" && (
          <button type="button" {...attributes} {...listeners} className="cursor-grab touch-none text-muted-foreground active:cursor-grabbing">
            <GripVertical className="size-4" />
          </button>
        )}
      </TableCell>
      <TableCell>{row.voucherNo ?? "-"}</TableCell>
      <TableCell>{row.mitraName ?? "-"}</TableCell>
      <TableCell>
        {row.armadaNama ?? "-"}
        {row.vehicleNo ? ` (${row.vehicleNo})` : ""}
      </TableCell>
      <TableCell>{row.jamJadwal ? formatDate(row.jamJadwal) : "-"}</TableCell>
      <TableCell>
        <StatusBadge status={row.status} />
      </TableCell>
      <TableCell>
        <Badge variant="outline">{row.isManual ? "Manual" : "Otomatis"}</Badge>
      </TableCell>
      <TableCell>{row.failCount > 0 ? row.failCount : ""}</TableCell>
      <TableCell>{formatDate(row.createdAt)} {formatTime(row.createdAt)}</TableCell>
      <TableCell>{row.printedAt ? `${formatDate(row.printedAt)} ${formatTime(row.printedAt)}` : "-"}</TableCell>
      <TableCell>
        <div className="flex items-center gap-1">
          <button
            type="button"
            title="Cetak ulang"
            onClick={() => onRetry(row.printQueueId)}
            disabled={busy}
            className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-border disabled:cursor-default disabled:opacity-50"
          >
            <PrinterIcon className="size-3.5" />
          </button>
          {row.status === "Pending" && (
            <button
              type="button"
              title="Batalkan"
              onClick={() => onCancel(row.printQueueId)}
              disabled={busy}
              className="shrink-0 rounded border border-transparent p-1 text-muted-foreground transition-colors hover:border-destructive/30 hover:text-destructive disabled:cursor-default disabled:opacity-50"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </TableCell>
    </tr>
  );
}

const PREVIEW_COLUMNS = 32;

function center(text: string): string {
  const pad = Math.max(0, Math.floor((PREVIEW_COLUMNS - text.length) / 2));
  return " ".repeat(pad) + text;
}

function padRight(text: string, amount: string): string {
  const gap = Math.max(1, PREVIEW_COLUMNS - text.length - amount.length);
  return text + " ".repeat(gap) + amount;
}

function buildReceiptPreviewText(settings: PrintFormatSettings): string {
  const lines: string[] = [];
  lines.push(center("Es Kristal - Pabrik Es PMP Group"));
  lines.push(center("| Ponorogo"));
  lines.push(center("MKE/SI/000001/2026-08"));
  lines.push(center("24-08-2026 10:00"));
  lines.push("");
  lines.push("Mitra: Toko Contoh");
  if (settings.showMitraAddress) lines.push("Jl. Contoh No. 1, Ponorogo");
  lines.push("Armada: Truk 1 (AE 1234 SH)");
  if (settings.showDriverName) lines.push("Driver: Budi");
  lines.push("");
  lines.push("-".repeat(PREVIEW_COLUMNS));
  lines.push("Es Kristal 10KG x10");
  lines.push(padRight("", "Rp250.000"));
  lines.push("-".repeat(PREVIEW_COLUMNS));
  lines.push(padRight("TOTAL:", "Rp250.000"));
  lines.push("");
  if (settings.showBankTransfer) {
    lines.push("Transfer ke:");
    lines.push("BCA 1234567890");
    lines.push("a.n. PT Mitra Kelola Esindo");
    lines.push("");
  }
  if (settings.showQrCode) {
    lines.push(center("Scan untuk lihat tagihan"));
    lines.push(center("& bayar QRIS:"));
    lines.push(center("[ QR CODE ]"));
    lines.push("");
  }
  if (settings.showDisclaimer) {
    lines.push(center("SI Awal - nominal dapat"));
    lines.push(center("berubah sesuai kondisi"));
    lines.push(center("pengiriman di lapangan"));
  }
  return lines.join("\n");
}

export function PrintManagementView({
  initialHistory,
  initialSettings,
  businessDate,
}: {
  initialHistory: PrintQueueHistoryRow[];
  initialSettings: PrintFormatSettings;
  businessDate: string;
}) {
  const [history, setHistory] = useState(initialHistory);
  const [settings, setSettings] = useState(initialSettings);
  const [savingSettings, setSavingSettings] = useState(false);
  const [dateFrom, setDateFrom] = useState(businessDate);
  const [dateTo, setDateTo] = useState(businessDate);
  const [statusFilter, setStatusFilter] = useState<PrintQueueHistoryRow["status"] | "all">("all");
  const [busyId, setBusyId] = useState<number | null>(null);
  const [, startTransition] = useTransition();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  async function refetch(overrides?: {
    dateFrom?: string;
    dateTo?: string;
    status?: PrintQueueHistoryRow["status"] | "all";
  }) {
    const effectiveDateFrom = overrides?.dateFrom ?? dateFrom;
    const effectiveDateTo = overrides?.dateTo ?? dateTo;
    const effectiveStatus = overrides?.status ?? statusFilter;
    const result = await getPrintQueueHistoryAction({
      dateFrom: effectiveDateFrom,
      dateTo: effectiveDateTo,
      status: effectiveStatus === "all" ? undefined : effectiveStatus,
    });
    if (result.success) setHistory(result.data);
    else toast.error(result.error);
  }

  function handleFilterChange(overrides?: Parameters<typeof refetch>[0]) {
    startTransition(() => refetch(overrides));
  }

  function handleRetry(printQueueId: number) {
    setBusyId(printQueueId);
    startTransition(async () => {
      const result = await retryPrintQueueJobAction(printQueueId);
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("SI ditambahkan ke antrian cetak.");
      triggerPrintQueuePollNow();
      await refetch();
    });
  }

  function handleCancel(printQueueId: number) {
    if (!confirm("Batalkan cetak SI ini?")) return;
    setBusyId(printQueueId);
    startTransition(async () => {
      const result = await cancelPrintQueueJobAction(printQueueId);
      setBusyId(null);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      await refetch();
    });
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const pendingRows = history.filter((r) => r.status === "Pending");
    const oldIndex = pendingRows.findIndex((r) => r.printQueueId === active.id);
    const newIndex = pendingRows.findIndex((r) => r.printQueueId === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const reordered = arrayMove(pendingRows, oldIndex, newIndex);

    // Splice the reordered Pending rows back into their original positions
    // within the full history list — Pending rows are always contiguous at
    // the top of a newest-first list only by coincidence, so rebuild by
    // index rather than assuming that.
    let cursor = 0;
    const next = history.map((r) => (r.status === "Pending" ? reordered[cursor++] : r));
    setHistory(next);

    startTransition(async () => {
      const result = await reorderPendingPrintQueueAction(reordered.map((r) => r.printQueueId));
      if (!result.success) {
        toast.error(result.error);
        await refetch();
      }
    });
  }

  function handleSaveSettings() {
    setSavingSettings(true);
    startTransition(async () => {
      const result = await setPrintFormatSettingsAction(settings);
      setSavingSettings(false);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Pengaturan format SI disimpan.");
    });
  }

  function toggleSetting(key: keyof PrintFormatSettings) {
    setSettings((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  const pendingIds = history.filter((r) => r.status === "Pending").map((r) => r.printQueueId);

  return (
    <Tabs defaultValue="antrian">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabsList>
          <TabsTrigger value="antrian">Antrian Cetak</TabsTrigger>
          <TabsTrigger value="format">Format SI</TabsTrigger>
        </TabsList>
        <PrintQueuePoller />
      </div>

      <TabsContent value="antrian" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => {
              setDateFrom(e.target.value);
              handleFilterChange({ dateFrom: e.target.value });
            }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <span className="text-muted-foreground">s/d</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => {
              setDateTo(e.target.value);
              handleFilterChange({ dateTo: e.target.value });
            }}
            className="h-8 rounded-lg border border-border bg-background px-2 text-sm"
          />
          <Select
            value={statusFilter}
            onValueChange={(v) => {
              const nextStatus = v as PrintQueueHistoryRow["status"] | "all";
              setStatusFilter(nextStatus);
              handleFilterChange({ status: nextStatus });
            }}
          >
            <SelectTrigger className="h-8 w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua status</SelectItem>
              <SelectItem value="Pending">Pending</SelectItem>
              <SelectItem value="Printing">Printing</SelectItem>
              <SelectItem value="Dicetak">Dicetak</SelectItem>
              <SelectItem value="Error">Error</SelectItem>
              <SelectItem value="Dibatalkan">Dibatalkan</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead />
                <TableHead>No. SI</TableHead>
                <TableHead>Mitra</TableHead>
                <TableHead>Armada</TableHead>
                <TableHead>Tgl Jadwal</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tipe</TableHead>
                <TableHead>Gagal</TableHead>
                <TableHead>Dibuat</TableHead>
                <TableHead>Dicetak</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={pendingIds} strategy={verticalListSortingStrategy}>
                  {history.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center text-muted-foreground">
                        Tidak ada job cetak pada rentang ini.
                      </TableCell>
                    </TableRow>
                  ) : (
                    history.map((row) => (
                      <SortableHistoryRow
                        key={row.printQueueId}
                        row={row}
                        onRetry={handleRetry}
                        onCancel={handleCancel}
                        busy={busyId === row.printQueueId}
                      />
                    ))
                  )}
                </SortableContext>
              </DndContext>
            </TableBody>
          </Table>
        </div>
      </TabsContent>

      <TabsContent value="format" className="flex flex-col gap-4 lg:flex-row">
        <div className="flex flex-1 flex-col gap-3 rounded-lg border p-4">
          {(
            [
              ["showMitraAddress", "Alamat mitra"],
              ["showDriverName", "Nama driver"],
              ["showBankTransfer", "Blok transfer bank"],
              ["showQrCode", "QR code tagihan"],
              ["showDisclaimer", "Baris disclaimer nominal"],
            ] as [keyof PrintFormatSettings, string][]
          ).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={settings[key]} onChange={() => toggleSetting(key)} className="size-4" />
              {label}
            </label>
          ))}
          <Button onClick={handleSaveSettings} disabled={savingSettings} className="mt-2 w-fit">
            Simpan Pengaturan
          </Button>
        </div>
        <div className="flex-1 rounded-lg border bg-muted/30 p-4">
          <p className="mb-2 text-xs text-muted-foreground">Pratinjau (58mm, 32 kolom)</p>
          <pre className="mx-auto w-fit whitespace-pre bg-white p-3 font-mono text-xs text-black shadow">
            {buildReceiptPreviewText(settings)}
          </pre>
        </div>
      </TabsContent>
    </Tabs>
  );
}
