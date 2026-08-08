"use client";

import { useEffect, useState, useTransition } from "react";
import dynamic from "next/dynamic";
import { toast } from "sonner";
import { Phone, MapPin, Package, Loader2, Pencil, ExternalLink, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { MitraLocationField, type MitraLocationValue } from "@/components/dashboard/mitra-location-field";
import type { MitraRow } from "@/lib/queries/mitra";
import { getMitraDetailAction, setMitraLocationAction } from "@/app/mkesindo/mitra/actions";

const MitraLocationMap = dynamic(
  () => import("@/components/dashboard/mitra-location-map").then((m) => m.MitraLocationMap),
  { ssr: false, loading: () => <Skeleton className="h-[200px] w-full rounded-lg" /> }
);

function rowToLocation(row: MitraRow): MitraLocationValue | null {
  if (row.Latitude == null || row.Longitude == null) return null;
  return { latitude: row.Latitude, longitude: row.Longitude, alamat: row.GeoAlamat };
}

// Read-only mitra info popup, reused anywhere a mitra name is clickable
// outside the Mitra module itself (Kinerja Marketing, Transaksi) — fetches
// lazily on open rather than requiring the parent page to preload every
// mitra's full detail just in case one gets clicked. The map section starts
// as a plain (non-draggable) preview and only becomes the full editable
// MitraLocationField (same one MitraFormDialog uses) once "Edit Lokasi" is
// clicked — an accidental drag on a display-only map shouldn't silently
// look like it moved the pin.
export function MitraDetailDialog({
  businessPartnerId,
  onOpenChange,
}: {
  businessPartnerId: string | null;
  onOpenChange: (open: boolean) => void;
}) {
  const [detail, setDetail] = useState<MitraRow | null>(null);
  const [loading, setLoading] = useState(false);
  const [editingLocation, setEditingLocation] = useState(false);
  const [draftLocation, setDraftLocation] = useState<MitraLocationValue | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!businessPartnerId) return;
    let cancelled = false;
    // Kicks off the lazy fetch for whichever mitra was just clicked — not
    // derivable from render since it's an async network call.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setDetail(null);
    setEditingLocation(false);
    getMitraDetailAction(businessPartnerId)
      .then((result) => {
        if (!cancelled && result.success) setDetail(result.data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [businessPartnerId]);

  function startEditingLocation() {
    if (!detail) return;
    setDraftLocation(rowToLocation(detail));
    setEditingLocation(true);
  }

  function handleSaveLocation() {
    if (!businessPartnerId || !draftLocation) return;
    startTransition(async () => {
      const result = await setMitraLocationAction({ businessPartnerId, ...draftLocation });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setDetail((d) =>
        d ? { ...d, Latitude: draftLocation.latitude, Longitude: draftLocation.longitude, GeoAlamat: draftLocation.alamat } : d
      );
      setEditingLocation(false);
    });
  }

  const location = detail ? rowToLocation(detail) : null;

  return (
    <Dialog open={!!businessPartnerId} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{detail?.Name ?? "Detail Mitra"}</DialogTitle>
          <DialogDescription className="sr-only">Informasi mitra.</DialogDescription>
        </DialogHeader>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" />
            Memuat...
          </div>
        ) : !detail ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Data mitra tidak ditemukan.</p>
        ) : (
          <div className="flex flex-col gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="outline" className="h-5 px-1.5 text-[10px]">
                {detail.PartnerType}
              </Badge>
              <Badge variant={detail.MarketingNama ? "secondary" : "outline"} className="h-5 px-1.5 text-[10px]">
                {detail.MarketingNama ?? "Belum Ditentukan"}
              </Badge>
            </div>
            <div className="flex flex-col gap-1.5 text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Phone className="size-3.5 shrink-0" /> {detail.Kontak || "-"}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" />
                {detail.Wilayah || "-"}
                {detail.Kecamatan ? ` | ${detail.Kecamatan}` : ""}
              </span>
              {detail.Alamat && <span className="pl-[22px]">{detail.Alamat}</span>}
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t pt-2">
              <span className="text-muted-foreground">
                Tenggat Bayar: <span className="text-foreground">{detail.TermOfPaymentName ?? "-"}</span>
              </span>
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Package className="size-3.5 shrink-0" />
                {detail.Capacity != null ? `${detail.Capacity.toLocaleString("id-ID")} kantong/hari` : "Kapasitas belum diisi"}
              </span>
            </div>
            {detail.Kompetitor && (
              <div className="border-t pt-2 text-muted-foreground">
                <span className="font-medium text-foreground">Kompetitor: </span>
                {detail.Kompetitor}
              </div>
            )}

            <div className="border-t pt-2">
              <div className="mb-1.5 flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Lokasi</span>
                <div className="flex items-center gap-1">
                  {location && !editingLocation && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-6"
                      title="Lihat di Google Maps"
                      onClick={() =>
                        window.open(`https://www.google.com/maps?q=${location.latitude},${location.longitude}`, "_blank", "noopener,noreferrer")
                      }
                    >
                      <ExternalLink className="size-3.5" />
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6"
                    title={editingLocation ? "Batal" : "Edit Lokasi"}
                    onClick={() => (editingLocation ? setEditingLocation(false) : startEditingLocation())}
                  >
                    {editingLocation ? <X className="size-3.5" /> : <Pencil className="size-3.5" />}
                  </Button>
                </div>
              </div>

              {editingLocation ? (
                <div className="flex flex-col gap-2">
                  <MitraLocationField
                    value={draftLocation}
                    onChange={setDraftLocation}
                    wilayah={detail.Wilayah}
                    kecamatan={detail.Kecamatan}
                  />
                  <Button size="sm" disabled={pending} onClick={handleSaveLocation} className="self-end">
                    {pending ? "Menyimpan..." : "Simpan Lokasi"}
                  </Button>
                </div>
              ) : location ? (
                <MitraLocationMap
                  latitude={location.latitude}
                  longitude={location.longitude}
                  onChange={() => {}}
                  recenterKey={0}
                  readOnly
                />
              ) : (
                <p className="py-4 text-center text-xs text-muted-foreground">Lokasi belum diatur.</p>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
