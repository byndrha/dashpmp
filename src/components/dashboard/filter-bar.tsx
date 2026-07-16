"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Branch } from "@/types/dashboard";

export function FilterBar({
  branches,
  showDateRange = true,
}: {
  branches: Branch[];
  showDateRange?: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [from, setFrom] = useState(searchParams.get("from") ?? "");
  const [to, setTo] = useState(searchParams.get("to") ?? "");
  const [branch, setBranch] = useState(searchParams.get("branch") ?? "all");

  function applyFilter() {
    const params = new URLSearchParams();
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (branch !== "all") params.set("branch", branch);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3">
      {showDateRange && (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="from" className="text-xs text-muted-foreground">
              Dari Tanggal
            </Label>
            <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="to" className="text-xs text-muted-foreground">
              Sampai Tanggal
            </Label>
            <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" />
          </div>
        </>
      )}
      <div className="flex flex-col gap-1.5">
        <Label className="text-xs text-muted-foreground">Cabang</Label>
        <Select value={branch} onValueChange={(value) => setBranch(value ?? "all")}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Semua Cabang" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Semua Cabang</SelectItem>
            {branches.map((b) => (
              <SelectItem key={b.BranchID} value={String(b.BranchID)}>
                {b.BranchName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <Button onClick={applyFilter}>Terapkan</Button>
    </div>
  );
}
