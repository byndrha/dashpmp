import { Skeleton } from "@/components/ui/skeleton";

// Kerangka (skeleton) bersama untuk loading.tsx semua dashboard: meniru
// susunan umum halaman (judul + filter, deretan KPI, panel besar) supaya
// pengguna langsung mendapat gambaran struktur halaman (NN/g: skeleton
// untuk muat halaman penuh < 10 detik; spinner hanya untuk satu modul).
// Ditunda 150 ms lewat animasi masuk supaya muatan yang sangat cepat tidak
// "berkedip".
export function MemuatHalaman() {
  return (
    <div
      className="flex flex-col gap-4 motion-safe:animate-in motion-safe:fade-in-0 motion-safe:delay-150 motion-safe:duration-300 motion-safe:fill-mode-backwards"
      aria-busy="true"
      aria-label="Memuat halaman"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-7 w-40 rounded-md" />
        <Skeleton className="h-9 w-64 rounded-lg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 w-full rounded-xl" />
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
