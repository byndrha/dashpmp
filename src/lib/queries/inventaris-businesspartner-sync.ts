// src/lib/queries/inventaris-businesspartner-sync.ts
//
// One-way sync: Postgres vendor_* tables -> MSSQL BusinessPartner, per
// company (Modul Inventaris Tahap 1, Task 5). Never the reverse — Postgres
// is the source of truth for vendor data; MSSQL BusinessPartner is kept in
// sync so the desktop ERP can transact against the same vendor.
import { getCompanyPool } from "@/lib/db-company";
import sql from "mssql";
import { AppError } from "@/lib/action-result";
import type { VendorRow } from "@/lib/queries/inventaris-vendor";

// Confirmed live on MKEsindo's BusinessPartner: all 20 real supplier rows
// (Code LIKE 'SUPP%', GroupBusinessPartner='0') share these accounting
// fields uniformly. Only TermOfPaymentID and IsSuspended vary per vendor.
const ACC_PAYABLE = "0137"; // -> ChartOfAccount 2101 "Hutang Dagang"
const ACC_RECEIVABLE = "019";
const ACC_SALES_DISC = "0183";
const ACC_PURCHASE_DISC = "0114"; // -> ChartOfAccount 14012 "Persediaan - Barang Dagang"
const ACC_TAX_IN = "0122"; // -> ChartOfAccount 1606 "PPN Masukan"
const ACC_TAX_OUT = "0147";
const ACC_SALES_DEPOSIT = "0185";
const DEFAULT_PRICE_LEVEL = 1;

export interface VendorPicUtama {
  nama: string;
  telepon: string | null;
}

export interface SyncVendorInput {
  perusahaanKode: string;
  vendor: VendorRow;
  picUtama: VendorPicUtama | null;
  lokasiUtama: { alamat: string | null } | null;
  termOfPaymentId: string;
  isSuspended: boolean;
}

// Generates the next BusinessPartnerID for a company, following the exact
// length of whichever existing row currently holds the numeric max.
// BusinessPartnerID is varchar and NOT fixed-length, so a naive string
// MAX() gives wrong results (proven live on GeneralLedger.ID during the
// GIT-1399 investigation, where ID/BusinessPartnerID are both varchar with
// inconsistent lengths) — this casts to BIGINT first and orders on that.
async function nextBusinessPartnerId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`
    SELECT TOP 1 BusinessPartnerID, TRY_CAST(BusinessPartnerID AS BIGINT) AS N
    FROM BusinessPartner
    WHERE TRY_CAST(BusinessPartnerID AS BIGINT) IS NOT NULL
    ORDER BY N DESC
  `);
  // NOTE: node-mssql returns BIGINT columns as JS strings, not numbers
  // (confirmed live: typeof row.N === "string" even for small values like
  // "1863"), to avoid precision loss for values beyond
  // Number.MAX_SAFE_INTEGER. Left as `row.N + 1` this silently becomes
  // string concatenation ("1863" + 1 === "18631") instead of arithmetic —
  // caught live during Task 5 verification, where it produced "18631"
  // instead of the correct "01864". Number(row.N) below fixes this; every
  // real BusinessPartnerID here is small enough that the safe-integer
  // range is not a concern.
  const row = result.recordset[0] as { BusinessPartnerID: string; N: string | number } | undefined;
  if (!row) throw new AppError("Tidak bisa menentukan BusinessPartnerID baru — tabel BusinessPartner kosong/tidak terbaca.");
  const nextN = Number(row.N) + 1;
  return String(nextN).padStart(row.BusinessPartnerID.length, "0");
}

// Code = 'SUPP' + 5-digit zero-padded number (confirmed live, current max
// SUPP00670). SUBSTRING(Code, 5, 10) is cast to INT *before* MAX() here, so
// this is a numeric max, not a naive string MAX() — safe despite the
// lexicographic-comparison gotcha documented above.
async function nextSuppCode(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`
    SELECT MAX(TRY_CAST(SUBSTRING(Code, 5, 10) AS INT)) AS MaxN FROM BusinessPartner WHERE Code LIKE 'SUPP%'
  `);
  const maxN = (result.recordset[0] as { MaxN: number | null }).MaxN ?? 0;
  return "SUPP" + String(maxN + 1).padStart(5, "0");
}

// Creates a brand-new BusinessPartner row for a vendor that has never
// transacted with this company before. Returns the new BusinessPartnerID.
export async function createBusinessPartnerForVendor(input: SyncVendorInput): Promise<string> {
  const pool = await getCompanyPool(input.perusahaanKode, "utama");
  const businessPartnerId = await nextBusinessPartnerId(pool);
  const code = await nextSuppCode(pool);

  await pool
    .request()
    .input("id", sql.VarChar(16), businessPartnerId)
    .input("code", sql.VarChar(128), code)
    .input("name", sql.VarChar(128), input.vendor.nama)
    .input("address", sql.VarChar(1024), input.lokasiUtama?.alamat ?? null)
    .input("npwp", sql.VarChar(128), input.vendor.npwp)
    .input("npwpAddress", sql.VarChar(1024), input.vendor.npwpAlamat)
    .input("contactPerson", sql.VarChar(128), input.picUtama?.nama ?? null)
    .input("mobileNo", sql.VarChar(128), input.picUtama?.telepon ?? null)
    .input("termOfPaymentId", sql.VarChar(16), input.termOfPaymentId)
    .input("isSuspended", sql.Bit, input.isSuspended)
    .input("accountPayableId", sql.VarChar(16), ACC_PAYABLE)
    .input("accountReceivableId", sql.VarChar(16), ACC_RECEIVABLE)
    .input("salesDiscId", sql.VarChar(16), ACC_SALES_DISC)
    .input("purchaseDiscId", sql.VarChar(16), ACC_PURCHASE_DISC)
    .input("taxInId", sql.VarChar(16), ACC_TAX_IN)
    .input("taxOutId", sql.VarChar(16), ACC_TAX_OUT)
    .input("salesDepositId", sql.VarChar(16), ACC_SALES_DEPOSIT)
    .input("priceLevel", sql.Int, DEFAULT_PRICE_LEVEL)
    .query(`
      INSERT INTO BusinessPartner (
        BusinessPartnerID, Code, Name, Address, NPWP, NPWPAddress, ContactPerson, MobileNo,
        TermOfPaymentID, IsSuspended, GroupBusinessPartner,
        AccountPayableID, AccountReceivableID, SalesDiscID, PurchaseDiscID,
        TaxInID, TaxOutID, SalesDepositID, PriceLevel, IsDeleted
      ) VALUES (
        @id, @code, @name, @address, @npwp, @npwpAddress, @contactPerson, @mobileNo,
        @termOfPaymentId, @isSuspended, '0',
        @accountPayableId, @accountReceivableId, @salesDiscId, @purchaseDiscId,
        @taxInId, @taxOutId, @salesDepositId, @priceLevel, 0
      )
    `);
  // PurchaseDepositID is deliberately omitted from the INSERT's column
  // list — verified live against MKEsindo's BusinessPartner table
  // (INFORMATION_SCHEMA.COLUMNS.COLUMN_DEFAULT, sys.default_constraints,
  // and sys.columns.default_object_id all confirm there is NO DB-level
  // DEFAULT constraint on this column), so omitting it leaves it NULL —
  // matching the spec's explicit "kosong, bukan '0115'" requirement for
  // new vendors, deliberately differing from the historical '0115' value
  // carried by all 20 old SUPP* rows.

  return businessPartnerId;
}

// Keeps an already-linked BusinessPartner row's Name/Address/NPWP/
// NPWPAddress/ContactPerson/MobileNo in sync after a Postgres-side edit —
// one-way, Postgres is the source of truth.
export async function updateBusinessPartnerFromVendor(
  perusahaanKode: string,
  businessPartnerId: string,
  vendor: VendorRow,
  picUtama: VendorPicUtama | null,
  alamatUtama: string | null
): Promise<void> {
  const pool = await getCompanyPool(perusahaanKode, "utama");
  await pool
    .request()
    .input("id", sql.VarChar(16), businessPartnerId)
    .input("name", sql.VarChar(128), vendor.nama)
    .input("address", sql.VarChar(1024), alamatUtama)
    .input("npwp", sql.VarChar(128), vendor.npwp)
    .input("npwpAddress", sql.VarChar(1024), vendor.npwpAlamat)
    .input("contactPerson", sql.VarChar(128), picUtama?.nama ?? null)
    .input("mobileNo", sql.VarChar(128), picUtama?.telepon ?? null)
    .query(`
      UPDATE BusinessPartner
      SET Name = @name, Address = @address, NPWP = @npwp, NPWPAddress = @npwpAddress,
          ContactPerson = @contactPerson, MobileNo = @mobileNo, ModifiedDate = GETDATE()
      WHERE BusinessPartnerID = @id
    `);
}
