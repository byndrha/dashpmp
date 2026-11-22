import type { Metadata } from "next";
import { requirePmputra } from "@/lib/require-access";
import { HalamanListrik } from "@/components/listrik/halaman-listrik";

// Rute statis ini mengalahkan placeholder [modul] untuk "listrik".
export const metadata: Metadata = { title: "Kelistrikan" };

export default async function PmputraListrikPage() {
  await requirePmputra();
  return (
    <div className="flex flex-col gap-4">
      <HalamanListrik kode="pmputra" />
    </div>
  );
}
