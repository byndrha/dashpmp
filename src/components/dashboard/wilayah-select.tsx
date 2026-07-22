"use client";

import { useEffect, useRef, useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

export interface WilayahOption {
  code: string;
  name: string;
}

interface ItemValue {
  value: string;
  label: string;
}

// Reusable across any module (not just Mitra) — searchable dropdown of all
// Kabupaten/Kota in Indonesia, backed by /api/wilayah/regencies.
export function WilayahSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (name: string, regencyCode: string | null) => void;
}) {
  const [options, setOptions] = useState<WilayahOption[]>([]);
  const [loading, setLoading] = useState(true);
  const lastResolvedName = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/wilayah/regencies")
      .then((res) => res.json())
      .then((data: WilayahOption[]) => {
        if (!cancelled) setOptions(data);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Resolves a plain-text value (from editing an existing record, or from
  // reverse-geocoding) to its canonical regencyCode once the list loads —
  // so callers don't each have to duplicate this name->code lookup just to
  // know which Kecamatan list to fetch.
  useEffect(() => {
    if (!value || options.length === 0 || lastResolvedName.current === value) return;
    const match = options.find((o) => o.name.toLowerCase() === value.toLowerCase());
    if (match) {
      lastResolvedName.current = match.name;
      onChange(match.name, match.code);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options, value]);

  const items: ItemValue[] = options.map((o) => ({ value: o.code, label: o.name }));
  const selectedItem = items.find((i) => i.label.toLowerCase() === value.toLowerCase()) ?? null;

  return (
    <Combobox
      items={items}
      value={selectedItem}
      onValueChange={(item: ItemValue | null) => {
        const opt = item ? options.find((o) => o.code === item.value) : null;
        lastResolvedName.current = opt?.name ?? null;
        onChange(opt?.name ?? "", opt?.code ?? null);
      }}
    >
      <ComboboxInput placeholder={loading ? "Memuat..." : "Cari kabupaten/kota..."} disabled={loading} />
      <ComboboxContent>
        <ComboboxEmpty>Tidak ditemukan.</ComboboxEmpty>
        <ComboboxList>
          {(item: ItemValue) => (
            <ComboboxItem key={item.value} value={item}>
              {item.label}
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
