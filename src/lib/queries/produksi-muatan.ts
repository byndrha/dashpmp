import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import { getBusinessDateISO, naiveWibToUtcInstant } from "@/lib/business-date";
import {
  startMuat,
  selesaiMuat,
  assertJadwalReadyForMuat,
  JADWAL_KANTONG_10KG_EXPR,
  JADWAL_KANTONG_5KG_EXPR,
} from "@/lib/queries/pengiriman-jadwal";
import { getShiftWindow, type ShiftNumber } from "@/lib/report-shift";

// Same 14:00 WIB rollover rule as the rest of the app (business-date.ts) —
// a card whose own JamJadwal falls in today's business-date window or
// later is "current", everything before that is "riwayat" (previous
// period). JamJadwal is written by this dashboard's own create-Jadwal flow
// (true UTC, not the naive-WIB TransDate-style landmine some ERP-written
// columns have elsewhere), so a plain getBusinessDateISO() comparison is
// safe here.
function isCurrentOrFuturePeriod(jamJadwal: Date): boolean {
  return getBusinessDateISO(new Date(jamJadwal)) >= getBusinessDateISO();
}

export interface DraftJadwalForProduksi {
  JadwalID: number;
  ArmadaNama: string;
  JamJadwal: Date;
  // Set once produksiStartMuat (below) has run for this card — the UI uses
  // this to skip straight to the alokasi screen (instead of showing "Mulai
  // Muat" again) when the operator re-opens a card they already started,
  // e.g. after backing out mid-flow or reloading the app.
  JamMulaiMuat: Date | null;
  Qty10KGDibutuhkan: number;
  Qty5KGDibutuhkan: number;
}

// Every Jadwal still in Draft — both not-yet-started (JamMulaiMuat NULL)
// and started-but-not-finished (JamMulaiMuat set, still Draft because
// produksiSelesaiMuat/selesaiMuat hasn't run yet). A row only leaves this
// list once selesaiMuat flips Status to 'Terbit'. Keeping started-but-
// unfinished rows here (rather than filtering them out once JamMulaiMuat is
// set) matters because the 2-step "Mulai Muat" -> alokasi flow is otherwise
// unreachable again if the operator backs out or reloads mid-flow.
//
// Deliberately NOT restricted to a single business date: a Draft Jadwal
// that ages out of "today" without being filled must still be reachable
// here, since the desktop "Mulai Muat" button is only a fallback now (see
// route-validation-dialog.tsx) — produksi-app is the primary path. Ordered
// newest-scheduled-first (most recently added keberangkatan on top) per
// user request — older backlog Drafts stay in the list, just lower down.
// Unfiltered — every Draft regardless of period. Used where a card must be
// found/validated by ID no matter which of the two tabs it's actually
// showing in (produksiStartMuatAction/produksiSelesaiMuatAction), not for
// rendering either list directly.
export async function getAllDraftJadwalForProduksi(): Promise<DraftJadwalForProduksi[]> {
  return fetchAllDraftJadwalForProduksi();
}

async function fetchAllDraftJadwalForProduksi(): Promise<DraftJadwalForProduksi[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamMulaiMuat,
           ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
           ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
    FROM DashboardPengirimanJadwal j
    LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
    LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
    LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
    WHERE j.IsDeleted = 0 AND j.Status = 'Draft'
    GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamMulaiMuat
    ORDER BY j.JamJadwal DESC
  `);
  return result.recordset;
}

// Pengiriman tab — today's business-date period and any future one. A
// Draft that ages out of "today" doesn't disappear, it moves to the
// Riwayat tab below (still fully actionable there — see
// getDraftJadwalRiwayatForProduksi), so total reachability is unchanged
// from before this split, just re-partitioned.
export async function getDraftJadwalForProduksi(): Promise<DraftJadwalForProduksi[]> {
  const all = await fetchAllDraftJadwalForProduksi();
  return all.filter((r) => isCurrentOrFuturePeriod(r.JamJadwal));
}

export interface SelesaiMuatJadwalForProduksi {
  JadwalID: number;
  ArmadaNama: string;
  JamJadwal: Date;
  JamSelesaiMuat: Date;
  Qty10KG: number;
  Qty5KG: number;
  // Angka 5kg yang benar-benar dicatat operator saat Isi Muatan (lewat
  // field "Qty 5kg dimuat"), berbeda dari Qty5KG di atas (yang dari
  // JADWAL_KANTONG_5KG_EXPR -- kebutuhan pesanan pelanggan, bukan yang
  // sungguh dimuat). null untuk Jadwal lama sebelum kolom ini ada, atau
  // yang diselesaikan lewat jalur manual (produksiSelesaiMuatManual) yang
  // tidak pernah melalui alokasi pallet sama sekali.
  Qty5KGDimuat: number | null;
}

// Explicit "Mulai Muat" step — stamps JamMulaiMuat with no pallet allocation
// yet (that happens next, in produksiSelesaiMuat below). Thin re-export of
// the existing delivery-flow startMuat so produksi-app's action layer only
// ever imports from this produksi-domain module, matching every other
// produksi-muatan export.
export async function produksiStartMuat(jadwalId: number): Promise<void> {
  await assertJadwalReadyForMuat(jadwalId);
  await startMuat(jadwalId);
}

// Quick "Selesai Muat" shortcut — same underlying Draft->Terbit transition
// (DeliveryOrder/SalesInvoice creation, driver/route/capacity validation) as
// produksiSelesaiMuat below, but skips pallet allocation entirely: no Stok
// Es input, no DashboardProduksiBatch stock deduction. For operators who
// already know the loading is done and don't need per-pallet tracking for
// this keberangkatan. Thin re-export of the existing delivery-flow
// selesaiMuat, same pattern as produksiStartMuat above.
export async function produksiSelesaiMuatManual(jadwalId: number): Promise<void> {
  await assertJadwalReadyForMuat(jadwalId);
  await selesaiMuat(jadwalId);
}

export interface MuatanAlokasi {
  batchId: number;
  qty10KG: number;
}

export interface ProduksiSelesaiMuatInput {
  jadwalId: number;
  alokasi: MuatanAlokasi[];
  // Kantong 5kg tidak lagi dialokasikan per-pallet -- diproses langsung
  // tanpa FIFO, jadi cukup satu angka per Kartu Pengiriman, terpisah dari
  // alokasi 10kg di atas. Disimpan ke DashboardPengirimanJadwal.Qty5KGDimuat,
  // bukan DashboardProduksiMuatanDetail.
  qty5KGDimuat: number;
  dicatatOlehAkunId: number;
}

// Allocates pallet stock (10kg only) to the Jadwal, records the separate
// 5kg-loaded figure, then completes the real "Selesai Muat" transition
// (driver/route/capacity-validated, creates real DeliveryOrder + SalesInvoice
// documents) — the produksi-app equivalent of desktop's "Selesai Muat"
// button. Requires produksiStartMuat to already have been called for this
// jadwalId (enforced by the UI flow: the alokasi screen only ever opens
// after "Mulai Muat" succeeds), not re-checked here since selesaiMuat below
// doesn't need JamMulaiMuat itself.
export async function produksiSelesaiMuat(input: ProduksiSelesaiMuatInput): Promise<void> {
  if (input.alokasi.length === 0 && input.qty5KGDimuat <= 0) {
    throw new AppError("Pilih minimal satu pallet 10kg atau isi jumlah kantong 5kg yang dimuat.");
  }
  // Checked BEFORE any pallet stock is touched below — selesaiMuat() at the
  // end of this function enforces the same Driver/rute precondition, but by
  // then the pallet-consumption transaction has already committed. See
  // assertJadwalReadyForMuat's own comment.
  await assertJadwalReadyForMuat(input.jadwalId);

  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    for (const item of input.alokasi) {
      if (item.qty10KG < 0) {
        throw new AppError("Jumlah yang diambil tidak boleh negatif.");
      }

      await new sql.Request(transaction)
        .input("jadwalId", sql.Int, input.jadwalId)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .input("akunId", sql.Int, input.dicatatOlehAkunId)
        .query(`
          INSERT INTO DashboardProduksiMuatanDetail (JadwalID, BatchID, Qty10KGDiambil, DicatatOlehAkunID)
          VALUES (@jadwalId, @batchId, @qty10, @akunId)
        `);

      // Atomic claim: the WHERE clause encodes both "batch exists" and
      // "enough stock remains" as one condition, so the row's exclusive
      // lock (held until commit/rollback, unlike a plain SELECT's shared
      // lock) prevents two concurrent allocations from both succeeding
      // against stock that can only cover one of them.
      const claim = await new sql.Request(transaction)
        .input("batchId", sql.Int, item.batchId)
        .input("qty10", sql.Int, item.qty10KG)
        .query(`
          UPDATE DashboardProduksiBatch
          SET SisaQty10KG = SisaQty10KG - @qty10, ModifiedDate = GETDATE()
          OUTPUT INSERTED.SisaQty10KG
          WHERE BatchID = @batchId AND SisaQty10KG >= @qty10
        `);
      if (claim.recordset.length === 0) {
        throw new AppError("Jumlah yang diambil melebihi sisa stok pallet ini.");
      }
      // Tidak ada lagi langkah "null-kan BatchIDAktif kalau sisa 0" --
      // kolom itu sudah dihapus (Task 0). Status "kosong" sekarang murni
      // hasil agregasi (lihat getWarehouseMap), tidak perlu ditulis ulang
      // di sini.
    }

    await new sql.Request(transaction)
      .input("jadwalId", sql.Int, input.jadwalId)
      .input("qty5", sql.Int, input.qty5KGDimuat)
      .query(`UPDATE DashboardPengirimanJadwal SET Qty5KGDimuat = @qty5 WHERE JadwalID = @jadwalId`);

    await transaction.commit();
  } catch (err) {
    await transaction.rollback();
    throw err;
  }

  // selesaiMuat is the existing, unmodified delivery-flow function
  // (src/lib/queries/pengiriman-jadwal.ts) — deliberately called AFTER the
  // pallet-consumption transaction above commits, not inside it, because
  // selesaiMuat opens its own pool.request()/sql.Transaction and does not
  // accept an external one. Unlike the old startMuat call this replaces,
  // selesaiMuat is NOT trivial — it validates driver/route/capacity and
  // creates real DeliveryOrder + SalesInvoice documents, so it can
  // genuinely reject (AppError) after pallet stock has already been
  // committed. Accepted trade-off, unchanged from before this task.
  await selesaiMuat(input.jadwalId);
}

// Layar Riwayat baru (menggantikan tab Pengiriman/Riwayat lama) — "Belum
// Selesai" untuk satu periode kerja (tanggal usaha + shift) eksplisit,
// bukan cuma "sekarang" vs "sebelumnya". getShiftWindow mengembalikan Date
// ber-representasi naive-WIB, TAPI j.JamJadwal adalah instant true-UTC asli
// (dikonfirmasi lewat commit 0b2fe85, "fix: reconcile JamJadwal (true UTC)
// vs TransDate (naive WIB) comparisons", serta lewat fungsi hourFraction di
// pengiriman-board.tsx yang memakai getter .getHours()/.getMinutes() LOCAL
// timezone untuk menampilkan JamJadwal -- benar hanya jika nilainya memang
// true-UTC asli) -- jadi start/end WAJIB dikonversi ke true-UTC lebih dulu
// (naiveWibToUtcInstant, pola yang sama dipakai assertJamJadwalNotBeforeOrders
// di pengiriman-jadwal.ts) sebelum dipakai dalam perbandingan BETWEEN di bawah.
export async function getKartuPengirimanBelumSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<DraftJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  const startUtc = naiveWibToUtcInstant(start);
  const endUtc = naiveWibToUtcInstant(end);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamMulaiMuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.Status = 'Draft' AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamMulaiMuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}

// "Sudah Selesai Muat" untuk periode yang sama — dikelompokkan berdasarkan
// JamJadwal kartu (jadwal keberangkatannya), BUKAN JamSelesaiMuat (kapan ia
// benar-benar diselesaikan), supaya satu kartu selalu konsisten berada di
// periode/bagian yang sama terlepas dari kapan proses Selesai Muat-nya
// terjadi -- lihat Global Constraints rencana ini.
export async function getKartuPengirimanSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<SelesaiMuatJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  // Same true-UTC conversion as getKartuPengirimanBelumSelesaiUntukPeriode
  // above — j.JamJadwal is true-UTC, getShiftWindow returns naive-WIB.
  const startUtc = naiveWibToUtcInstant(start);
  const endUtc = naiveWibToUtcInstant(end);
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, startUtc)
    .input("end", sql.DateTime, endUtc).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}
