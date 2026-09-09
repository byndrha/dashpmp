import type { Metadata } from "next";
import { requireSatpamRosterManager } from "@/lib/require-access";
import { getSatpamAkunOptions } from "@/lib/queries/akun";
import { getSatpamJadwalJagaList } from "@/lib/queries/satpam-jadwal-jaga";
import { SatpamRosterPanel } from "@/components/dashboard/satpam-roster-panel";
import { KeamananShiftView } from "@/components/dashboard/keamanan-shift-view";
import { getNaiveWibNow } from "@/lib/business-date";
import { getCurrentSatpamShift, SATPAM_SHIFT_LABEL } from "@/lib/satpam-shift";
import { getInspeksiUntukShift } from "@/lib/queries/satpam-inspeksi-shift";
import { getPatroliUntukShift } from "@/lib/queries/satpam-patroli";
import { getTamuUntukShift } from "@/lib/queries/satpam-tamu";

export const metadata: Metadata = { title: "Keamanan" };

// Senin minggu berjalan (WIB) -- getUTCDay() 0=Minggu..6=Sabtu, jarak
// mundur ke Senin adalah (getUTCDay()+6)%7 hari. Dibangun via Date.UTC
// component arithmetic saja, mengikuti konvensi naive-WIB seluruh app ini.
function currentWeekRangeISO(): { start: string; end: string } {
  const wibNow = getNaiveWibNow();
  const dayOfWeek = wibNow.getUTCDay();
  const backToMonday = (dayOfWeek + 6) % 7;
  const y = wibNow.getUTCFullYear();
  const m = wibNow.getUTCMonth();
  const d = wibNow.getUTCDate();
  const monday = new Date(Date.UTC(y, m, d - backToMonday));
  const sunday = new Date(Date.UTC(y, m, d - backToMonday + 6));
  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) };
}

export default async function KeamananPage() {
  await requireSatpamRosterManager();
  const range = currentWeekRangeISO();
  const todayISO = getNaiveWibNow().toISOString().slice(0, 10);
  const { tanggalUsaha, shiftType } = getCurrentSatpamShift();
  const tanggalUsahaISO = tanggalUsaha.toISOString().slice(0, 10);

  const [satpamOptions, rows, petugasShiftIni, inspeksi, patroli, tamu] = await Promise.all([
    getSatpamAkunOptions(),
    getSatpamJadwalJagaList(new Date(range.start), new Date(range.end)),
    getSatpamJadwalJagaList(tanggalUsaha, tanggalUsaha),
    getInspeksiUntukShift(tanggalUsaha, shiftType),
    getPatroliUntukShift(tanggalUsaha, shiftType),
    getTamuUntukShift(tanggalUsaha, shiftType),
  ]);

  const petugasShiftTerpilih = {
    tanggalUsahaISO,
    shiftLabel: SATPAM_SHIFT_LABEL[shiftType],
    nama: petugasShiftIni.filter((r) => r.shiftType === shiftType).map((r) => r.satpamNama),
  };

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-xl font-bold">Keamanan</h1>
      <KeamananShiftView
        initialTanggalUsaha={tanggalUsahaISO}
        initialShiftType={shiftType}
        initialInspeksi={inspeksi}
        initialPatroli={patroli}
        initialTamu={tamu}
      />
      <div>
        <h2 className="mb-3 font-display text-lg font-semibold">Roster Shift Satpam</h2>
        <SatpamRosterPanel
          initialRows={rows}
          satpamOptions={satpamOptions}
          initialRange={range}
          todayISO={todayISO}
          petugasShiftTerpilih={petugasShiftTerpilih}
        />
      </div>
    </div>
  );
}
