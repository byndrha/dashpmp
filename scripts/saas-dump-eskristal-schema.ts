// Menghasilkan db/eskristal/schema.sql -- skema inti satu tenant Es Kristal,
// diekstrak dari katalog database sumber (default: MKEsindo live), supaya
// perusahaan Es Kristal baru bisa diprovisioning dari database kosong.
//
// "Inti" = tabel yang benar-benar dibaca/ditulis kode dashboard (21 tabel ERP
// FINAC + Expedition + SalesInvoiceChangeLog untuk trigger + semua tabel
// Dashboard* yang dipakai), BUKAN seluruh 428 tabel ERP -- ±330 sisanya modul
// ERP desktop yang tidak pernah disentuh dashboard. Tabel PMP_* sengaja tidak
// ikut: itu skema Es Balok, kosong di MKEsindo.
//
// Nama constraint otomatis SQL Server (PK__x__hash, DF__x__hash) dibuang
// supaya database baru menghasilkan namanya sendiri; nama eksplisit
// (PK_ChartOfAccount dsb.) dipertahankan.
//
// Usage: npx tsx scripts/saas-dump-eskristal-schema.ts
// Jalankan ulang setiap kali ada tabel Dashboard* baru atau kolom baru.
import "dotenv/config";
import { mkdirSync, writeFileSync } from "fs";
import { getPool } from "../src/lib/db";

export const ESKRISTAL_TABLES = [
  // ERP FINAC yang dipakai kode
  "Approval", "BusinessPartner", "ChartOfAccount", "DeliveryOrder", "DeliveryOrderDetail", "Expedition",
  "ExpeditionDetail", "GeneralLedger", "Item", "ItemAverage", "SalesInvoice", "SalesInvoiceChangeLog",
  "SalesInvoiceDetail", "SalesOrder", "SalesOrderDetail", "SalesPayment", "SalesPaymentDetail", "SalesReturn",
  "SalesReturnDetail", "Salesman", "Server", "TermOfPayment", "Token",
  // Dashboard*
  "DashboardAktivitasProduksiKehadiran", "DashboardAktivitasProduksiShift", "DashboardArmada",
  "DashboardArmadaActivity", "DashboardArmadaAlokasi", "DashboardBudget", "DashboardCashFlowDaily",
  "DashboardCashFlowExpense", "DashboardCollectionTarget", "DashboardDocTemplate", "DashboardDriverProfile",
  "DashboardDriverSim", "DashboardGLPostingBackfill", "DashboardGLPostingBackfillDetail",
  "DashboardJadwalTimProduksi", "DashboardKasKecilPengeluaran", "DashboardKasKecilSaldoAwal",
  "DashboardKasKecilShift", "DashboardKoreksiStokPallet", "DashboardLaporanShiftStokEsSnapshot",
  "DashboardMarketingMitra", "DashboardMarketingVisitLog", "DashboardMarketingWilayah",
  "DashboardMitraAlamat", "DashboardMitraCapacitySnapshot", "DashboardMitraCompetitor", "DashboardMitraContactLog",
  "DashboardMitraLocation", "DashboardMitraLokasiPengiriman", "DashboardMitraPengajuan", "DashboardMonthlyTarget",
  "DashboardNotification",
  "DashboardNotificationRead", "DashboardNotificationScanState", "DashboardPabrikLocation",
  "DashboardPengirimanBBM", "DashboardPengirimanIstirahat", "DashboardPengirimanJadwal",
  "DashboardPengirimanJadwalDetail", "DashboardPengirimanKendala", "DashboardPengirimanReturResale",
  "DashboardPengirimanStopDelivery", "DashboardPengirimanStopDeliveryItem", "DashboardPengirimanTerkendala",
  "DashboardPerusahaan", "DashboardPrintFormatSettings", "DashboardPrintQueue", "DashboardProduksiBatch",
  "DashboardProduksiKualitas", "DashboardProduksiMesin", "DashboardProduksiMesinEvent",
  "DashboardProduksiMuatanDetail", "DashboardProduksiPalletPosisi", "DashboardSalesPaymentMetode",
  "DashboardSatpamJadwalJaga", "DashboardSatpamPatroliFoto", "DashboardSatpamPatroliSesi", "DashboardSatpamTamu",
  "DashboardSiteSettings", "DashboardStokBahanBakuSaldoAwal", "DashboardStokBahanBakuShift",
  "DashboardTakeAwayAlokasi", "DashboardTakeAwayMuatan", "DashboardTimProduksi", "DashboardTimProduksiAnggota",
  "DashboardVehicleCheck", "DashboardVehicleCheckPhoto", "DashboardWilayahPotentialTarget",
];
const ESKRISTAL_MODULES = ["vCustomerStatement", "trg_SalesInvoice_Changes"];

const isAutoName = (n: string) => /__/.test(n);

interface ColRow {
  tn: string; cn: string; type_name: string; max_length: number; precision: number; scale: number; is_nullable: boolean;
  is_identity: boolean; seed: number | null; incr: number | null; computed: string | null; dfname: string | null; df: string | null;
}
interface IdxRow {
  tn: string; ixn: string; type_desc: string; is_unique: boolean; is_primary_key: boolean; is_unique_constraint: boolean;
  filter_definition: string | null; is_included_column: boolean; is_descending_key: boolean; cn: string;
}
interface FkRow { tn: string; fkn: string; rt: string; cn: string; rc: string }
interface ModRow { name: string; definition: string }

function typeSql(c: ColRow): string {
  const t = c.type_name;
  if (["varchar", "char", "varbinary", "binary"].includes(t)) return `${t}(${c.max_length === -1 ? "MAX" : c.max_length})`;
  if (["nvarchar", "nchar"].includes(t)) return `${t}(${c.max_length === -1 ? "MAX" : c.max_length / 2})`;
  if (["decimal", "numeric"].includes(t)) return `${t}(${c.precision},${c.scale})`;
  if (["datetime2", "time", "datetimeoffset"].includes(t)) return `${t}(${c.scale})`;
  return t;
}

async function main() {
  const pool = await getPool();
  const q = async <T,>(s: string): Promise<T[]> => (await pool.request().query<T>(s)).recordset;
  const inList = ESKRISTAL_TABLES.map((t) => `'${t}'`).join(",");

  const cols = await q<ColRow>(`
    SELECT o.name tn, c.name cn, t.name type_name, c.max_length, c.precision, c.scale, c.is_nullable,
           c.is_identity, IDENT_SEED(o.name) seed, IDENT_INCR(o.name) incr,
           cc.definition computed, dc.name dfname, dc.definition df
    FROM sys.objects o JOIN sys.columns c ON c.object_id=o.object_id
    JOIN sys.types t ON t.user_type_id=c.user_type_id
    LEFT JOIN sys.computed_columns cc ON cc.object_id=c.object_id AND cc.column_id=c.column_id
    LEFT JOIN sys.default_constraints dc ON dc.parent_object_id=c.object_id AND dc.parent_column_id=c.column_id
    WHERE o.type='U' AND o.name IN (${inList}) ORDER BY o.name, c.column_id`);
  const idx = await q<IdxRow>(`
    SELECT o.name tn, i.name ixn, i.type_desc, i.is_unique, i.is_primary_key, i.is_unique_constraint, i.filter_definition,
           ic.is_included_column, ic.is_descending_key, c.name cn
    FROM sys.objects o JOIN sys.indexes i ON i.object_id=o.object_id AND i.type>0
    JOIN sys.index_columns ic ON ic.object_id=i.object_id AND ic.index_id=i.index_id
    JOIN sys.columns c ON c.object_id=ic.object_id AND c.column_id=ic.column_id
    WHERE o.type='U' AND o.name IN (${inList}) ORDER BY o.name, i.index_id, ic.is_included_column, ic.key_ordinal, ic.index_column_id`);
  const fks = await q<FkRow>(`
    SELECT OBJECT_NAME(f.parent_object_id) tn, f.name fkn, OBJECT_NAME(f.referenced_object_id) rt,
           COL_NAME(fc.parent_object_id, fc.parent_column_id) cn, COL_NAME(fc.referenced_object_id, fc.referenced_column_id) rc
    FROM sys.foreign_keys f JOIN sys.foreign_key_columns fc ON fc.constraint_object_id=f.object_id
    WHERE OBJECT_NAME(f.parent_object_id) IN (${inList})`);
  const mods = await q<ModRow>(`
    SELECT o.name, m.definition FROM sys.objects o JOIN sys.sql_modules m ON m.object_id=o.object_id
    WHERE o.name IN (${ESKRISTAL_MODULES.map((t) => `'${t}'`).join(",")})`);

  const missing = ESKRISTAL_TABLES.filter((t) => !cols.some((c) => c.tn === t));
  if (missing.length) throw new Error(`Tabel tidak ditemukan di database sumber: ${missing.join(", ")}`);

  let create = "";
  let post = "";
  for (const tn of ESKRISTAL_TABLES) {
    const lines = cols.filter((c) => c.tn === tn).map((c) => {
      if (c.computed) return `  [${c.cn}] AS ${c.computed}`;
      let l = `  [${c.cn}] ${typeSql(c)}`;
      if (c.is_identity) l += ` IDENTITY(${c.seed},${c.incr})`;
      l += c.is_nullable ? " NULL" : " NOT NULL";
      if (c.df) l += `${isAutoName(c.dfname ?? "") ? "" : ` CONSTRAINT [${c.dfname}]`} DEFAULT ${c.df}`;
      return l;
    });
    const groups = new Map<string, IdxRow[]>();
    for (const i of idx.filter((x) => x.tn === tn)) groups.set(i.ixn, [...(groups.get(i.ixn) ?? []), i]);
    for (const [ixn, parts] of groups) {
      const p0 = parts[0];
      const keyCols = parts.filter((x) => !x.is_included_column).map((x) => `[${x.cn}]${x.is_descending_key ? " DESC" : ""}`).join(", ");
      const inc = parts.filter((x) => x.is_included_column).map((x) => `[${x.cn}]`);
      const kind = p0.type_desc === "CLUSTERED" ? "CLUSTERED" : "NONCLUSTERED";
      const named = isAutoName(ixn) ? "" : `CONSTRAINT [${ixn}] `;
      if (p0.is_primary_key) lines.push(`  ${named}PRIMARY KEY ${kind} (${keyCols})`);
      else if (p0.is_unique_constraint) lines.push(`  ${named}UNIQUE ${kind} (${keyCols})`);
      else
        post += `CREATE ${p0.is_unique ? "UNIQUE " : ""}${kind} INDEX [${ixn}] ON [dbo].[${tn}] (${keyCols})${inc.length ? ` INCLUDE (${inc.join(", ")})` : ""}${p0.filter_definition ? ` WHERE ${p0.filter_definition}` : ""};\nGO\n`;
    }
    create += `CREATE TABLE [dbo].[${tn}] (\n${lines.join(",\n")}\n);\nGO\n\n`;
  }
  const fkGroups = new Map<string, FkRow[]>();
  for (const f of fks) fkGroups.set(f.fkn, [...(fkGroups.get(f.fkn) ?? []), f]);
  for (const [fkn, parts] of fkGroups) {
    post += `ALTER TABLE [dbo].[${parts[0].tn}] ADD ${isAutoName(fkn) ? "" : `CONSTRAINT [${fkn}] `}FOREIGN KEY (${parts.map((p) => `[${p.cn}]`).join(", ")}) REFERENCES [dbo].[${parts[0].rt}] (${parts.map((p) => `[${p.rc}]`).join(", ")});\nGO\n`;
  }
  const modSql = ESKRISTAL_MODULES.map((n) => {
    const m = mods.find((x) => x.name === n);
    if (!m) throw new Error(`Modul SQL tidak ditemukan: ${n}`);
    // Buang baris PRINT di luar body trigger (sisa skrip pembuatan aslinya).
    return `${m.definition.replace(/\n\s*PRINT\s+'[^']*';\s*$/i, "").trim()}\nGO\n`;
  }).join("\n");

  const header = `-- Skema inti tenant Es Kristal (${ESKRISTAL_TABLES.length} tabel + ${ESKRISTAL_MODULES.length} modul SQL).\n-- DIHASILKAN OTOMATIS oleh scripts/saas-dump-eskristal-schema.ts -- jangan edit manual.\n-- Pemisah batch: baris "GO".\n\n`;
  mkdirSync("db/eskristal", { recursive: true });
  writeFileSync("db/eskristal/schema.sql", header + create + post + "\n" + modSql);
  console.log(`db/eskristal/schema.sql ditulis: ${ESKRISTAL_TABLES.length} tabel, ${fkGroups.size} FK, ${ESKRISTAL_MODULES.length} modul.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("GAGAL:", err);
  process.exit(1);
});
