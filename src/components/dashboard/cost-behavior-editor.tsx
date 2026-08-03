// src/components/dashboard/cost-behavior-editor.tsx
"use client";

import { useState, useTransition } from "react";
import { Info } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { CostBehaviorRow } from "@/lib/queries/keuangan-detail-pmputra";

const OPTIONS: { value: "FIXED" | "VARIABLE" | "MIXED" | "NONE"; label: string }[] = [
  { value: "NONE", label: "Belum ditandai" },
  { value: "FIXED", label: "Tetap (Fixed)" },
  { value: "VARIABLE", label: "Variabel" },
  { value: "MIXED", label: "Campuran (Mixed)" },
];

export function CostBehaviorEditor({
  rows,
  onSetCostBehavior,
}: {
  rows: CostBehaviorRow[];
  onSetCostBehavior: (chartOfAccountId: string, costBehavior: "FIXED" | "VARIABLE" | "MIXED" | null) => Promise<void>;
}) {
  const [localRows, setLocalRows] = useState(rows);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function handleChange(row: CostBehaviorRow, value: string) {
    const next = value === "NONE" ? null : (value as "FIXED" | "VARIABLE" | "MIXED");
    setError(null);
    setPendingId(row.ChartOfAccountID);
    startTransition(async () => {
      try {
        await onSetCostBehavior(row.ChartOfAccountID, next);
        setLocalRows((prev) =>
          prev.map((r) => (r.ChartOfAccountID === row.ChartOfAccountID ? { ...r, CostBehavior: next } : r))
        );
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan klasifikasi.");
      } finally {
        setPendingId(null);
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Klasifikasi Biaya untuk BEP</CardTitle>
        <CardDescription className="flex items-start gap-1.5">
          <Info className="mt-0.5 size-3.5 shrink-0" />
          Tandai setiap akun Beban Operasional sebagai Tetap/Variabel/Campuran. Akun yang belum ditandai tidak ikut
          dihitung di Break-Even Point di bawah.
        </CardDescription>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </CardHeader>
      <CardContent>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="h-8 px-2 text-xs">Akun</TableHead>
              <TableHead className="h-8 px-2 text-xs">Klasifikasi</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {localRows.map((r) => (
              <TableRow key={r.ChartOfAccountID}>
                <TableCell className="px-2 py-1.5">
                  <p className="text-xs font-medium leading-tight">{r.AccountName}</p>
                  <p className="font-data text-[10px] leading-tight text-muted-foreground">{r.AccountNo}</p>
                </TableCell>
                <TableCell className="px-2 py-1.5">
                  <Select
                    value={r.CostBehavior ?? "NONE"}
                    onValueChange={(v) => v && handleChange(r, v)}
                    disabled={pendingId === r.ChartOfAccountID}
                  >
                    <SelectTrigger className="h-8 w-44 text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  );
}
