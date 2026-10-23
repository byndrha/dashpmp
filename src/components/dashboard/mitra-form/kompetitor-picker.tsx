"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxItem,
  ComboboxList,
  ComboboxValue,
  useComboboxAnchor,
} from "@/components/ui/combobox";
import type { ActionResult } from "@/lib/action-result";
import type { BisnisKompetitor, Kompetitor } from "@/lib/queries/kompetitor";

interface ItemValue {
  value: string;
  label: string;
}

/**
 * Multi-pilih kompetitor dari master per holding + [+] untuk menambah nama
 * baru ke master. Generik (Es Kristal, Es Balok, form pengajuan): opsi,
 * nilai, dan action tambah disuntikkan lewat props; `bisnis` diteruskan ke
 * onTambah supaya master tiap bisnis terpisah.
 */
export function KompetitorPicker({
  bisnis,
  opsi,
  onOpsiChange,
  value,
  onChange,
  onTambah,
  disabled = false,
}: {
  bisnis: BisnisKompetitor;
  opsi: Kompetitor[];
  // Dipanggil dengan daftar opsi baru setelah kompetitor ditambahkan.
  onOpsiChange: (opsi: Kompetitor[]) => void;
  value: number[];
  onChange: (ids: number[]) => void;
  onTambah: (bisnis: BisnisKompetitor, nama: string) => Promise<ActionResult<Kompetitor>>;
  disabled?: boolean;
}) {
  const anchor = useComboboxAnchor();
  const [formTambah, setFormTambah] = useState(false);
  const [namaBaru, setNamaBaru] = useState("");
  const [menambah, setMenambah] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);

  const items: ItemValue[] = useMemo(() => opsi.map((k) => ({ value: String(k.id), label: k.nama })), [opsi]);
  const dipilih = useMemo(() => {
    const ids = new Set(value.map(String));
    return items.filter((i) => ids.has(i.value));
  }, [items, value]);

  async function tambah() {
    const nama = namaBaru.trim();
    if (!nama) return;
    setGalat(null);
    setMenambah(true);
    try {
      const res = await onTambah(bisnis, nama);
      if (!res.success) {
        setGalat(res.error);
        return;
      }
      const k = res.data;
      if (!opsi.some((o) => o.id === k.id)) {
        onOpsiChange([...opsi, k].sort((a, b) => a.nama.localeCompare(b.nama, "id")));
      }
      if (!value.includes(k.id)) onChange([...value, k.id]);
      setNamaBaru("");
      setFormTambah(false);
    } finally {
      setMenambah(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-start gap-1">
        <Combobox
          multiple
          items={items}
          value={dipilih}
          onValueChange={(v: ItemValue[]) => onChange(v.map((i) => Number(i.value)))}
          disabled={disabled}
        >
          <ComboboxChips ref={anchor} className="min-h-8 flex-1">
            <ComboboxValue>
              {(vals: ItemValue[]) => (
                <>
                  {vals.map((i) => (
                    <ComboboxChip key={i.value}>{i.label}</ComboboxChip>
                  ))}
                  <ComboboxChipsInput placeholder={vals.length === 0 ? "Pilih kompetitor..." : ""} disabled={disabled} />
                </>
              )}
            </ComboboxValue>
          </ComboboxChips>
          <ComboboxContent anchor={anchor}>
            <ComboboxEmpty>Tidak ditemukan — tambahkan lewat tombol +.</ComboboxEmpty>
            <ComboboxList>
              {(i: ItemValue) => (
                <ComboboxItem key={i.value} value={i}>
                  {i.label}
                </ComboboxItem>
              )}
            </ComboboxList>
          </ComboboxContent>
        </Combobox>
        <Button
          type="button"
          variant="outline"
          size="icon"
          className="shrink-0"
          title={formTambah ? "Batal" : "Tambah kompetitor baru"}
          disabled={disabled}
          onClick={() => {
            setFormTambah((v) => !v);
            setGalat(null);
          }}
        >
          {formTambah ? <X className="size-4" /> : <Plus className="size-4" />}
        </Button>
      </div>
      {formTambah && (
        <div className="flex items-center gap-1">
          <Input
            autoFocus
            value={namaBaru}
            maxLength={128}
            placeholder="Nama kompetitor baru"
            onChange={(e) => setNamaBaru(e.target.value)}
            onKeyDown={(e) => {
              // Bersarang di dalam <form> mitra: Enter jangan men-submit form.
              if (e.key === "Enter") {
                e.preventDefault();
                void tambah();
              }
            }}
            className="h-8"
          />
          <Button type="button" size="sm" disabled={menambah || !namaBaru.trim()} onClick={() => void tambah()}>
            {menambah ? <Loader2 className="size-3.5 animate-spin" /> : "Tambah"}
          </Button>
        </div>
      )}
      {galat && <p className="text-[11px] text-destructive">{galat}</p>}
    </div>
  );
}
