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
        bp.Capacity
    FROM BusinessPartner bp
    LEFT JOIN TermOfPayment top_ ON top_.TermOfPaymentID = bp.TermOfPaymentID
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

function generateMitraId(): string {
  // Prefixed with "DB" so dashboard-created ids can never collide with the
  // ERP's own numeric BusinessPartnerID sequence.
  return `DB${Date.now().toString(36).toUpperCase()}`.slice(0, 16);
}

export async function createMitra(input: MitraInput): Promise<string> {
  const pool = await getPool();
  const id = generateMitraId();
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
    .input("capacity", sql.Decimal(23, 4), input.capacity).query(`
      INSERT INTO BusinessPartner
        (BusinessPartnerID, Name, MobileNo, Address, NPWPName, NPWPAddress, Gender, PriceLevel, TermOfPaymentID, Capacity, IsDeleted, ModifiedDate)
      VALUES
        (@id, @name, @mobileNo, @address, @wilayah, @kecamatan, @gender, @priceLevel, @termOfPaymentId, @capacity, 0, GETDATE())
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
    .input("capacity", sql.Decimal(23, 4), input.capacity).query(`
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
