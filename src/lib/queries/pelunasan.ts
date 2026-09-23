import { getPool, sql } from "@/lib/db";
import type { RecordPaymentInput, RecordPaymentResult } from "@/lib/pelunasan-types";
import { AppError } from "@/lib/action-result";
import { getMetodePembayaranByKode } from "@/lib/queries/metode-pembayaran";
import { getNaiveWibNow, getBusinessPeriodStartWib } from "@/lib/business-date";
import { nextGeneralLedgerId, acquireGLPostingApplock } from "@/lib/queries/gl-posting-backfill";

// ChartOfAccountID tetap (bukan per-perusahaan/dicari lewat kode), sudah
// diverifikasi langsung ke ChartOfAccount 2026-09-23:
//   019  (AccountNo 1301) = Piutang Usaha
//   0185 (AccountNo 2200) = Uang Muka Customer -- porsi kelebihan bayar
//   (SalesPaymentDetail.Deposit) yang belum dialokasikan ke invoice manapun,
//   dipisah dari Piutang Usaha supaya saldo piutang tidak turun untuk uang
//   yang belum benar2 melunasi invoice tertentu.
const AKUN_PIUTANG_USAHA = "019";
const AKUN_UANG_MUKA_CUSTOMER = "0185";

// Satu-satunya kode "Kas Kecil" yang benar-benar ada di metode_pembayaran
// mkesindo (dicek langsung ke Postgres 2026-09-22) -- dibatasi ke periode
// penjualan berjalan (bukan bebas seperti Kas Besar/Transfer/QRIS) karena
// pencatatannya mengikuti rekonsiliasi kas harian, bukan momen realtime.
const KAS_KECIL_KODE = "tunai-kecil";

export type { PaymentAllocationInput, RecordPaymentInput, RecordPaymentResult } from "@/lib/pelunasan-types";

const BRANCH_ID = "011";
const DEPARTMENT_ID = "0110";
// Constant document-type suffix, same as SO/DO/SI (sales-order.ts, takeaway.ts)
// — verified against real SalesPayment.VoucherNo rows
// ("MKE/SP/002354/2026-07/003/001").
const DOC_SUFFIX = "003/001";

// Ownership gate for driver-app payment actions — SalesInvoice.SalesmanID
// is stamped at invoice creation (see selesaiMuat in pengiriman-jadwal.ts)
// and is the authoritative link back to which driver's delivery this
// invoice belongs to.
export async function getInvoiceSalesmanId(salesInvoiceId: string): Promise<string | null> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("id", sql.VarChar(16), salesInvoiceId)
    .query(`SELECT SalesmanID FROM SalesInvoice WHERE SalesInvoiceID = @id AND IsDeleted = 0`);
  return (result.recordset[0] as { SalesmanID: string | null } | undefined)?.SalesmanID ?? null;
}

export interface OutstandingInvoice {
  SalesInvoiceID: string;
  VoucherNo: string;
  TransDate: string;
  DueDate: string;
  Outstanding: number;
  DaysOverdue: number;
}

// Oldest-due-date-first, matching the real business rule the user described:
// a mitra should be able to pay off older overdue invoices first while only
// partially covering the newest one. Same CustomerBalance shape as
// aging.ts's getAgingReceivables(), just filtered to one BusinessPartnerID
// and without the AgingBucket/Status columns this UI doesn't need.
export async function getOutstandingInvoicesForMitra(businessPartnerId: string): Promise<OutstandingInvoice[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessPartnerId", sql.VarChar(16), businessPartnerId).query(`
    WITH CustomerBalance AS (
        SELECT
            SalesInvoiceID,
            SUM(Netto)        AS Netto,
            SUM(Deposit)      AS Deposit,
            SUM(Paid)         AS Paid,
            SUM(OtherPayment) AS OtherPayment
        FROM vCustomerStatement
        GROUP BY SalesInvoiceID
    )
    SELECT
        si.SalesInvoiceID,
        si.VoucherNo,
        si.TransDate,
        si.DueDate,
        (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) AS Outstanding,
        DATEDIFF(DAY, si.DueDate, GETDATE()) AS DaysOverdue
    FROM CustomerBalance cb
    JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
    WHERE si.IsDeleted = 0
      AND si.BusinessPartnerID = @businessPartnerId
      AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) > 0
    ORDER BY si.DueDate ASC
  `);

  return result.recordset;
}

async function nextSalesPaymentId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesPaymentID AS INT)) AS MaxID FROM SalesPayment`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSalesPaymentDetailId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(SalesPaymentDetailID AS INT)) AS MaxID FROM SalesPaymentDetail`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(8, "0");
}

async function nextSPVoucherSeq(pool: sql.ConnectionPool, yearMonth: string): Promise<string> {
  const result = await pool
    .request()
    .input("pattern", sql.VarChar(64), `MKE/SP/%/${yearMonth}/${DOC_SUFFIX}`).query(`
      SELECT MAX(TRY_CAST(SUBSTRING(VoucherNo, 8, 6) AS INT)) AS MaxSeq FROM SalesPayment WHERE VoucherNo LIKE @pattern
    `);
  const maxSeq = (result.recordset[0]?.MaxSeq as number | null) ?? 0;
  return String(maxSeq + 1).padStart(6, "0");
}

// Records one SalesPayment header spanning N SalesInvoiceID allocations —
// this many-to-many payment-to-invoice shape is exactly how the real
// desktop-app data already works (confirmed a genuine historical example of
// one SalesPaymentID spanning 145 different SalesInvoiceIDs), so this isn't
// a new pattern being invented, just a new UI writing into an existing one.
//
// Per-line overpayment becomes that line's Deposit (SalesPaymentDetail.Deposit),
// matching the schema's own column for it — the user explicitly asked for
// "diperingatkan tapi tetap boleh, jadi deposit" (warn but allow, becomes a
// deposit). Outstanding is recomputed here from vCustomerStatement rather
// than trusting client-sent figures, since a stale UI snapshot must not
// silently determine how much of a real cash amount posts as Deposit.
export async function recordPayment(input: RecordPaymentInput): Promise<RecordPaymentResult> {
  const allocations = input.allocations.filter((a) => a.amount > 0);
  if (allocations.length === 0) throw new AppError("Tidak ada alokasi pembayaran yang valid.");

  const metode = await getMetodePembayaranByKode(input.perusahaanId, input.metodePembayaranKode);
  if (!metode || !metode.isActive) {
    throw new AppError("Metode pembayaran tidak ditemukan atau sudah tidak aktif.");
  }
  // getMetodePembayaranByKode (unlike listActiveMetodePembayaran) doesn't
  // filter by konteks, since it's also used for lookups that don't care —
  // so the write path must check it explicitly before any DB writes.
  if (!metode.konteks.includes(input.konteks)) {
    throw new AppError("Metode pembayaran ini tidak tersedia untuk konteks ini.");
  }
  if (metode.wajibCatatan && !input.notes?.trim()) {
    throw new AppError("Catatan wajib diisi untuk metode pembayaran ini.");
  }

  // transDate ditulis sebagai Date "naive WIB" (angka mentahnya ADALAH jam
  // dinding WIB, bukan UTC asli) -- konvensi yang sama dipakai semua kolom
  // TransDate lain di sistem ini (lihat getNaiveWibTransDate). Menambahkan
  // "Z" ke string datetime-local ("YYYY-MM-DDTHH:mm") membuat JS Date
  // memperlakukan angka apa adanya sebagai komponen (bukan re-konversi zona
  // waktu), persis yang dibutuhkan. Divalidasi ULANG di sini (bukan cuma
  // percaya batas min/max di browser) -- baik "tidak boleh masa depan"
  // (semua metode) maupun "harus dalam periode berjalan" (Kas Kecil saja).
  const transDate = input.tanggalWaktuBayar ? new Date(`${input.tanggalWaktuBayar}:00.000Z`) : getNaiveWibNow();
  const nowWib = getNaiveWibNow();
  if (transDate.getTime() > nowWib.getTime()) {
    throw new AppError("Tanggal & jam pembayaran tidak boleh di masa depan.");
  }
  if (input.metodePembayaranKode === KAS_KECIL_KODE) {
    const periodStart = new Date(`${getBusinessPeriodStartWib()}:00.000Z`);
    if (transDate.getTime() < periodStart.getTime()) {
      throw new AppError("Untuk Kas Kecil, tanggal & jam pembayaran harus dalam periode penjualan yang sedang berjalan.");
    }
  }

  const pool = await getPool();
  const invoiceIds = allocations.map((a) => a.salesInvoiceId);

  const balanceRequest = pool.request();
  const inClause = invoiceIds.map((id, i) => {
    balanceRequest.input(`siId${i}`, sql.VarChar(16), id);
    return `@siId${i}`;
  });
  const balanceResult = await balanceRequest.query(`
    SELECT SalesInvoiceID, SUM(Netto) - SUM(Paid) - SUM(Deposit) - SUM(OtherPayment) AS Outstanding
    FROM vCustomerStatement
    WHERE SalesInvoiceID IN (${inClause.join(",")})
    GROUP BY SalesInvoiceID
  `);
  const outstandingMap = new Map<string, number>(
    (balanceResult.recordset as { SalesInvoiceID: string; Outstanding: number }[]).map((r) => [r.SalesInvoiceID, r.Outstanding])
  );

  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const salesPaymentId = await nextSalesPaymentId(pool);
  const voucherSeq = await nextSPVoucherSeq(pool, yearMonth);
  const voucherNo = `MKE/SP/${voucherSeq}/${yearMonth}/${DOC_SUFFIX}`;
  const totalAmount = allocations.reduce((sum, a) => sum + a.amount, 0);

  const bpNameResult = await pool
    .request()
    .input("bpId", sql.VarChar(16), input.businessPartnerId)
    .query(`SELECT Name FROM BusinessPartner WHERE BusinessPartnerID = @bpId`);
  const businessPartnerName = (bpNameResult.recordset[0] as { Name: string } | undefined)?.Name ?? input.businessPartnerId;
  const glMemo = `Sales Payment To ${businessPartnerName}`;

  // Ditulis dalam SATU transaksi (sebelumnya tidak -- INSERT terpisah
  // sekuensial) supaya SalesPayment/SalesPaymentDetail/DashboardSalesPaymentMetode
  // dan baris GeneralLedger baru di bawah gagal/berhasil bersama-sama, tidak
  // ada kondisi "SP tercatat tapi GL kosong" (atau sebaliknya) akibat error
  // di tengah jalan.
  const transaction = new sql.Transaction(pool);
  await transaction.begin();
  try {
    await new sql.Request(transaction)
      .input("id", sql.VarChar(16), salesPaymentId)
      .input("voucherNo", sql.VarChar(128), voucherNo)
      .input("transDate", sql.DateTime, transDate)
      .input("notes", sql.VarChar(512), input.notes ?? "")
      .input("bpId", sql.VarChar(16), input.businessPartnerId)
      .input("amount", sql.Decimal(23, 4), totalAmount)
      .input("coaId", sql.VarChar(16), metode.coaId)
      .input("branchId", sql.VarChar(16), BRANCH_ID)
      .input("departmentId", sql.VarChar(16), DEPARTMENT_ID).query(`
        INSERT INTO SalesPayment
          (SalesPaymentID, VoucherNo, TransDate, Notes, BusinessPartnerID, Amount, Type, IsDeleted, ModifiedDate,
           ChartOfAccountID, BranchID, ChartOfAccountTaxID, ChartOfAccountExpenseID, ChartOfAccountDiscID,
           CurrencyID, Rate, SalesmanID, ChartOfAccountDepositID, DepartmentID, IsAccountReceiveable,
           EDC, CardNo, ProjectID, SalesDepositID, SalesPaymentRequestID)
        VALUES
          (@id, @voucherNo, @transDate, @notes, @bpId, @amount, NULL, 0, GETDATE(),
           @coaId, @branchId, '', '', '',
           '', 1, NULL, '', @departmentId, 0,
           '', '', NULL, NULL, NULL)
      `);

    let totalDeposit = 0;
    for (const alloc of allocations) {
      const outstanding = Math.max(0, outstandingMap.get(alloc.salesInvoiceId) ?? 0);
      const amountApplied = Math.min(alloc.amount, outstanding);
      const deposit = alloc.amount - amountApplied;
      totalDeposit += deposit;

      const detailId = await nextSalesPaymentDetailId(pool);
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), detailId)
        .input("spId", sql.VarChar(16), salesPaymentId)
        .input("siId", sql.VarChar(16), alloc.salesInvoiceId)
        .input("amount", sql.Decimal(23, 4), amountApplied)
        .input("deposit", sql.Decimal(23, 4), deposit).query(`
          INSERT INTO SalesPaymentDetail
            (SalesPaymentDetailID, SalesPaymentID, SalesInvoiceID, Amount, Deposit, DiscRp, ModifiedDate,
             IsDeleted, AddTax, Expense, CurrencyID, Rate, DepositAmount, Status)
          VALUES
            (@id, @spId, @siId, @amount, @deposit, 0, GETDATE(),
             0, 0, 0, NULL, NULL, NULL, NULL)
        `);
    }

    await new sql.Request(transaction)
      .input("spId", sql.VarChar(16), salesPaymentId)
      .input("metodeKode", sql.VarChar(64), input.metodePembayaranKode)
      .input("catatan", sql.VarChar(500), input.notes ?? null)
      .query(`INSERT INTO DashboardSalesPaymentMetode (SalesPaymentID, MetodeKode, Catatan) VALUES (@spId, @metodeKode, @catatan)`);

    // Posting GeneralLedger -- ditambahkan 2026-09-23. Sebelum ini, SP yang
    // dibuat lewat dashpmp TIDAK PERNAH ter-posting ke GL sama sekali (beda
    // dgn SP yang dibuat lewat ERP desktop, yang selalu posting 2 baris:
    // Debit akun kas/bank metode pembayaran = Amount, Credit 019 Piutang
    // Usaha = Amount -- pola ini diverifikasi terhadap >1 SP nyata yang
    // sudah ter-posting benar). Applock yang sama dgn gl-posting-backfill.ts
    // dipakai supaya generate ID GeneralLedger di sini tidak race dgn proses
    // backfill SI/DO yang berjalan terpisah.
    await acquireGLPostingApplock(transaction);
    const glId = await nextGeneralLedgerId(transaction);
    const glRows: { chartOfAccountId: string; debit: number; credit: number }[] = [
      { chartOfAccountId: metode.coaId, debit: totalAmount, credit: 0 },
    ];
    const amountAppliedTotal = totalAmount - totalDeposit;
    if (amountAppliedTotal > 0) {
      glRows.push({ chartOfAccountId: AKUN_PIUTANG_USAHA, debit: 0, credit: amountAppliedTotal });
    }
    if (totalDeposit > 0) {
      glRows.push({ chartOfAccountId: AKUN_UANG_MUKA_CUSTOMER, debit: 0, credit: totalDeposit });
    }
    for (const line of glRows) {
      await new sql.Request(transaction)
        .input("id", sql.VarChar(16), glId)
        .input("branchId", sql.VarChar(16), BRANCH_ID)
        .input("departmentId", sql.VarChar(16), DEPARTMENT_ID)
        .input("voucherNo", sql.VarChar(64), voucherNo)
        .input("transDate", sql.DateTime, transDate)
        .input("chartOfAccountId", sql.VarChar(16), line.chartOfAccountId)
        .input("debit", sql.Decimal(18, 6), line.debit)
        .input("credit", sql.Decimal(18, 6), line.credit)
        .input("memo", sql.VarChar(255), glMemo)
        .input("businessPartnerId", sql.VarChar(16), input.businessPartnerId).query(`
          INSERT INTO GeneralLedger
            (ID, BranchID, DepartmentID, VoucherNo, TransDate, [Type], ChartOfAccountID, Debit, Credit, Memo, BusinessPartnerID, CurrencyID, Rate)
          VALUES
            (@id, @branchId, @departmentId, @voucherNo, @transDate, 'SALESPAYMENT', @chartOfAccountId, @debit, @credit, @memo, @businessPartnerId, '', 1)
        `);
    }

    await transaction.commit();
    return { salesPaymentId, voucherNo, totalAmount, totalDeposit };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}
