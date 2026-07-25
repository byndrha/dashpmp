"use client";

import {
  Combobox,
  ComboboxInput,
  ComboboxContent,
  ComboboxList,
  ComboboxItem,
  ComboboxEmpty,
} from "@/components/ui/combobox";
import type { MitraOption } from "@/lib/queries/marketing-wilayah";

interface ItemValue {
  value: string;
  label: string;
  wilayah: string;
}

// Searchable Mitra picker (by BusinessPartnerID) — same Combobox pattern as
// WilayahSelect/KecamatanSelect, but `options` is passed in directly (a
// flat BusinessPartner list) rather than fetched per-keystroke, since
// there's no server-side hierarchy to page through here.
export function MitraSelect({
  options,
  value,
  onChange,
}: {
  options: MitraOption[];
  value: string;
  onChange: (businessPartnerId: string) => void;
}) {
  const items: ItemValue[] = options.map((o) => ({
    value: o.BusinessPartnerID,
    label: o.Name,
    wilayah: o.Wilayah,
  }));
  const selectedItem = items.find((i) => i.value === value) ?? null;

  return (
    <Combobox items={items} value={selectedItem} onValueChange={(item: ItemValue | null) => onChange(item?.value ?? "")}>
      <ComboboxInput placeholder="Cari mitra..." />
      <ComboboxContent>
        <ComboboxEmpty>Tidak ditemukan.</ComboboxEmpty>
        <ComboboxList>
          {(item: ItemValue) => (
            <ComboboxItem key={item.value} value={item}>
              <span className="min-w-0 truncate">{item.label}</span>
              <span className="shrink-0 text-xs text-muted-foreground">{item.wilayah}</span>
            </ComboboxItem>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}
