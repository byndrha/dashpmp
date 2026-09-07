import { getShiftLabel, getShiftWindow, getPreviousShift, getReportShift, type ShiftNumber } from "@/lib/report-shift";
import { getAktivitasForShift, getQtyRecapForShift, hitungTotalDenda } from "@/lib/queries/aktivitas-produksi";
import { getStokBahanBakuHistory, type StokBahanBakuRow } from "@/lib/queries/stok-bahan-baku";
import { getKasKecilShiftForTanggalShift, type KasKecilShiftRow } from "@/lib/queries/kas-kecil";
import { getMesinEventsForShift, getMesinStateAwalShift, type MesinEventRow, type JenisMesinEvent } from "@/lib/queries/produksi-mesin-event";
import { getMesinList, getMesinCounterUntukShift, type MesinRow, type MesinCounterRow } from "@/lib/queries/produksi-mesin";
import { getKartuPengirimanUntukShift, getRekapPerDriverUntukHari, type KartuPengirimanRow, type RekapDriverRow } from "@/lib/queries/laporan-shift-pengiriman";
import { getBbmUntukShift, type BbmShiftRow } from "@/lib/queries/driver-fuel";
import { getSnapshotStokEs, hitungTotalSisaStokEsLive } from "@/lib/queries/laporan-shift-stok-es-snapshot";
import { getAllTim } from "@/lib/queries/tim-produksi";
import { getAkunNamaMap } from "@/lib/queries/akun";

export interface StokEsInfo {
  stokAwal: number | null; // null when the previous shift has no snapshot yet
  stokAkhir: number;
  stokAkhirFinal: boolean; // false when this is the currently-running shift (live figure)
}

export interface LaporanShiftDetail {
  tanggalUsaha: string;
  shift: ShiftNumber;
  shiftLabel: string;
  timId: number | null;
  timNama: string | null;
  stafOperasionalAkunId: number | null;
  stafOperasionalNama: string | null;
  stokBahanBaku: StokBahanBakuRow[];
  kartuPengiriman: KartuPengirimanRow[];
  bbm: BbmShiftRow[];
  kasKecil: KasKecilShiftRow | null;
  produksiKantongEkivalen: number;
  produksiTotalDenda: number;
  produksiTotal5KG: number; // shift-wide Qty5KGDimuat total — NOT attributable to any single mesin, see getQtyRecapForShift's own comment
  // Kerusakan (pecah kemasan/es jatuh/ganti retur/sealer jebol) and the
  // denda they produce are recorded ONCE per (TanggalUsaha, Shift) on
  // DashboardAktivitasProduksiShift -- no MesinID column exists on that
  // table at all, so this is genuinely a whole-shift/team responsibility
  // (Staf Operasional + Tim Produksi), never attributable to one mesin.
  kerusakan: {
    pecahKemasanQty: number;
    esJatuhQty: number;
    gantiReturnQty: number;
    sealerJebolQty: number;
  };
  mesinList: MesinRow[];
  mesinEvents: MesinEventRow[];
  mesinCounter: MesinCounterRow[];
  // On/Off state each mesin carried INTO this shift's window start (keyed by
  // MesinID) — a mesin absent here has no recorded event history at all and
  // should be treated as "Off". See getMesinStateAwalShift's own comment.
  mesinStateAwalShift: Record<number, JenisMesinEvent>;
  stokEs: StokEsInfo;
  perusahaanId: number;
  rekapPerDriver: RekapDriverRow[];
}

// hitungLimitHistori mirrors laporan-ringkasan-lintas-shift.ts's own helper
// (same reasoning: getStokBahanBakuHistory's `limit` caps a TOP-N window,
// so a shift far enough in the past needs a correspondingly large limit to
// guarantee it's still inside that window) -- duplicated here rather than
// imported since laporan-ringkasan-lintas-shift.ts's version is private
// (not exported) and this is a handful of lines.
function hitungLimitHistori(tanggalUsaha: string, maxBarisPerHari: number): number {
  const targetDate = new Date(`${tanggalUsaha}T00:00:00Z`);
  const sekarang = new Date();
  const hariMundur = Math.max(0, Math.ceil((sekarang.getTime() - targetDate.getTime()) / 86_400_000));
  return (hariMundur + 7) * maxBarisPerHari;
}

export async function getLaporanShiftDetail(tanggalUsaha: string, shift: ShiftNumber, perusahaanId: number): Promise<LaporanShiftDetail> {
  const previous = getPreviousShift(tanggalUsaha, shift);
  const { shift: shiftBerjalan, businessDate: businessDateBerjalan } = getReportShift("work");
  const tanggalUsahaBerjalan = businessDateBerjalan.toISOString().slice(0, 10);
  const isShiftBerjalan = tanggalUsaha === tanggalUsahaBerjalan && shift === shiftBerjalan;
  // getMesinEventsForShift takes (businessDate: Date, shift), not
  // (tanggalUsaha: string, shift) like every other function called below --
  // matching its existing real signature (produksi-mesin-event.ts).
  const businessDateUntukMesinEvent = new Date(`${tanggalUsaha}T00:00:00Z`);
  const shiftWindow = getShiftWindow(businessDateUntukMesinEvent, shift, "work");

  const [
    stokBahanBakuHistory,
    kartuPengiriman,
    bbm,
    kasKecil,
    aktivitas,
    qtyRecap,
    mesinList,
    mesinEvents,
    mesinCounter,
    mesinStateAwalShift,
    snapshotAkhir,
    snapshotAwal,
    timList,
    rekapPerDriver,
  ] = await Promise.all([
    getStokBahanBakuHistory(hitungLimitHistori(tanggalUsaha, 9)), // 3 JenisBarang x 3 shift
    getKartuPengirimanUntukShift(tanggalUsaha, shift, perusahaanId),
    getBbmUntukShift(tanggalUsaha, shift),
    getKasKecilShiftForTanggalShift(tanggalUsaha, shift),
    getAktivitasForShift(tanggalUsaha, shift),
    getQtyRecapForShift(tanggalUsaha, shift),
    getMesinList(),
    getMesinEventsForShift(businessDateUntukMesinEvent, shift),
    getMesinCounterUntukShift(tanggalUsaha, shift),
    getMesinStateAwalShift(shiftWindow.start),
    isShiftBerjalan ? Promise.resolve(null) : getSnapshotStokEs(tanggalUsaha, shift),
    getSnapshotStokEs(previous.tanggalUsaha, previous.shift),
    getAllTim(),
    getRekapPerDriverUntukHari(tanggalUsaha),
  ]);

  const stokBahanBaku = stokBahanBakuHistory.filter((r) => r.tanggalUsaha === tanggalUsaha && r.shift === shift);

  const stokAkhir = isShiftBerjalan ? await hitungTotalSisaStokEsLive() : (snapshotAkhir ?? (await hitungTotalSisaStokEsLive()));

  // Staf-name resolution depends on aktivitas.stafOperasionalAkunId, which
  // only exists once aktivitas itself has resolved above, so this can't
  // join the Promise.all batch.
  const timNama = aktivitas.timId != null ? (timList.find((t) => t.timId === aktivitas.timId)?.nama ?? null) : null;
  const stafNamaMap = await getAkunNamaMap(aktivitas.stafOperasionalAkunId != null ? [aktivitas.stafOperasionalAkunId] : []);
  const stafOperasionalNama = aktivitas.stafOperasionalAkunId != null ? (stafNamaMap.get(aktivitas.stafOperasionalAkunId) ?? null) : null;

  return {
    tanggalUsaha,
    shift,
    shiftLabel: getShiftLabel(shift, "work"),
    timId: aktivitas.timId,
    timNama,
    stafOperasionalAkunId: aktivitas.stafOperasionalAkunId,
    stafOperasionalNama,
    stokBahanBaku,
    kartuPengiriman,
    bbm,
    kasKecil,
    produksiKantongEkivalen: qtyRecap.totalKantongEkivalen,
    produksiTotalDenda: hitungTotalDenda(aktivitas.pecahKemasanQty, aktivitas.esJatuhQty),
    produksiTotal5KG: qtyRecap.total5KG,
    kerusakan: {
      pecahKemasanQty: aktivitas.pecahKemasanQty,
      esJatuhQty: aktivitas.esJatuhQty,
      gantiReturnQty: aktivitas.gantiReturnQty,
      sealerJebolQty: aktivitas.sealerJebolQty,
    },
    mesinList,
    mesinEvents,
    mesinCounter,
    mesinStateAwalShift,
    stokEs: {
      stokAwal: snapshotAwal,
      stokAkhir,
      stokAkhirFinal: !isShiftBerjalan && snapshotAkhir != null,
    },
    perusahaanId,
    rekapPerDriver,
  };
}
