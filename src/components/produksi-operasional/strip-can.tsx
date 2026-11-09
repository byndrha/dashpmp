// Strip can satu baris (satu sel per slot) untuk daftar rek yang rapat.
// Ringan: hanya <span> berwarna, tanpa interaksi dan tanpa simbol.

import { memo } from "react";
import { cn } from "@/lib/utils";
import type { KeadaanCan } from "@/lib/produksi-operasional";
import { warnaCan } from "./warna-tahap";

export const StripCan = memo(function StripCan({ can, className }: { can: KeadaanCan[]; className?: string }) {
  return (
    <span className={cn("flex h-4 min-w-0 gap-px", className)} aria-hidden>
      {can.map((c) => (
        <span key={c.slot} className={cn("min-w-0 flex-1 rounded-[1px] border", warnaCan(c).sel)} />
      ))}
    </span>
  );
});
