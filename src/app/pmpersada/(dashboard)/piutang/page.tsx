// src/app/pmpersada/(dashboard)/piutang/page.tsx
// Isi halaman ada di HalamanPiutangEsBalok (dipakai bersama 3 PT Es Balok):
// bagian ringkasan dan tiap tab tampil bertahap lewat <Suspense>.
import type { Metadata } from "next";
import { requirePmpersadaKeuangan } from "@/lib/require-access";
import { HalamanPiutangEsBalok } from "@/components/dashboard/halaman-piutang-es-balok";
import {
  getPiutangPerAgenAction,
  getRingkasanPiutangTerbukaAction,
  getKomponenSelisihAction,
  getPiutangBayarContextAction,
  bayarPiutangAction,
  getPiutangTarikContextAction,
  tarikPiutangAction,
  getEsBalokPeriodSummaryAction,
  getEsBalokPembayaranByDateAction,
  setEsBalokCollectionTargetAction,
  removeEsBalokCollectionTargetAction,
} from "./actions";

export const metadata: Metadata = { title: "Piutang" };

export default async function PmpersadaPiutangPage() {
  await requirePmpersadaKeuangan();
  return (
    <HalamanPiutangEsBalok
      kode="pmpersada"
      aksi={{
        getPiutangPerAgenAction,
        getRingkasanPiutangTerbukaAction,
        getKomponenSelisihAction,
        getPiutangBayarContextAction,
        bayarPiutangAction,
        getPiutangTarikContextAction,
        tarikPiutangAction,
        getEsBalokPeriodSummaryAction,
        getEsBalokPembayaranByDateAction,
        setEsBalokCollectionTargetAction,
        removeEsBalokCollectionTargetAction,
      }}
    />
  );
}
