-- =====================================================================
-- QUERY REFERENSI DASHBOARD PMP PONOROGO (MKEsindo)
-- Sudah ditest terhadap data live. Parameter (@StartDate dst) tinggal
-- diikat ke input filter tanggal/branch di halaman dashboard.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. PENJUALAN HARIAN PER BRANCH
-- Sumber: SalesInvoice (header level, sudah termasuk pajak/diskon)
-- Exclude: IsDeleted, invoice performa (draft, bukan penjualan riil)
-- ---------------------------------------------------------------------
SELECT
    si.BranchID,
    b.Name AS BranchName,
    CAST(si.TransDate AS DATE) AS SalesDate,
    COUNT(DISTINCT si.SalesInvoiceID) AS InvoiceCount,
    SUM(si.Amount)     AS GrossAmount,
    SUM(si.DiscRp)     AS TotalDiscount,
    SUM(si.TaxValue)   AS TotalTax,
    SUM(si.Netto)      AS NetSales
FROM SalesInvoice si
LEFT JOIN Branch b ON b.BranchID = si.BranchID
WHERE si.IsDeleted = 0
  AND ISNULL(si.IsPerforma, 0) = 0
  AND si.TransDate >= @StartDate
  AND si.TransDate <  @EndDate
GROUP BY si.BranchID, b.Name, CAST(si.TransDate AS DATE)
ORDER BY SalesDate DESC, BranchName;


-- ---------------------------------------------------------------------
-- 2. PENGIRIMAN — Delivery Order yang masih terbuka
-- CATATAN: dod.Outstanding TIDAK RELIABLE (terverifikasi dari data live —
-- tidak konsisten dengan Qty-Delivered, bahkan pada order yang sudah
-- IsClosed=1). Sisa kirim dihitung manual dari Qty - Delivered.
-- ---------------------------------------------------------------------
SELECT
    do.DeliveryOrderID,
    do.VoucherNo,
    do.TransDate,
    do.DueDate,
    b.Name  AS BranchName,
    bp.Name AS CustomerName,
    do.VehicleNo,
    do.IsClosed,
    do.IsInvoiced,
    dod.ItemID,
    dod.Name AS ItemName,
    dod.Qty,
    dod.Delivered,
    (dod.Qty - dod.Delivered) AS SisaBelumDikirim
FROM DeliveryOrder do
JOIN DeliveryOrderDetail dod ON dod.DeliveryOrderID = do.DeliveryOrderID
LEFT JOIN Branch b ON b.BranchID = do.BranchID
LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = do.BusinessPartnerID
WHERE do.IsDeleted = 0
  AND do.IsClosed = 0
ORDER BY do.TransDate ASC;


-- ---------------------------------------------------------------------
-- 3. AGING PIUTANG (AR)
-- Sumber: vCustomerStatement (view existing, sudah tervalidasi) + join
-- SalesInvoice untuk BusinessPartnerID/BranchID/DueDate.
-- ---------------------------------------------------------------------
SELECT
    si.SalesInvoiceID,
    si.VoucherNo,
    si.TransDate,
    si.DueDate,
    bp.BusinessPartnerID,
    bp.Name AS CustomerName,
    b.Name  AS BranchName,
    vcs.Netto,
    vcs.Paid,
    vcs.Deposit,
    vcs.OtherPayment,
    (vcs.Netto - vcs.Paid - vcs.Deposit - vcs.OtherPayment) AS Outstanding,
    DATEDIFF(DAY, si.DueDate, GETDATE()) AS DaysOverdue,
    CASE
        WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 0  THEN 'Belum Jatuh Tempo'
        WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 30 THEN '1-30 Hari'
        WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 60 THEN '31-60 Hari'
        WHEN DATEDIFF(DAY, si.DueDate, GETDATE()) <= 90 THEN '61-90 Hari'
        ELSE '>90 Hari'
    END AS AgingBucket
FROM vCustomerStatement vcs
JOIN SalesInvoice si ON si.SalesInvoiceID = vcs.SalesInvoiceID
LEFT JOIN BusinessPartner bp ON bp.BusinessPartnerID = si.BusinessPartnerID
LEFT JOIN Branch b ON b.BranchID = si.BranchID
WHERE si.IsDeleted = 0
  AND (vcs.Netto - vcs.Paid - vcs.Deposit - vcs.OtherPayment) > 0
ORDER BY DaysOverdue DESC;


-- ---------------------------------------------------------------------
-- 4. P&L (Profit & Loss) per periode
-- Sumber: GeneralLedger (BUKAN Journal/JournalDetail — GL mencakup
-- posting dari SEMUA modul: SalesInvoice, PurchaseInvoice, Expense, dll;
-- Journal/JournalDetail cuma mencakup entri manual/VOUCHER).
-- Klasifikasi kategori pakai prefix AccountNo (konvensi standar Indonesia,
-- diverifikasi dari data: 1=Aset 2=Liabilitas 3=Modal 4=Pendapatan
-- 5=HPP 6=Beban Operasional 7=Pendapatan/Beban Lain 8=Adjustment/Pajak)
-- Kolom 'Type' di ChartOfAccount TIDAK dipakai — nilainya tidak konsisten
-- dengan makna akuntansi standar.
-- ---------------------------------------------------------------------
SELECT
    LEFT(coa.AccountNo,1) AS Prefix,
    CASE LEFT(coa.AccountNo,1)
        WHEN '4' THEN 'Pendapatan'
        WHEN '5' THEN 'HPP'
        WHEN '6' THEN 'Beban Operasional'
        WHEN '7' THEN 'Pendapatan/Beban Lain-lain'
        WHEN '8' THEN 'Adjustment/Pajak'
        ELSE 'Lainnya'
    END AS Kategori,
    SUM(gl.Debit)  AS TotalDebit,
    SUM(gl.Credit) AS TotalCredit
FROM GeneralLedger gl
JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
WHERE gl.TransDate >= @StartDate
  AND gl.TransDate <  @EndDate
  -- AND gl.BranchID = @BranchID          -- opsional, filter per branch
  AND LEFT(coa.AccountNo,1) IN ('4','5','6','7','8')
GROUP BY LEFT(coa.AccountNo,1)
ORDER BY Prefix;

-- Perhitungan di layer aplikasi:
--   Pendapatan       = TotalCredit(4) - TotalDebit(4)
--   HPP              = TotalDebit(5)  - TotalCredit(5)
--   Laba Kotor       = Pendapatan - HPP
--   Beban Operasional= TotalDebit(6)  - TotalCredit(6)
--   Laba Operasional = Laba Kotor - Beban Operasional
--   Lain-lain (net)  = TotalCredit(7) - TotalDebit(7)
--   Adjustment/Pajak = TotalDebit(8)  - TotalCredit(8)
--   Laba Bersih      = Laba Operasional + Lain-lain - Adjustment/Pajak
--
-- ---------------------------------------------------------------------
-- 4b. BEP (Break-Even Point)
-- ChartOfAccount.CostBehavior sudah diisi (44 FIXED, 10 VARIABLE,
-- 6 MIXED, 6 akun header/grup dibiarkan NULL). HPP (5xxx) dianggap
-- variable penuh (standar untuk bisnis produksi/dagang).
-- MIXED (Bonus, Mesin, Peralatan Kendaraan, Peralatan Mesin Prod,
-- Beban Usaha Lainnya, Beban Penunjang) SENGAJA dipisah dari perhitungan
-- utama — ditampilkan sebagai catatan terpisah, bukan dipaksa masuk
-- Fixed/Variable, supaya BEP tidak bias oleh asumsi kasar.
-- ---------------------------------------------------------------------
SELECT
    CASE
        WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
        WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'   -- HPP = variable penuh
        ELSE coa.CostBehavior                               -- FIXED/VARIABLE/MIXED (6xxx)
    END AS Kategori,
    SUM(gl.Debit)  AS TotalDebit,
    SUM(gl.Credit) AS TotalCredit
FROM GeneralLedger gl
JOIN ChartOfAccount coa ON coa.ChartOfAccountID = gl.ChartOfAccountID
WHERE gl.TransDate >= @StartDate
  AND gl.TransDate <  @EndDate
  AND (
        LEFT(coa.AccountNo,1) IN ('4','5')
        OR (LEFT(coa.AccountNo,1) = '6' AND coa.CostBehavior IS NOT NULL)
      )
GROUP BY CASE
        WHEN LEFT(coa.AccountNo,1) = '4' THEN 'REVENUE'
        WHEN LEFT(coa.AccountNo,1) = '5' THEN 'VARIABLE'
        ELSE coa.CostBehavior
    END;

-- Perhitungan di layer aplikasi:
--   Revenue        = TotalCredit(REVENUE) - TotalDebit(REVENUE)
--   VariableCost   = TotalDebit(VARIABLE) - TotalCredit(VARIABLE)   -- HPP + 6xxx variable
--   FixedCost      = TotalDebit(FIXED)    - TotalCredit(FIXED)
--   MixedCost      = TotalDebit(MIXED)    - TotalCredit(MIXED)      -- tampilkan terpisah, JANGAN digabung otomatis
--   MarginKontribusi(%) = 1 - (VariableCost / Revenue)
--   BEP (Rp/bulan) = FixedCost / MarginKontribusi(%)
--
-- Daftar akun MIXED (untuk direview manual, tidak masuk formula BEP di atas):
--   Bonus, Mesin (perbaikan), Peralatan Kendaraan, Peralatan Mesin Produksi,
--   Beban Usaha Lainnya, Beban Penunjang


-- ---------------------------------------------------------------------
-- 5. BIAYA LISTRIK / OPERASIONAL
-- ChartOfAccountID '0166' (AccountNo 6105 "Listrik") — akun ini sudah
-- diverifikasi dari data (Juni 2026: Rp163,1jt, ~24,7% dari pendapatan
-- bulan yang sama — konsisten dengan temuan "~25% revenue" sebelumnya).
-- ---------------------------------------------------------------------
SELECT
    gl.TransDate,
    gl.BranchID,
    b.Name AS BranchName,
    gl.VoucherNo,
    gl.Debit,
    gl.Credit,
    gl.Memo
FROM GeneralLedger gl
LEFT JOIN Branch b ON b.BranchID = gl.BranchID
WHERE gl.ChartOfAccountID = '0166'
  AND gl.TransDate >= @StartDate
  AND gl.TransDate <  @EndDate
ORDER BY gl.TransDate DESC;

-- Akun terkait yang mungkin relevan untuk modul yang sama:
--   '01000097' -> AccountNo 2110 "Hutang Listrik" (sisi utang, kalau
--                  mau tampilkan outstanding tagihan listrik ke PLN)


-- ---------------------------------------------------------------------
-- CATATAN PERFORMA — SUDAH DITERAPKAN
-- Index IX_GeneralLedger_COA_TransDate (ChartOfAccountID, TransDate)
-- INCLUDE (Debit, Credit, BranchID) sudah dibuat di GeneralLedger.
-- Query #4, #4b, #5 di atas akan pakai index ini, bukan full scan lagi.
-- =====================================================================
-- STATUS SCHEMA TAMBAHAN (dibuat khusus untuk dashboard, di luar skema asli):
--   - DashboardAuth (tabel baru, FK -> User.UserID)
--   - ChartOfAccount.CostBehavior (kolom baru, sudah terisi untuk 6xxx)
--   - IX_GeneralLedger_COA_TransDate (index baru)
-- =====================================================================
