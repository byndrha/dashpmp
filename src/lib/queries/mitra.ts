import { getPool, sql } from "@/lib/db";
import { PARTNER_TYPE_CASE } from "@/lib/queries/aging";
import type { PartnerType } from "@/types/dashboard";

export interface MitraRow {
  BusinessPartnerID: string;
  Name: string;
  Kontak: string | null;
  Alamat: string | null;
  Wilayah: string | null;
  Kecamatan: string | null;
  PartnerType: PartnerType;
  Gender: string | null;
  PriceLevel: number | null;
  TermOfPaymentID: string | null;
  TermOfPaymentName: string | null;
  TermOfPaymentDays: number | null;
  Capacity: number | null;
  // GPS location saved via the "Lokasi Mitra" map field — separate from
  // Alamat above (ERP's own free-text address field) since these are two
  // independent data sources (DashboardMitraLocation, added specifically
  // for map-based distance routing).
  Latitude: number | null;
  Longitude: number | null;
  GeoAlamat: string | null;
}

export async function getMitraList(): Promise<MitraRow[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
        bp.BusinessPartnerID,
        bp.Name,
        bp.MobileNo AS Kontak,
        bp.Address AS Alamat,
        bp.NPWPName AS Wilayah,
        bp.NPWPAddress AS Kecamatan,
        ${PARTNER_TYPE_CASE} AS PartnerType,
        bp.Gender,
        bp.PriceLevel,
        bp.TermOfPaymentID,
        top_.TermOfPayment AS TermOfPaymentName,
        top_.Value AS TermOfPaymentDays,
        bp.Capacity,
        ml.Latitude,
        ml.Longitude,
        ml.Alamat AS GeoAlamat
    FROM BusinessPartner bp
    LEFT JOIN TermOfPayment top_ ON top_.TermOfPaymentID = bp.TermOfPaymentID
    LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = bp.BusinessPartnerID
    WHERE ISNULL(bp.IsDeleted, 0) = 0
    ORDER BY bp.Name
  `);

  return result.recordset;
}

export interface TermOfPaymentOption {
  TermOfPaymentID: string;
  TermOfPaymentName: string;
}

export async function getTermOfPaymentOptions(): Promise<TermOfPaymentOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TermOfPaymentID, TermOfPayment AS TermOfPaymentName
    FROM TermOfPayment
    WHERE ISNULL(IsDeleted, 0) = 0
    ORDER BY Value
  `);
  return result.recordset;
}

export interface PriceLevelOption {
  Level: number;
  Price: number;
}

// BusinessPartner.PriceLevel (1-8) selects which Item.UnitPriceN column
// applies to that mitra. There's no dedicated price-level lookup table, so
// this reads the nominal off "Es Tube Jual" — the main product — which is
// what these levels actually mean in practice (verified: matches the
// average transacted price per level in SalesInvoiceDetail).
export async function getPriceLevelOptions(): Promise<PriceLevelOption[]> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 UnitPrice1, UnitPrice2, UnitPrice3, UnitPrice4, UnitPrice5, UnitPrice6, UnitPrice7, UnitPrice8
    FROM Item
    WHERE Name = 'Es Tube Jual' AND ISNULL(IsDeleted, 0) = 0
  `);
  const row = result.recordset[0] as Record<string, number | null> | undefined;
  if (!row) return [];

  const levels: PriceLevelOption[] = [];
  for (let level = 1; level <= 8; level++) {
    const price = row[`UnitPrice${level}`];
    if (price != null && price > 0) levels.push({ Level: level, Price: price });
  }
  return levels;
}

export interface MitraInput {
  name: string;
  mobileNo: string | null;
  address: string | null;
  wilayah: string | null;
  kecamatan: string | null;
  gender: string | null;
  priceLevel: number | null;
  termOfPaymentId: string | null;
  capacity: number | null;
}

// Reference IDs (AP/AR clearing accounts, sales/purchase discount & tax
// defaults, sales/purchase deposit accounts) that the desktop ERP app
// requires on every BusinessPartner to use it in a transaction — a mitra
// created without them looks fine in the dashboard but silently can't be
// used for a sale/purchase in the desktop app (verified: constant across
// ~630 live customer records created via the desktop app's own "new
// customer" flow, which doesn't offer a per-mitra choice for these either).
const DEFAULT_GROUP_BUSINESS_PARTNER = "1";
const DEFAULT_ACCOUNT_PAYABLE_ID = "0137";
const DEFAULT_ACCOUNT_RECEIVABLE_ID = "019";
const DEFAULT_SALES_DISC_ID = "0183";
const DEFAULT_PURCHASE_DISC_ID = "0114";
const DEFAULT_TAX_IN_ID = "0122";
const DEFAULT_TAX_OUT_ID = "0147";
const DEFAULT_PURCHASE_DEPOSIT_ID = "0115";
const DEFAULT_SALES_DEPOSIT_ID = "0185";
const CUSTOMER_CODE_PREFIX = "CUST";

// BusinessPartnerID is the ERP's own numeric sequence (zero-padded 5 digits,
// e.g. "01719"), shared with the desktop app — must continue from the live
// max, not a dashboard-local counter, or the desktop app's own next insert
// could collide with it.
async function nextBusinessPartnerId(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`SELECT MAX(TRY_CAST(BusinessPartnerID AS INT)) AS MaxID FROM BusinessPartner`);
  const maxId = (result.recordset[0]?.MaxID as number | null) ?? 0;
  return String(maxId + 1).padStart(5, "0");
}

// Code ("CUST" + 5-digit sequence) is a separate sequence from
// BusinessPartnerID — verified against live data that the two drift apart
// (e.g. BusinessPartnerID "01718" pairs with Code "CUST00708" while a
// differently-formatted "0211" row already holds "CUST00719") — so each
// must be computed from its own max, not derived from the other.
async function nextCustomerCode(pool: sql.ConnectionPool): Promise<string> {
  const result = await pool.request().query(`
    SELECT MAX(TRY_CAST(SUBSTRING(Code, 5, 10) AS INT)) AS MaxNum
    FROM BusinessPartner
    WHERE Code LIKE '${CUSTOMER_CODE_PREFIX}[0-9][0-9][0-9][0-9][0-9]'
  `);
  const maxNum = (result.recordset[0]?.MaxNum as number | null) ?? 0;
  return `${CUSTOMER_CODE_PREFIX}${String(maxNum + 1).padStart(5, "0")}`;
}

export async function createMitra(input: MitraInput): Promise<string> {
  const pool = await getPool();
  const id = await nextBusinessPartnerId(pool);
  const code = await nextCustomerCode(pool);
  await pool
    .request()
    .input("id", sql.VarChar(16), id)
    .input("code", sql.VarChar(128), code)
    .input("name", sql.VarChar(128), input.name)
    .input("mobileNo", sql.VarChar(128), input.mobileNo)
    .input("address", sql.VarChar(1024), input.address)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("gender", sql.VarChar(50), input.gender)
    .input("priceLevel", sql.Int, input.priceLevel)
    .input("termOfPaymentId", sql.VarChar(16), input.termOfPaymentId)
    .input("capacity", sql.Decimal(23, 4), input.capacity)
    .input("groupBP", sql.VarChar(128), DEFAULT_GROUP_BUSINESS_PARTNER)
    .input("apId", sql.VarChar(16), DEFAULT_ACCOUNT_PAYABLE_ID)
    .input("arId", sql.VarChar(16), DEFAULT_ACCOUNT_RECEIVABLE_ID)
    .input("salesDiscId", sql.VarChar(16), DEFAULT_SALES_DISC_ID)
    .input("purchaseDiscId", sql.VarChar(16), DEFAULT_PURCHASE_DISC_ID)
    .input("taxInId", sql.VarChar(16), DEFAULT_TAX_IN_ID)
    .input("taxOutId", sql.VarChar(16), DEFAULT_TAX_OUT_ID)
    .input("purchaseDepositId", sql.VarChar(16), DEFAULT_PURCHASE_DEPOSIT_ID)
    .input("salesDepositId", sql.VarChar(16), DEFAULT_SALES_DEPOSIT_ID).query(`
      INSERT INTO BusinessPartner
        (BusinessPartnerID, Code, Name, MobileNo, Address, NPWPName, NPWPAddress, Gender, PriceLevel,
         TermOfPaymentID, Capacity, IsLoan, IsSuspended, IsTax, GroupBusinessPartner,
         AccountPayableID, AccountReceivableID, SalesDiscID, PurchaseDiscID, TaxInID, TaxOutID,
         [Limit], PurchaseDepositID, SalesDepositID, IsDeleted, ModifiedDate)
      VALUES
        (@id, @code, @name, @mobileNo, @address, @wilayah, @kecamatan, @gender, @priceLevel,
         @termOfPaymentId, @capacity, 0, 0, 0, @groupBP,
         @apId, @arId, @salesDiscId, @purchaseDiscId, @taxInId, @taxOutId,
         0, @purchaseDepositId, @salesDepositId, 0, GETDATE())
    `);
  return id;
}

export async function updateMitra(id: string, input: MitraInput): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), id)
    .input("name", sql.VarChar(128), input.name)
    .input("mobileNo", sql.VarChar(128), input.mobileNo)
    .input("address", sql.VarChar(1024), input.address)
    .input("wilayah", sql.VarChar(128), input.wilayah)
    .input("kecamatan", sql.VarChar(128), input.kecamatan)
    .input("gender", sql.VarChar(50), input.gender)
    .input("priceLevel", sql.Int, input.priceLevel)
    .input("termOfPaymentId", sql.VarChar(16), input.termOfPaymentId)
    .input("capacity", sql.Decimal(23, 4), input.capacity)
    .input("groupBP", sql.VarChar(128), DEFAULT_GROUP_BUSINESS_PARTNER)
    .input("apId", sql.VarChar(16), DEFAULT_ACCOUNT_PAYABLE_ID)
    .input("arId", sql.VarChar(16), DEFAULT_ACCOUNT_RECEIVABLE_ID)
    .input("salesDiscId", sql.VarChar(16), DEFAULT_SALES_DISC_ID)
    .input("purchaseDiscId", sql.VarChar(16), DEFAULT_PURCHASE_DISC_ID)
    .input("taxInId", sql.VarChar(16), DEFAULT_TAX_IN_ID)
    .input("taxOutId", sql.VarChar(16), DEFAULT_TAX_OUT_ID)
    .input("purchaseDepositId", sql.VarChar(16), DEFAULT_PURCHASE_DEPOSIT_ID)
    .input("salesDepositId", sql.VarChar(16), DEFAULT_SALES_DEPOSIT_ID).query(`
      UPDATE BusinessPartner SET
        Name = @name,
        MobileNo = @mobileNo,
        Address = @address,
        NPWPName = @wilayah,
        NPWPAddress = @kecamatan,
        Gender = @gender,
        PriceLevel = @priceLevel,
        TermOfPaymentID = @termOfPaymentId,
        Capacity = @capacity,
        IsLoan = ISNULL(IsLoan, 0),
        IsSuspended = ISNULL(IsSuspended, 0),
        IsTax = ISNULL(IsTax, 0),
        GroupBusinessPartner = ISNULL(NULLIF(LTRIM(RTRIM(GroupBusinessPartner)), ''), @groupBP),
        AccountPayableID = ISNULL(AccountPayableID, @apId),
        AccountReceivableID = ISNULL(AccountReceivableID, @arId),
        SalesDiscID = ISNULL(SalesDiscID, @salesDiscId),
        PurchaseDiscID = ISNULL(PurchaseDiscID, @purchaseDiscId),
        TaxInID = ISNULL(TaxInID, @taxInId),
        TaxOutID = ISNULL(TaxOutID, @taxOutId),
        [Limit] = ISNULL([Limit], 0),
        PurchaseDepositID = ISNULL(PurchaseDepositID, @purchaseDepositId),
        SalesDepositID = ISNULL(SalesDepositID, @salesDepositId),
        ModifiedDate = GETDATE()
      WHERE BusinessPartnerID = @id
    `);
}

export async function deleteMitra(id: string): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("id", sql.VarChar(16), id)
    .query(`UPDATE BusinessPartner SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE BusinessPartnerID = @id`);
}
