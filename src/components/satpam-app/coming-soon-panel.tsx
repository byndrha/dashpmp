import { Construction } from "lucide-react";

// Placeholder generik untuk tab yang kontennya belum dibangun (Patroli,
// Tamu) — sub-proyek terpisah nanti akan mengganti pemanggil ComingSoonPanel
// dengan panel sungguhan, komponen ini sendiri tidak perlu diubah saat itu.
export function ComingSoonPanel({ title }: { title: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <Construction className="size-10 text-muted-foreground" />
      <p className="font-display text-base font-semibold">Fitur {title} segera hadir.</p>
    </div>
  );
}
