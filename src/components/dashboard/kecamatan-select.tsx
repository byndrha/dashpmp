"use client";

import { useEffect, useState } from "react";
import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";

export interface KecamatanOption {
  code: string;
  name: string;
}

interface ItemValue {
  value: string;
  label: string;
}

// Reusable across any module — searchable dropdown of Kecamatan, dependent
// on a Kabupaten/Kota already having been picked in WilayahSelect (disabled,
// with an empty list, until `regencyCode` is provided).
export function KecamatanSelect({
  regencyCode,
  value,
  onChange,
}: {
  regencyCode: string | null;
  value: string;
  onChange: (name: string) => void;
}) {
  const [options, setOptions] = useState<KecamatanOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!regencyCode) {
      // Clears stale options from the previous Wilayah — not derived from
      // props/state during render since options are otherwise only ever
      // populated by the fetch below.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptions([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetch(`/api/wilayah/districts?regencyCode=${encodeURIComponent(regencyCode)}`)
      .then((res) => res.json())
      .then((data: KecamatanOption[]) => {
        if (!cancelled) setOptions(Array.isArray(data) ? data : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [regencyCode]);

  const disabled = !regencyCode;
  const items: ItemValue[] = options.map((o) => ({ value: o.code, label: o.name }));
  const selectedItem = items.find((i) => i.label.toLowerCase() === value.toLowerCase()) ?? null;

  return (
    <Combobox
      items={items}
      value={selectedItem}
      onValueChange={(item: ItemValue | null) => onChange(item?.label ?? "")}
      disabled={disabled}
    >
      <ComboboxInput
        placeholder={disabled ? "Pilih Wilayah dahulu" : loading ? "Memuat..." : "Cari kecamatan..."}
        disabled={disabled || loading}
      />
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
