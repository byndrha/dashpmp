// src/components/dashboard/inventaris-vendor-list.tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { VendorRow } from "@/lib/queries/inventaris-vendor";
import type { VendorRanking } from "@/lib/queries/inventaris-pengiriman";
import { InventarisVendorFormDialog } from "@/components/dashboard/inventaris-vendor-form-dialog";

export function InventarisVendorList({
  vendorList,
}: {
  vendorList: (VendorRow & { ranking: VendorRanking; perusahaanNames: string[] })[];
}) {
  const [search, setSearch] = useState("");
  const [showAddDialog, setShowAddDialog] = useState(false);

  const filtered = vendorList.filter((v) => v.nama.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nama vendor..."
          className="max-w-xs"
        />
        <Button onClick={() => setShowAddDialog(true)}>
          <Plus className="size-4" />
          Tambah Vendor
        </Button>
      </div>
      <div className="rounded-xl border">
        {filtered.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">Belum ada vendor.</p>
        ) : (
          <div className="divide-y">
            {filtered.map((v) => (
              <Link
                key={v.id}
                href={`/grup/inventaris/vendor/${v.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-muted/40"
              >
                <div className="flex flex-col">
                  <span className="font-medium">{v.nama}</span>
                  {v.npwp && <span className="text-xs text-muted-foreground">NPWP {v.npwp}</span>}
                  <span className="text-xs text-muted-foreground">
                    {v.perusahaanNames.length > 0
                      ? `Terdaftar di ${v.perusahaanNames.join(", ")}`
                      : "Belum terhubung ke perusahaan manapun"}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  {v.ranking.jumlahLog > 0 ? (
                    <span className="flex items-center gap-1">
                      <Star className="size-3.5 text-warning" />
                      {v.ranking.rataRataRatingKualitas?.toFixed(1)} · {v.ranking.rataRataLamaKirimHari?.toFixed(1)} hari
                    </span>
                  ) : (
                    <span>Belum ada data pengiriman</span>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
      <InventarisVendorFormDialog open={showAddDialog} onOpenChange={setShowAddDialog} />
    </div>
  );
}
