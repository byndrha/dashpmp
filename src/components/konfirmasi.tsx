"use client";

// Pengganti window.confirm() bawaan peramban: dialog bergaya aplikasi yang
// dipanggil sebagai fungsi biasa —
//
//   if (!(await konfirmasi(`Hapus armada "${nama}"?`))) return;
//
// Kalimat pertama (sampai "?" / "." pertama) menjadi judul, sisanya
// keterangan. Kata kerja di awal kalimat ("Hapus", "Nonaktifkan", ...)
// menjadi label tombol, dan tindakan merusak diberi tombol merah — sesuai
// pedoman NN/g: dialog konfirmasi harus menyebut tindakan yang spesifik,
// bukan sekadar "OK/Batal". Satu <PenampilKonfirmasi /> dipasang di
// Providers (components/providers.tsx).
import { useSyncExternalStore } from "react";
import { AlertTriangle, HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

export interface OpsiKonfirmasi {
  judul?: string;
  keterangan?: string;
  tombol?: string; // label tombol setuju
  bahaya?: boolean; // tombol merah
}

interface Permintaan extends Required<Pick<OpsiKonfirmasi, "judul" | "tombol" | "bahaya">> {
  keterangan?: string;
  selesai: (ok: boolean) => void;
}

// Kata kerja → [label tombol, merusak?]
const KATA_KERJA: [RegExp, string, boolean][] = [
  [/^hapus\b/i, "Hapus", true],
  [/^nonaktifkan\b/i, "Nonaktifkan", true],
  [/^keluarkan\b/i, "Keluarkan", true],
  [/^batalkan\b/i, "Batalkan", true],
  [/^putuskan\b/i, "Putuskan", true],
  [/^jadikan\b/i, "Jadikan", false],
];

function uraikan(pesan: string): { judul: string; keterangan?: string } {
  const m = /^(.+?[?.!])(\s+[\s\S]*)?$/.exec(pesan.trim());
  if (!m) return { judul: pesan.trim() };
  const sisa = m[2]?.trim();
  return { judul: m[1], keterangan: sisa || undefined };
}

let antrian: Permintaan | null = null;
const pendengar = new Set<() => void>();
function beri() {
  for (const p of pendengar) p();
}

export function konfirmasi(pesan: string, opsi: OpsiKonfirmasi = {}): Promise<boolean> {
  const { judul, keterangan } = uraikan(pesan);
  const cocok = KATA_KERJA.find(([re]) => re.test(pesan.trim()));
  return new Promise((resolve) => {
    // Permintaan sebelumnya yang belum dijawab dianggap batal.
    antrian?.selesai(false);
    antrian = {
      judul: opsi.judul ?? judul,
      keterangan: opsi.keterangan ?? keterangan,
      tombol: opsi.tombol ?? cocok?.[1] ?? "Lanjutkan",
      bahaya: opsi.bahaya ?? cocok?.[2] ?? false,
      selesai: (ok) => {
        antrian = null;
        beri();
        resolve(ok);
      },
    };
    beri();
  });
}

function langganan(cb: () => void) {
  pendengar.add(cb);
  return () => pendengar.delete(cb);
}

export function PenampilKonfirmasi() {
  const p = useSyncExternalStore(
    langganan,
    () => antrian,
    () => null
  );
  const Ikon = p?.bahaya ? AlertTriangle : HelpCircle;
  return (
    <Dialog open={p != null} onOpenChange={(o) => !o && p?.selesai(false)}>
      <DialogContent className="sm:max-w-sm" showCloseButton={false}>
        {p && (
          <>
            <DialogHeader>
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "flex size-9 shrink-0 items-center justify-center rounded-full",
                    p.bahaya ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"
                  )}
                >
                  <Ikon className="size-4.5" />
                </span>
                <div className="flex min-w-0 flex-col gap-1.5 text-left">
                  <DialogTitle className="leading-snug">{p.judul}</DialogTitle>
                  {p.keterangan && (
                    <DialogDescription className="whitespace-pre-line">{p.keterangan}</DialogDescription>
                  )}
                </div>
              </div>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => p.selesai(false)}>
                Batal
              </Button>
              <Button variant={p.bahaya ? "destructive" : "default"} onClick={() => p.selesai(true)} autoFocus>
                {p.tombol}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
