"use client";

import { useRef, useState } from "react";
import { Eye, Loader2, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type JenisBerkasIdentitas = "nik" | "sk";

export interface BerkasIdentitasNilai {
  ada: boolean;
  namaFile: string | null;
  mime: string | null;
}

const LABEL: Record<JenisBerkasIdentitas, string> = { nik: "Berkas NIK", sk: "Dokumen SK" };
const TIPE_DITERIMA = "image/jpeg,image/png,image/webp,application/pdf";
const MAKS_BYTE = 5 * 1024 * 1024;

// Unggah / Pratinjau / Hapus satu berkas identitas mitra lewat rute privat
// /api/mitra-berkas (sesi + izin dicek di server; client tidak pernah
// memegang file ID). Generik: dipakai Es Kristal (sumber "utama") dan
// Es Balok (kode fisik + sumber dari resolveAgenKoneksi) — tidak terikat MitraRow.
// Tanpa bolehLihat komponen ini tidak merender apa pun.
export function BerkasIdentitasField({
  jenis,
  kode,
  sumber,
  partnerId,
  nilai,
  bolehLihat,
  bolehUbah,
  onBerubah,
}: {
  jenis: JenisBerkasIdentitas;
  kode: string;
  sumber: "utama" | "logistik";
  // null = mitra belum tersimpan → unggah belum bisa.
  partnerId: string | null;
  nilai: BerkasIdentitasNilai;
  bolehLihat: boolean;
  bolehUbah: boolean;
  onBerubah: (nilai: BerkasIdentitasNilai) => void;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [proses, setProses] = useState<"unggah" | "hapus" | null>(null);
  const [galat, setGalat] = useState<string | null>(null);
  const [pratinjauGambar, setPratinjauGambar] = useState(false);
  // Pembeda URL setelah unggah ulang (rute baca memakai no-store, tetapi
  // <img> yang sama bisa tetap memakai salinan di memori browser).
  const [versi, setVersi] = useState(0);

  if (!bolehLihat) return null;

  if (!partnerId) {
    return <p className="text-[11px] text-muted-foreground">{LABEL[jenis]}: simpan mitra dahulu untuk mengunggah.</p>;
  }

  const url = `/api/mitra-berkas/${encodeURIComponent(kode)}/${sumber}/${encodeURIComponent(partnerId)}/${jenis}?v=${versi}`;
  const pdf = nilai.mime === "application/pdf" || (nilai.namaFile?.toLowerCase().endsWith(".pdf") ?? false);

  async function unggah(file: File) {
    setGalat(null);
    if (file.size > MAKS_BYTE) {
      setGalat("Ukuran berkas maksimal 5 MB.");
      return;
    }
    setProses("unggah");
    try {
      const fd = new FormData();
      fd.set("file", file);
      fd.set("kode", kode);
      fd.set("sumber", sumber);
      fd.set("partnerId", partnerId!);
      fd.set("jenis", jenis);
      const res = await fetch("/api/mitra-berkas", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; nama?: string; error?: string };
      if (!res.ok || !data.ok) {
        setGalat(data.error ?? "Gagal mengunggah berkas.");
        return;
      }
      setVersi((v) => v + 1);
      onBerubah({ ada: true, namaFile: data.nama ?? file.name, mime: file.type || null });
    } catch {
      setGalat("Gagal mengunggah berkas.");
    } finally {
      setProses(null);
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  async function hapus() {
    if (!confirm(`Hapus ${LABEL[jenis]}? Berkas akan dihapus permanen dari Google Drive.`)) return;
    setGalat(null);
    setProses("hapus");
    try {
      const q = new URLSearchParams({ kode, sumber, partnerId: partnerId!, jenis });
      const res = await fetch(`/api/mitra-berkas?${q.toString()}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setGalat(data.error ?? "Gagal menghapus berkas.");
        return;
      }
      onBerubah({ ada: false, namaFile: null, mime: null });
    } catch {
      setGalat("Gagal menghapus berkas.");
    } finally {
      setProses(null);
    }
  }

  function pratinjau() {
    // PDF di tab baru (dibuka langsung di handler klik agar tidak diblokir
    // pemblokir pop-up); gambar ditampilkan inline.
    if (pdf) window.open(url, "_blank", "noopener,noreferrer");
    else setPratinjauGambar(true);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex min-w-0 items-center gap-1">
        <span className="shrink-0 text-[11px] text-muted-foreground">{LABEL[jenis]}:</span>
        <span className="min-w-0 truncate text-[11px]" title={nilai.namaFile ?? undefined}>
          {nilai.ada ? (nilai.namaFile ?? "terunggah") : "belum ada"}
        </span>
        <div className="ml-auto flex shrink-0 items-center">
          {bolehUbah && (
            <>
              <input
                ref={inputRef}
                type="file"
                accept={TIPE_DITERIMA}
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void unggah(f);
                }}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-7"
                title={nilai.ada ? "Ganti berkas" : "Unggah"}
                disabled={proses !== null}
                onClick={() => inputRef.current?.click()}
              >
                {proses === "unggah" ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              </Button>
            </>
          )}
          {nilai.ada && (
            <Button type="button" variant="ghost" size="icon" className="size-7" title="Pratinjau" onClick={pratinjau}>
              <Eye className="size-3.5" />
            </Button>
          )}
          {nilai.ada && bolehUbah && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-7"
              title="Hapus"
              disabled={proses !== null}
              onClick={hapus}
            >
              {proses === "hapus" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Trash2 className="size-3.5 text-destructive" />
              )}
            </Button>
          )}
        </div>
      </div>
      {galat && <p className="text-[11px] text-destructive">{galat}</p>}

      <Dialog open={pratinjauGambar} onOpenChange={setPratinjauGambar}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>{LABEL[jenis]}</DialogTitle>
            <DialogDescription className="sr-only">Pratinjau berkas identitas mitra.</DialogDescription>
          </DialogHeader>
          {pratinjauGambar && (
            // eslint-disable-next-line @next/next/no-img-element -- berkas privat lewat rute ber-sesi, bukan aset statis
            <img src={url} alt={LABEL[jenis]} className="max-h-[75vh] w-full rounded-md object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
