"use client";

import { MitraEsBalokHalaman, type AksiHalamanMitraEsBalok } from "@/components/dashboard/mitra-es-balok-halaman";
import type { MitraCard } from "@/lib/queries/mitra-es-balok";
import {
  simpanMitraLengkapEsBalokAction,
  jadikanLokasiUtamaEsBalokAction,
  tambahKompetitorEsBalokAction,
  getMitraFormKonteksEsBalokAction,
  getMitraCardEsBalokAction,
  setMitraSuspendedAction,
  deleteMitraAction,
} from "./actions";

const KODE = "pmpakis";

// Konstan level modul — dipakai sebagai dependensi efek di form.
const AKSI: AksiHalamanMitraEsBalok = {
  simpan: simpanMitraLengkapEsBalokAction,
  jadikanUtama: jadikanLokasiUtamaEsBalokAction,
  tambahKompetitor: tambahKompetitorEsBalokAction,
  konteks: getMitraFormKonteksEsBalokAction,
  muatKartu: getMitraCardEsBalokAction,
  setSuspended: setMitraSuspendedAction,
  hapus: deleteMitraAction,
};

export function MitraPageClient({ cards }: { cards: MitraCard[] }) {
  return <MitraEsBalokHalaman kode={KODE} cards={cards} aksi={AKSI} />;
}
