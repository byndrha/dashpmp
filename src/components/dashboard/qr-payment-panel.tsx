"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { getActiveMetodePembayaranAction } from "@/app/mkesindo/actions/metode-pembayaran";
import type { Konteks, MetodePembayaranRow } from "@/lib/queries/metode-pembayaran";
import { formatRupiah } from "@/lib/format";

export function QrPaymentPanel({
  perusahaanId,
  konteks,
  amount,
  onSubmit,
}: {
  perusahaanId: number;
  konteks: Konteks;
  amount: number;
  // Omit for konteks="publik" — that surface is read-only, no form.
  onSubmit?: (input: { metodeKode: string; catatan: string | null }) => Promise<void>;
}) {
  const [rows, setRows] = useState<MetodePembayaranRow[] | null>(null);
  const [selectedMetode, setSelectedMetode] = useState<MetodePembayaranRow["metode"] | null>(null);
  const [selectedKode, setSelectedKode] = useState<string | null>(null);
  const [catatan, setCatatan] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getActiveMetodePembayaranAction(perusahaanId, konteks).then((data) => {
      if (cancelled) return;
      setRows(data);
      const firstMetode = data[0]?.metode ?? null;
      setSelectedMetode(firstMetode);
      const firstRow = data.find((r) => r.metode === firstMetode) ?? null;
      setSelectedKode(firstRow?.kode ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [perusahaanId, konteks]);

  const metodeOptions = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.metode))), [rows]);
  const jenisOptionsForSelectedMetode = useMemo(
    () => (rows ?? []).filter((r) => r.metode === selectedMetode),
    [rows, selectedMetode]
  );
  const selectedRow = (rows ?? []).find((r) => r.kode === selectedKode) ?? null;

  if (rows === null) return <p className="text-sm text-muted-foreground">Memuat metode pembayaran...</p>;
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">Belum ada metode pembayaran tersedia.</p>;

  async function handleSubmit() {
    if (!selectedRow || !onSubmit) return;
    if (selectedRow.wajibCatatan && !catatan.trim()) {
      setError("Catatan wajib diisi untuk metode ini.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({ metodeKode: selectedRow.kode, catatan: catatan.trim() || null });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal menyimpan pembayaran.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <Tabs
        value={selectedMetode ?? undefined}
        onValueChange={(v) => {
          setSelectedMetode(v as MetodePembayaranRow["metode"]);
          const first = (rows ?? []).find((r) => r.metode === v);
          setSelectedKode(first?.kode ?? null);
        }}
      >
        <TabsList>
          {metodeOptions.map((m) => (
            <TabsTrigger key={m} value={m}>
              {m}
            </TabsTrigger>
          ))}
        </TabsList>
        {metodeOptions.map((m) => (
          <TabsContent key={m} value={m} className="flex flex-col gap-3 pt-3">
            {jenisOptionsForSelectedMetode.length > 1 && (
              <div className="flex gap-2">
                {jenisOptionsForSelectedMetode.map((r) => (
                  <Button
                    key={r.kode}
                    type="button"
                    size="sm"
                    variant={selectedKode === r.kode ? "default" : "outline"}
                    onClick={() => setSelectedKode(r.kode)}
                  >
                    {r.jenis === "qris_static" ? "QRIS Statis" : r.jenis === "qris_dinamis" ? "QRIS Dinamis" : r.kode}
                  </Button>
                ))}
              </div>
            )}

            {selectedRow?.jenis === "qris_static" && selectedRow.qrisStatisImagePath && (
              // eslint-disable-next-line @next/next/no-img-element -- served via Google Drive proxy path, not a static build asset
              <img src={selectedRow.qrisStatisImagePath} alt="QRIS" className="mx-auto h-56 w-56 object-contain" />
            )}
            {selectedRow?.jenis === "qris_dinamis" && (
              <p className="text-sm text-muted-foreground">QR Dinamis untuk {formatRupiah(amount)} akan tampil di sini.</p>
            )}

            {onSubmit && selectedRow && (
              <>
                {selectedRow.wajibCatatan && (
                  <textarea
                    className="w-full rounded-md border border-input bg-background p-2 text-sm"
                    rows={2}
                    placeholder="Catatan (wajib) — mis. nomor referensi transfer"
                    value={catatan}
                    onChange={(e) => setCatatan(e.target.value)}
                  />
                )}
                {error && <p className="text-sm text-destructive">{error}</p>}
                <Button onClick={handleSubmit} disabled={submitting}>
                  {submitting ? "Menyimpan..." : "Konfirmasi Pembayaran"}
                </Button>
              </>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
