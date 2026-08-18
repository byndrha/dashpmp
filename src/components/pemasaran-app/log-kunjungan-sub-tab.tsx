"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { getBusinessDateISO } from "@/lib/business-date";
import { getVisitLogStatusAction, saveVisitLogAction } from "@/app/mkesindo/pemasaran-app/actions";
import type { VisitLogStatusRow } from "@/lib/queries/marketing-visit-log-status";

export function LogKunjunganSubTab() {
  const [rows, setRows] = useState<VisitLogStatusRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<VisitLogStatusRow | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Read fresh after an await so a save request for a mitra the user has
  // since switched away from (or closed the dialog for) can't paint a stale
  // error over the wrong dialog — same pattern as beranda-tab.tsx /
  // top-mitra-piutang-panel.tsx's editingNoteIdRef.
  const editingIdRef = useRef<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dateISO = getBusinessDateISO();

  function reload() {
    getVisitLogStatusAction(dateISO).then((result) => {
      if (!result.success) {
        setError(result.error);
        return;
      }
      setRows(result.data);
    });
  }

  useEffect(() => {
    reload();
    // dateISO is stable within one page lifetime (derived from a fixed
    // business date), so this only needs to run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function openEditor(row: VisitLogStatusRow) {
    editingIdRef.current = row.BusinessPartnerID;
    setSaveError(null);
    setEditing(row);
  }

  function closeEditor() {
    editingIdRef.current = null;
    setEditing(null);
    setSaveError(null);
  }

  function handleSave(formData: FormData) {
    if (!editing) return;
    const targetId = editing.BusinessPartnerID;
    const note = String(formData.get("note") ?? "").trim();
    setSaveError(null);
    startTransition(async () => {
      const result = await saveVisitLogAction({
        businessPartnerId: targetId,
        dateISO,
        hasilKunjungan: note || null,
      });
      // The dialog may have moved on to a different mitra (or closed) while
      // this request was in flight — only touch state if it's still showing
      // the mitra this request was actually for.
      if (editingIdRef.current !== targetId) return;
      if (!result.success) {
        setSaveError(result.error);
        return;
      }
      closeEditor();
      reload();
    });
  }

  if (error) return <p className="p-4 text-sm text-destructive">{error}</p>;
  if (!rows) {
    return (
      <div className="flex h-40 items-center justify-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const filledCount = rows.filter((r) => r.HasilKunjungan != null).length;

  return (
    <div className="flex flex-col gap-2 p-4">
      <p className="text-xs text-muted-foreground">
        {filledCount} sudah diisi · {rows.length - filledCount} belum diisi
      </p>
      {rows.map((r) => (
        <Card key={r.BusinessPartnerID}>
          <CardContent
            className="flex cursor-pointer flex-col gap-1 p-3"
            onClick={() => openEditor(r)}
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{r.Name}</p>
                <p className="text-xs text-muted-foreground">
                  {r.Wilayah}
                  {r.Kecamatan ? ` - ${r.Kecamatan}` : ""}
                </p>
              </div>
              <Badge variant={r.HasilKunjungan != null ? "default" : "outline"} className="shrink-0 text-[10px]">
                {r.HasilKunjungan != null ? "Sudah Diisi" : "Belum Diisi"}
              </Badge>
            </div>
            {r.HasilKunjungan && <p className="text-xs text-muted-foreground">{r.HasilKunjungan}</p>}
          </CardContent>
        </Card>
      ))}

      <Dialog open={editing != null} onOpenChange={(open) => !open && closeEditor()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Hasil Kunjungan — {editing?.Name}</DialogTitle>
          </DialogHeader>
          <form action={handleSave} className="flex flex-col gap-3">
            <Label htmlFor="note" className="sr-only">
              Hasil Kunjungan
            </Label>
            <Textarea
              id="note"
              name="note"
              rows={4}
              defaultValue={editing?.HasilKunjungan ?? ""}
              placeholder="Catat hasil kunjungan hari ini..."
            />
            {saveError && <p className="text-xs text-destructive">{saveError}</p>}
            <DialogFooter>
              <Button type="submit" disabled={pending}>
                {pending ? "Menyimpan..." : "Simpan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
