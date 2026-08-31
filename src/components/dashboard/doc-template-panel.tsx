"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { saveDocTemplateAction } from "@/app/grup/akun/actions";
import { PAPER_SIZES, type DocTemplate, type PaperSize } from "@/lib/doc-template-types";
import { PhotoStatusOverlay, type PhotoUploadStatus } from "@/components/ui/photo-status-overlay";

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/50"
    >
      {label}
      <span
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${checked ? "bg-primary" : "bg-muted-foreground/30"}`}
      >
        <span
          className={`absolute top-0.5 size-4 rounded-full bg-white transition-transform ${checked ? "translate-x-4" : "translate-x-0.5"}`}
        />
      </span>
    </button>
  );
}

// Form-based builder (not a visual drag-and-drop canvas — deliberately, per
// explicit product decision) for the printed Delivery Order document: paper
// size, header branding, which optional sections show, footer notes.
// DocType is currently always "DeliveryOrder" — the schema/UI already
// generalize to more doc types later without a redesign.
export function DocTemplatePanel({ initial }: { initial: DocTemplate }) {
  const [paperSize, setPaperSize] = useState<PaperSize>(initial.paperSize);
  const [customWidthMM, setCustomWidthMM] = useState(initial.customWidthMM?.toString() ?? "");
  const [customHeightMM, setCustomHeightMM] = useState(initial.customHeightMM?.toString() ?? "");
  const [headerTitle, setHeaderTitle] = useState(initial.headerTitle);
  const [headerAddress, setHeaderAddress] = useState(initial.headerAddress ?? "");
  const [logoPath, setLogoPath] = useState(initial.logoPath);
  const [showDriverInfo, setShowDriverInfo] = useState(initial.showDriverInfo);
  const [showArmadaInfo, setShowArmadaInfo] = useState(initial.showArmadaInfo);
  const [showBonusColumn, setShowBonusColumn] = useState(initial.showBonusColumn);
  const [showSignatureBlock, setShowSignatureBlock] = useState(initial.showSignatureBlock);
  const [footerNotes, setFooterNotes] = useState(initial.footerNotes ?? "");
  const [uploading, setUploading] = useState(false);
  const [logoUploadStatus, setLogoUploadStatus] = useState<PhotoUploadStatus | undefined>(undefined);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleLogoChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setError(null);
    setLogoUploadStatus("uploading");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/mkesindo/upload/doc-template", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah logo");
      setLogoPath(data.path);
      setLogoUploadStatus("success");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal mengunggah logo");
      setLogoUploadStatus("error");
    } finally {
      setUploading(false);
    }
  }

  function handleSave() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      const result = await saveDocTemplateAction({
        docType: "DeliveryOrder",
        paperSize,
        customWidthMM: paperSize === "Custom" && customWidthMM ? Number(customWidthMM) : null,
        customHeightMM: paperSize === "Custom" && customHeightMM ? Number(customHeightMM) : null,
        headerTitle: headerTitle.trim(),
        headerAddress: headerAddress.trim() || null,
        logoPath,
        showDriverInfo,
        showArmadaInfo,
        showBonusColumn,
        showSignatureBlock,
        footerNotes: footerNotes.trim() || null,
      });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setSaved(true);
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Template Dokumen — Surat Jalan (DO)</CardTitle>
        <CardDescription>
          Mengatur tampilan PDF Surat Jalan yang dicetak dari Validasi Rute — ukuran kertas, kop surat, dan bagian
          mana yang ditampilkan.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Ukuran Kertas</Label>
            <Select value={paperSize} onValueChange={(v) => setPaperSize((v as PaperSize) ?? "A5")}>
              <SelectTrigger className="w-full">
                <SelectValue>{(v: string) => v}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {PAPER_SIZES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {paperSize === "Custom" && (
            <div className="flex gap-2">
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Lebar (mm)</Label>
                <Input type="number" min="1" value={customWidthMM} onChange={(e) => setCustomWidthMM(e.target.value)} />
              </div>
              <div className="flex flex-1 flex-col gap-1.5">
                <Label className="text-xs text-muted-foreground">Tinggi (mm)</Label>
                <Input type="number" min="1" value={customHeightMM} onChange={(e) => setCustomHeightMM(e.target.value)} />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Judul Kop Surat</Label>
          <Input value={headerTitle} onChange={(e) => setHeaderTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Alamat Kop Surat</Label>
          <Input value={headerAddress} onChange={(e) => setHeaderAddress(e.target.value)} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Logo</Label>
          <div className="flex items-center gap-3">
            {logoPath ? (
              <div className="relative size-14 shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={logoPath} alt="Logo" className="size-14 rounded-lg border object-contain" />
                <PhotoStatusOverlay status={logoUploadStatus} />
              </div>
            ) : (
              <div className="relative flex size-14 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
                Tanpa logo
                <PhotoStatusOverlay status={logoUploadStatus} />
              </div>
            )}
            <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleLogoChange} disabled={uploading} className="text-xs" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <ToggleRow label="Info Driver" checked={showDriverInfo} onChange={setShowDriverInfo} />
          <ToggleRow label="Info Armada" checked={showArmadaInfo} onChange={setShowArmadaInfo} />
          <ToggleRow label="Kolom Bonus" checked={showBonusColumn} onChange={setShowBonusColumn} />
          <ToggleRow label="Kolom Tanda Tangan" checked={showSignatureBlock} onChange={setShowSignatureBlock} />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Catatan Kaki</Label>
          <Textarea value={footerNotes} onChange={(e) => setFooterNotes(e.target.value)} rows={2} />
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="self-end" disabled={pending || uploading} onClick={handleSave}>
          <Save className="size-3.5" />
          {pending ? "Menyimpan..." : "Simpan Template"}
        </Button>
        {saved && !pending && <p className="text-right text-xs text-primary">Tersimpan.</p>}
      </CardContent>
    </Card>
  );
}
