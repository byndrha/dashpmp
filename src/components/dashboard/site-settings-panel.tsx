"use client";

import { useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { setSiteSettingsAction } from "@/app/(dashboard)/akun/actions";
import type { SiteSettings } from "@/lib/queries/site-settings";

// Same upload-then-set-path pattern as armada-dialog.tsx's photo field —
// upload happens immediately on file selection (separate from the form's
// own Simpan button), the resulting path is just held in state until Simpan
// writes the whole settings row.
function ImageUploadField({
  label,
  caption,
  path,
  kind,
  onUploaded,
}: {
  label: string;
  caption?: string;
  path: string | null;
  kind: "favicon" | "og-image";
  onUploaded: (path: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("kind", kind);
      const res = await fetch("/api/upload/site-asset", { method: "POST", body: formData });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Gagal mengunggah file");
      onUploaded(data.path);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah file");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {caption && <p className="text-[11px] text-muted-foreground">{caption}</p>}
      <div className="flex items-center gap-3">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={path} alt={label} className="size-16 rounded-lg border object-cover" />
        ) : (
          <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
            Default
          </div>
        )}
        <div className="flex flex-col gap-1">
          <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} className="text-xs" />
          {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
          {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
        </div>
      </div>
    </div>
  );
}

// Global site title/description/favicon/OG-image — one shared set of
// values for the whole dashboard (not per-PT, unlike the separate
// Perusahaan registry). Read by the root layout's generateMetadata() on
// every route, so a change here takes effect without a redeploy.
export function SiteSettingsPanel({ initial }: { initial: SiteSettings }) {
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [faviconPath, setFaviconPath] = useState(initial.faviconPath);
  const [ogImagePath, setOgImagePath] = useState(initial.ogImagePath);
  const [pending, startTransition] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleSave() {
    setSaved(false);
    setError(null);
    startTransition(async () => {
      try {
        await setSiteSettingsAction({
          title: title.trim(),
          description: description.trim() || null,
          faviconPath,
          ogImagePath,
        });
        setSaved(true);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan pengaturan situs.");
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-display">Pengaturan Situs</CardTitle>
        <CardDescription>
          Judul, deskripsi, favicon, dan gambar preview yang tampil saat link dashboard dibagikan (mis. ke WhatsApp).
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-title" className="text-xs text-muted-foreground">
            Title
          </Label>
          <Input id="site-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="site-description" className="text-xs text-muted-foreground">
            Description
          </Label>
          <Textarea id="site-description" value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        </div>
        <ImageUploadField label="Favicon" path={faviconPath} kind="favicon" onUploaded={setFaviconPath} />
        <ImageUploadField
          label="Gambar Open Graph"
          caption="Gambar yang muncul saat link dashboard dibagikan, mis. ke WhatsApp."
          path={ogImagePath}
          kind="og-image"
          onUploaded={setOgImagePath}
        />
        {error && <p className="text-xs text-destructive">{error}</p>}
        <Button size="sm" className="self-end" disabled={pending} onClick={handleSave}>
          <Save className="size-3.5" />
          {pending ? "Menyimpan..." : "Simpan Pengaturan Situs"}
        </Button>
        {saved && !pending && <p className="text-right text-xs text-primary">Tersimpan.</p>}
      </CardContent>
    </Card>
  );
}
