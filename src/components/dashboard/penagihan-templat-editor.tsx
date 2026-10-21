"use client";

import { useRef } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { MAKS_PANJANG_TEMPLAT, renderTemplat, TEMPLAT_AWAL, validasiTemplat, VARIABEL_TEMPLAT, type NilaiTemplat } from "@/lib/penagihan/templat";

// Editor redaksi pesan penagihan: kolom teks, tombol penyisip variabel, dan
// pratinjau langsung memakai data contoh. Dipakai di tab "Penagihan ByChat".
export function PenagihanTemplatEditor({
  value,
  onChange,
  contoh,
  mitraAsli,
}: {
  value: string;
  onChange: (v: string) => void;
  contoh: NilaiTemplat;
  mitraAsli: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const galat = validasiTemplat(value);

  function sisipkan(nama: string) {
    const el = ref.current;
    const awal = el?.selectionStart ?? value.length;
    const akhir = el?.selectionEnd ?? value.length;
    const token = `{${nama}}`;
    onChange(value.slice(0, awal) + token + value.slice(akhir));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(awal + token.length, awal + token.length);
    });
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs" htmlFor="templat_pesan">
          Redaksi pesan (menyertai gambar kartu piutang)
        </Label>
        <Button type="button" size="sm" variant="outline" disabled={value === TEMPLAT_AWAL} onClick={() => onChange(TEMPLAT_AWAL)}>
          Kembalikan ke bawaan
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-muted-foreground">Sisipkan:</span>
        {VARIABEL_TEMPLAT.map((v) => (
          <Button key={v.nama} type="button" size="sm" variant="secondary" title={v.keterangan} onClick={() => sisipkan(v.nama)}>
            {`{${v.nama}}`}
          </Button>
        ))}
      </div>
      <Textarea
        id="templat_pesan"
        ref={ref}
        rows={10}
        value={value}
        maxLength={MAKS_PANJANG_TEMPLAT}
        aria-invalid={galat != null}
        onChange={(e) => onChange(e.target.value)}
        className="font-mono text-xs"
      />
      {galat ? (
        <p className="text-xs text-destructive">{galat}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          Baris yang memuat variabel kosong (mis. {"{rekening}"} bila PT belum punya rekening) otomatis tidak ditampilkan. {value.length}/{MAKS_PANJANG_TEMPLAT} karakter.
        </p>
      )}
      <div className="flex flex-col gap-1">
        <Label className="text-xs">Pratinjau</Label>
        <pre className="whitespace-pre-wrap rounded-md border bg-muted/40 p-3 text-xs">{galat ? "—" : renderTemplat(value, contoh)}</pre>
        <p className="text-xs text-muted-foreground">
          PT, tanggal, dan rekening diambil dari data sungguhan.{" "}
          {mitraAsli ? "Mitra, total, dan jumlah faktur dari mitra pertama di ronde hari ini." : "Mitra, total, dan jumlah faktur masih contoh (belum ada ronde hari ini)."}{" "}
          Tautan kartu dibuat saat pesan dikirim.
        </p>
      </div>
    </div>
  );
}
