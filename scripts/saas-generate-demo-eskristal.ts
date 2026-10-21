// Generator data SINTETIS untuk tenant demo Es Kristal: mitra, sopir, armada,
// dan rantai transaksi lengkap SO -> DO -> SI -> Pelunasan + jurnal GL,
// ditambah jadwal pengiriman, biaya operasional, gaji/listrik/penyusutan,
// dan saldo awal neraca. Semua nama, nomor HP, plat, dan angka fiktif;
// tidak ada satu baris pun yang disalin dari data transaksi MKEsindo.
//
// Konvensi yang ditiru dari ERP FINAC (supaya semua modul dashboard membaca
// data ini persis seperti data asli):
// - ID dokumen "01"+urut, voucher "MKE/SO/000123/2026-09/003/001" (urut
//   reset per bulan; prefix MKE masih hardcoded di kode dashboard).
// - BusinessPartner: Wilayah=NPWPName, Kecamatan=NPWPAddress, tipe lewat
//   Gender (Male=Agen, Female=Outlet, Other=RPA), TakeAway = SalesmanID '0127'.
// - Tabel Salesman ERP = SOPIR, bukan marketing.
// - SalesInvoice.DeliveryOrderID dibungkus kutip: "'01100001'".
// - TransDate dokumen ERP = jam WIB naif; kolom waktu tabel Dashboard* = UTC.
// - Jurnal: DO Dr1399/Cr14013, SI Dr1301/Cr4001 + Dr5002/Cr1399,
//   SP Dr kas-bank/Cr1301; biaya harian EXPENSE, bulanan VOUCHER.
//
// PENGAMAN: hanya mau menulis ke perusahaan yang holding-nya is_demo=true.
//
// Usage:
//   npx tsx scripts/saas-generate-demo-eskristal.ts --kode demokristal [--reset]
//     [--dari 2026-08-22] [--sampai 2026-10-21] [--seed 20261021]
import "dotenv/config";
import sql from "mssql";
import { getPgPool } from "../src/lib/pg";
import { resolveKoneksi } from "../src/lib/queries/perusahaan-koneksi";

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}
const KODE = arg("kode")!;
const RESET = process.argv.includes("--reset");
const DARI = arg("dari", "2026-08-22")!;
const SAMPAI = arg("sampai", "2026-10-21")!;
const SEED = Number(arg("seed", "20261021"));
if (!KODE) throw new Error("--kode wajib");

// ---------- PRNG deterministik ----------
let rngState = SEED >>> 0;
function rand(): number {
  rngState = (rngState + 0x6d2b79f5) >>> 0;
  let t = rngState;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (a: number, b: number) => a + rand() * (b - a);
const intBetween = (a: number, b: number) => Math.floor(between(a, b + 1));
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
function weighted<T>(pairs: [T, number][]): T {
  const total = pairs.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [v, w] of pairs) if ((r -= w) <= 0) return v;
  return pairs[pairs.length - 1][0];
}
function gauss(): number {
  const u = Math.max(rand(), 1e-9), v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ---------- Waktu: "ms WIB" = jam dinding WIB diperlakukan seperti UTC ----------
const MIN = 60_000, HOUR = 60 * MIN, DAY = 24 * HOUR;
const wibDay = (ymd: string) => Date.parse(`${ymd}T00:00:00Z`);
const pad = (n: number, w = 2) => String(n).padStart(w, "0");
function fmtWib(ms: number): string {
  // TransDate ERP: jam WIB naif.
  return new Date(ms).toISOString().slice(0, 19);
}
function fmtUtc(msWib: number): string {
  // Kolom waktu Dashboard*: ditulis aplikasi sebagai UTC.
  return new Date(msWib - 7 * HOUR).toISOString().slice(0, 23);
}
const ymOf = (ms: number) => new Date(ms).toISOString().slice(0, 7);

// ---------- Master fiktif ----------
const PABRIK = { lat: -7.6298, lng: 111.5239 };
const ZONES: { wilayah: string; kec: [string, number, number][]; n: number }[] = [
  { wilayah: "Kota Madiun", kec: [["Kartoharjo", -7.6185, 111.54], ["Manguharjo", -7.618, 111.513], ["Taman", -7.644, 111.533]], n: 40 },
  { wilayah: "Kab. Madiun", kec: [["Geger", -7.683, 111.526], ["Dolopo", -7.747, 111.525], ["Dagangan", -7.73, 111.59], ["Kebonsari", -7.718, 111.488]], n: 30 },
  { wilayah: "Kab. Madiun", kec: [["Wungu", -7.656, 111.571], ["Mejayan", -7.552, 111.66], ["Saradan", -7.539, 111.752]], n: 25 },
  { wilayah: "Kab. Madiun", kec: [["Balerejo", -7.571, 111.552], ["Pilangkenceng", -7.498, 111.642], ["Jiwan", -7.609, 111.477], ["Sawahan", -7.581, 111.479]], n: 28 },
  { wilayah: "Magetan", kec: [["Maospati", -7.605, 111.435], ["Magetan", -7.65, 111.33], ["Karangrejo", -7.602, 111.392], ["Bendo", -7.68, 111.394], ["Takeran", -7.69, 111.44]], n: 30 },
  { wilayah: "Ngawi", kec: [["Ngawi", -7.404, 111.446], ["Geneng", -7.494, 111.406], ["Paron", -7.453, 111.379]], n: 17 },
];
const DRIVERS = ["Agus Prasetyo", "Bambang Riyadi", "Dedi Kurniawan", "Eko Saputra", "Heru Susanto", "Joko Purnomo", "Slamet Riyanto", "Yusuf Hidayat"];
const ARMADA = [
  { nama: "TRUK 1", plat: "AE 9101 DK", brand: "Mitsubishi", model: "Colt Diesel FE 74", kmpl: 7.5, kap: 1600 },
  { nama: "TRUK 2", plat: "AE 9102 DK", brand: "Mitsubishi", model: "Colt Diesel FE 74", kmpl: 7.5, kap: 1600 },
  { nama: "TRUK 3", plat: "AE 9103 DK", brand: "Isuzu", model: "Elf NMR 71", kmpl: 8, kap: 1400 },
  { nama: "TRUK 4", plat: "AE 9104 DK", brand: "Isuzu", model: "Elf NMR 71", kmpl: 8, kap: 1400 },
  { nama: "TRUK 5", plat: "AE 9105 DK", brand: "Hino", model: "Dutro 110 SDL", kmpl: 7, kap: 1800 },
  { nama: "TRUK 6", plat: "AE 9106 DK", brand: "Suzuki", model: "Carry Pick Up", kmpl: 11, kap: 700 },
];
const STREETS = ["Jl. Merdeka", "Jl. Diponegoro", "Jl. Ahmad Yani", "Jl. Gajah Mada", "Jl. Pahlawan", "Jl. Sudirman", "Jl. Imam Bonjol", "Jl. Kartini", "Jl. Raya", "Jl. Pasar", "Jl. Melati", "Jl. Mawar", "Jl. Anggrek", "Jl. Kenanga", "Jl. Flamboyan", "Jl. Cempaka"];
const WORDS = ["Makmur", "Jaya", "Barokah", "Sejahtera", "Lancar", "Sumber Rejeki", "Berkah", "Abadi", "Mulia", "Sentosa", "Rukun", "Mandiri", "Sari", "Tirta", "Segar", "Maju", "Bahagia", "Harapan", "Mekar", "Sinar", "Murni", "Indah", "Utama", "Amanah", "Dingin", "Kencana"];
const OWNERS = ["Bu Sri", "Pak Darto", "Bu Tini", "Pak Wahyu", "Mbak Rina", "Pak Gito", "Bu Yati", "Mas Andi", "Pak Narto", "Bu Lastri", "Pak Kardi", "Bu Endang", "Mas Fajar", "Bu Ning", "Pak Harno", "Bu Siti", "Pak Tarno", "Mbak Dewi"];

type Tipe = "Agen" | "Outlet" | "Lainnya" | "RPA" | "TakeAway";
interface Mitra {
  id: string; code: string; name: string; tipe: Tipe; zone: number; kec: string; wilayah: string;
  lat: number; lng: number; address: string; phone: string; priceLevel: number; top: string;
  capacity: number; joinMs: number; churnMs: number | null; baseQty: number; pOrder: number;
  has5kg: boolean; payer: "baik" | "sedang" | "buruk";
}

const usedNames = new Set<string>();
function storeName(tipe: Tipe): string {
  for (;;) {
    const w = pick(WORDS), w2 = pick(WORDS);
    const n =
      tipe === "Agen" ? `${pick(["Agen Es", "UD", "Depot Es"])} ${w}${rand() < 0.5 ? " " + w2 : ""}`
      : tipe === "Outlet" ? (rand() < 0.4 ? `${pick(["Warung", "Toko", "Kios"])} ${pick(OWNERS)}` : `${pick(["Toko", "Warung", "Kedai", "RM", "Minimarket"])} ${w}${rand() < 0.5 ? " " + w2 : ""}`)
      : tipe === "RPA" ? `RPA ${w} ${w2}`
      : tipe === "TakeAway" ? `Pelanggan Ambil Sendiri ${usedNames.size + 1}`
      : `${pick(["Warung", "Kantin", "Toko", "Angkringan"])} ${rand() < 0.5 ? pick(OWNERS) : w}`;
    if (w !== w2 && !usedNames.has(n)) { usedNames.add(n); return n; }
  }
}
// Nomor 0800 (bebas pulsa, bukan nomor seluler) supaya fitur WhatsApp/penagihan
// tidak pernah bisa mengirim pesan ke orang sungguhan.
const fakePhone = () => `0800${pad(intBetween(0, 9999999), 7)}`;

function km(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371, dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

// ---------- Akses DB ----------
interface Col { name: string; decl: string; is_identity: boolean }
const colCache = new Map<string, Col[]>();
async function columnsOf(pool: sql.ConnectionPool, table: string): Promise<Col[]> {
  if (colCache.has(table)) return colCache.get(table)!;
  const r = await pool.request().input("t", table).query<{
    name: string; is_identity: boolean; is_computed: boolean; tn: string; max_length: number; precision: number; scale: number;
  }>(`
    SELECT c.name, c.is_identity, c.is_computed, t.name tn, c.max_length, c.precision, c.scale
    FROM sys.columns c JOIN sys.types t ON t.user_type_id = c.user_type_id WHERE c.object_id = OBJECT_ID(@t)`);
  const cols = r.recordset
    .filter((c) => !c.is_computed && c.tn !== "timestamp")
    .map((c) => {
      const len = c.max_length === -1 ? "MAX" : String(["nvarchar", "nchar"].includes(c.tn) ? c.max_length / 2 : c.max_length);
      const decl = ["varchar", "nvarchar", "char", "nchar"].includes(c.tn) ? `${c.tn}(${len})`
        : ["decimal", "numeric"].includes(c.tn) ? `${c.tn}(${c.precision},${c.scale})`
        : c.tn;
      return { name: c.name, decl, is_identity: c.is_identity };
    });
  colCache.set(table, cols);
  return cols;
}
// Insert massal lewat OPENJSON: satu parameter JSON per 1000 baris.
async function insertRows(pool: sql.ConnectionPool, table: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const keys = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) keys.add(k);
  const cols = (await columnsOf(pool, table)).filter((c) => keys.has(c.name));
  const unknown = [...keys].filter((k) => !cols.some((c) => c.name === k));
  if (unknown.length) throw new Error(`${table}: kolom tidak dikenal ${unknown.join(", ")}`);
  const list = cols.map((c) => `[${c.name}]`).join(", ");
  const withClause = cols.map((c) => `[${c.name}] ${c.decl} '$."${c.name}"'`).join(", ");
  const ident = cols.some((c) => c.is_identity);
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const body = `INSERT INTO [${table}] (${list}) SELECT ${list} FROM OPENJSON(@j) WITH (${withClause})`;
    await pool.request().input("j", sql.NVarChar(sql.MAX), JSON.stringify(chunk))
      .query(ident ? `SET IDENTITY_INSERT [${table}] ON; ${body}; SET IDENTITY_INSERT [${table}] OFF;` : body);
  }
  console.log(`  ${table}: ${rows.length}`);
}

const GENERATED_TABLES = [
  "DashboardPengirimanJadwalDetail", "DashboardPengirimanJadwal", "GeneralLedger", "SalesPaymentDetail", "SalesPayment",
  "SalesInvoiceDetail", "SalesInvoice", "SalesInvoiceChangeLog", "DeliveryOrderDetail", "DeliveryOrder", "SalesOrderDetail",
  "SalesOrder", "DashboardMitraLocation", "BusinessPartner", "DashboardDriverProfile", "Salesman", "DashboardArmada",
  "ExpeditionDetail", "Expedition", "ItemAverage", "DashboardMonthlyTarget",
];

async function main() {
  // ---------- Pengaman tenant demo ----------
  const pg = getPgPool();
  const t = (await pg.query(
    `SELECT h.is_demo, h.kode holding FROM perusahaan p JOIN holding h ON h.id = p.holding_id WHERE p.kode = $1`, [KODE])).rows[0];
  if (!t) throw new Error(`Perusahaan "${KODE}" tidak ada / tanpa holding`);
  if (!t.is_demo) throw new Error(`DITOLAK: holding "${t.holding}" bukan holding demo`);
  const cfg = await resolveKoneksi(KODE, "utama");
  if (!cfg) throw new Error("Koneksi utama tidak ada");
  if (cfg.dbName.toLowerCase() === "mkesindo") throw new Error("DITOLAK: database produksi");
  const pool = await new sql.ConnectionPool({
    server: cfg.host, port: cfg.port, database: cfg.dbName, user: cfg.dbUser, password: cfg.dbPassword,
    options: { encrypt: process.env.DB_ENCRYPT !== "false", trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === "true" },
    requestTimeout: 300000, connectionTimeout: 15000,
  }).connect();
  console.log(`Target: ${cfg.dbName} (holding ${t.holding})`);

  const existing = (await pool.request().query(`SELECT (SELECT COUNT(*) FROM BusinessPartner) bp, (SELECT COUNT(*) FROM SalesInvoice) si`)).recordset[0];
  if (existing.bp > 0 || existing.si > 0) {
    if (!RESET) throw new Error(`Database sudah berisi data (${existing.bp} mitra, ${existing.si} SI). Pakai --reset untuk mengganti.`);
    for (const tb of GENERATED_TABLES) await pool.request().query(`DELETE FROM [${tb}]`);
    console.log("Data sintetis lama dihapus.");
  }

  // ---------- Referensi dari DB tenant ----------
  const coaRows = (await pool.request().query<{ AccountNo: string; ChartOfAccountID: string }>(
    `SELECT AccountNo, ChartOfAccountID FROM ChartOfAccount WHERE ISNULL(IsDeleted,0)=0`)).recordset;
  const COA = (no: string) => {
    const r = coaRows.find((x) => x.AccountNo === no);
    if (!r) throw new Error(`Akun ${no} tidak ada di bagan akun tenant`);
    return r.ChartOfAccountID;
  };
  const item = (await pool.request().query<Record<string, string | number | null>>(
    `SELECT ItemID, Name, UnitPrice1, UnitPrice2, UnitPrice3, UnitPrice4, UnitPrice5, UnitPrice6, UnitPrice7, UnitPrice8 FROM Item WHERE ItemID IN ('019','0110','0111','0112')`)).recordset;
  const ITEM = Object.fromEntries(item.map((r) => [String(r.ItemID), r]));
  const priceOf = (itemId: string, level: number) => Number(ITEM[itemId][`UnitPrice${level}`] ?? ITEM[itemId].UnitPrice1) || 0;
  // Item uji coba bawaan bagan MKEsindo tidak relevan untuk demo.
  await pool.request().query(`UPDATE Item SET IsDeleted = 1 WHERE ItemID = '0116'`);

  const start = wibDay(DARI), end = wibDay(SAMPAI);
  const days: number[] = [];
  for (let d = start; d <= end; d += DAY) days.push(d);
  const BRANCH = "011", DEPT = "0110", DOC_SUFFIX = "003/001";

  // HPP per kantong per bulan (ItemAverage). Bulan berjalan belum di-closing,
  // jadi baris bulan terakhir sengaja tidak dibuat -- persis kondisi ERP asli.
  const months = [...new Set(days.map(ymOf))];
  const hpp: Record<string, Record<string, number>> = {};
  months.forEach((ym, i) => (hpp[ym] = { "019": 334 + i * 6.5, "0110": 334 + i * 6.5, "0111": 312 + i * 5, "0112": 312 + i * 5 }));
  const hppOf = (ms: number, itemId: string) => {
    const ym = ymOf(ms);
    const closed = months.slice(0, -1);
    return hpp[closed.includes(ym) ? ym : closed[closed.length - 1] ?? ym][itemId];
  };

  // ---------- Sopir, armada ----------
  console.log("Master:");
  const drivers = DRIVERS.map((name, i) => ({ id: `015${pad(i + 1)}`, name }));
  await insertRows(pool, "Salesman", [
    { SalesmanID: "0127", Code: "0127", Name: "Ambil Sendiri", IsDeleted: false, ModifiedDate: fmtWib(start - 30 * DAY) },
    ...drivers.map((d) => ({ SalesmanID: d.id, Code: d.id, Name: d.name, IsDeleted: false, ModifiedDate: fmtWib(start - 30 * DAY) })),
  ]);
  await insertRows(pool, "DashboardDriverProfile", drivers.map((d, i) => ({
    SalesmanID: d.id, Alamat: `${pick(STREETS)} No. ${intBetween(1, 120)}, ${pick(ZONES[0].kec)[0]}`,
    BergabungSejak: new Date(wibDay("2023-01-10") + i * 47 * DAY).toISOString().slice(0, 10),
    HariKerja: "Senin-Minggu", JamMulaiKerja: "05:00", JamSelesaiKerja: "14:00", IsHiddenFromDropdown: false, ModifiedDate: fmtUtc(start),
  })));
  await insertRows(pool, "Expedition", [{ ExpeditionID: "011", Name: "Armada Internal", ContactPerson: "", Address: "", PhoneNo: "", IsDeleted: false, ModifiedDate: fmtWib(start - 30 * DAY) }]);
  await insertRows(pool, "ExpeditionDetail", ARMADA.map((a, i) => ({ ExpeditionDetailID: `011${i + 1}`, ExpeditionID: "011", VehicleNo: a.plat, Description: a.nama, IsDeleted: false, ModifiedDate: fmtWib(start - 30 * DAY) })));
  await insertRows(pool, "DashboardArmada", ARMADA.map((a, i) => ({
    ArmadaID: i + 1, Nama: a.nama, PlatNomor: a.plat, Brand: a.brand, Model: a.model, KonsumsiBBM: a.kmpl, KapasitasMaks: a.kap,
    Status: "Baik", JenisBBM: a.brand === "Suzuki" ? "Pertalite" : "Solar", BiayaBBMPerLiter: a.brand === "Suzuki" ? 10000 : 6800,
    PajakLimaTahunan: `202${8 + (i % 2)}-0${(i % 9) + 1}-15`, BiayaPajakLimaTahunan: 2500000 + i * 150000,
    ExpeditionDetailID: `011${i + 1}`, IsDeleted: false, ModifiedDate: fmtUtc(start),
  })));

  // ---------- Mitra ----------
  const mitra: Mitra[] = [];
  let bpSeq = 1001;
  ZONES.forEach((z, zi) => {
    for (let k = 0; k < z.n; k++) {
      const [kec, clat, clng] = pick(z.kec);
      const tipe = weighted<Tipe>([["Agen", 40], ["Outlet", 36], ["Lainnya", 21], ["RPA", zi < 3 ? 2 : 0.5]]);
      const level = tipe === "Agen" ? weighted([[7, 3], [1, 4], [6, 3]]) : tipe === "Outlet" ? weighted([[2, 4], [3, 3], [4, 3]]) : tipe === "RPA" ? 6 : weighted([[4, 3], [5, 2]]);
      const top = tipe === "Lainnya" ? weighted([["014", 8], ["011", 2]]) : tipe === "Agen" ? weighted([["012", 6], ["013", 2], ["011", 2]]) : weighted([["012", 5], ["011", 2], ["014", 3]]);
      const joined = rand() < 0.13 ? start + intBetween(3, days.length - 5) * DAY : wibDay("2023-03-01") + intBetween(0, 1250) * DAY;
      mitra.push({
        id: `0${bpSeq}`, code: `CUST${pad(bpSeq - 1000, 5)}`, name: storeName(tipe), tipe, zone: zi, kec, wilayah: z.wilayah,
        lat: clat + gauss() * 0.012, lng: clng + gauss() * 0.012,
        address: `${pick(STREETS)} No. ${intBetween(1, 250)}, ${kec}`, phone: fakePhone(), priceLevel: level, top,
        capacity: tipe === "Agen" ? intBetween(15, 60) * 10 : tipe === "RPA" ? intBetween(10, 20) * 10 : intBetween(2, 12) * 10,
        joinMs: Math.min(joined, end), churnMs: rand() < 0.06 ? end - intBetween(8, 30) * DAY : null,
        baseQty: tipe === "Agen" ? between(25, 100) : tipe === "RPA" ? between(60, 120) : tipe === "Outlet" ? between(8, 40) : between(4, 18),
        pOrder: tipe === "Agen" ? between(0.65, 0.9) : tipe === "RPA" ? 0.8 : tipe === "Outlet" ? between(0.3, 0.6) : between(0.15, 0.35),
        has5kg: rand() < (tipe === "Agen" ? 0.25 : 0.08),
        payer: weighted<Mitra["payer"]>([["baik", 70], ["sedang", 21], ["buruk", 9]]),
      });
      bpSeq++;
    }
  });
  for (let k = 0; k < 6; k++) {
    mitra.push({
      id: `0${bpSeq}`, code: `CUST${pad(bpSeq - 1000, 5)}`, name: storeName("TakeAway"), tipe: "TakeAway", zone: 0, kec: "Taman", wilayah: "Kota Madiun",
      lat: PABRIK.lat, lng: PABRIK.lng, address: "Ambil di pabrik", phone: fakePhone(), priceLevel: weighted([[4, 3], [5, 2], [8, 1]]), top: "014",
      capacity: 0, joinMs: wibDay("2024-01-01"), churnMs: null, baseQty: between(3, 12), pOrder: 0, has5kg: rand() < 0.4, payer: "baik",
    });
    bpSeq++;
  }
  const GENDER: Record<Tipe, string> = { Agen: "Male", Outlet: "Female", RPA: "Other", Lainnya: "", TakeAway: "" };
  await insertRows(pool, "BusinessPartner", mitra.map((m) => ({
    BusinessPartnerID: m.id, Code: m.code, Name: m.name, MobileNo: m.phone, PhoneNo: "", Address: m.address,
    NPWPName: m.wilayah, NPWPAddress: m.kec, Gender: GENDER[m.tipe], PriceLevel: m.priceLevel, TermOfPaymentID: m.top,
    Capacity: m.capacity, SalesmanID: m.tipe === "TakeAway" ? "0127" : "", IsLoan: false, IsSuspended: false, IsTax: false,
    GroupBusinessPartner: "1", AccountReceivableID: "019", AccountPayableID: "0137", SalesDiscID: "0183", TaxOutID: "0147",
    SalesDepositID: "0185", Limit: 0, IsDeleted: false, JoinDate: fmtWib(m.joinMs), ModifiedDate: fmtWib(m.joinMs),
  })));
  await insertRows(pool, "DashboardMitraLocation", mitra.filter((m) => m.tipe !== "TakeAway").map((m) => ({
    BusinessPartnerID: m.id, Latitude: Number(m.lat.toFixed(7)), Longitude: Number(m.lng.toFixed(7)), Alamat: m.address,
    CreatedAt: fmtUtc(m.joinMs + 10 * HOUR), UpdatedAt: fmtUtc(m.joinMs + 10 * HOUR),
  })));

  // ---------- Simulasi harian ----------
  const TOP_DAYS: Record<string, number> = { "011": 5, "012": 7, "013": 30, "014": 0 };
  const seq = { so: 100001, sod: 100001, do: 100001, dod: 100001, si: 100001, sid: 100001, sp: 100001, spd: 100001, gl: 100001 };
  const vseq = new Map<string, number>();
  const voucher = (kind: string, ms: number) => {
    const k = `${kind}:${ymOf(ms)}`;
    const n = (vseq.get(k) ?? 0) + 1;
    vseq.set(k, n);
    return `MKE/${kind}/${pad(n, 6)}/${ymOf(ms)}/${DOC_SUFFIX}`;
  };
  type Row = Record<string, unknown>;
  type SiRow = Row & { SalesInvoiceID: string; Netto: number; Paid: number; IsClosed: boolean; TransDate: string };
  type SidRow = Row & { SalesInvoiceID: string; Qty: number };
  type GlRow = Row & { ChartOfAccountID: string; TransDate: string; Debit: number; Credit: number };
  const SO: Row[] = [], SOD: Row[] = [], DO: Row[] = [], DOD: Row[] = [], SI: SiRow[] = [], SID: SidRow[] = [];
  const SP: Row[] = [], SPD: Row[] = [], GL: GlRow[] = [], JADWAL: Row[] = [], JDET: Row[] = [];
  const gl = (id: string, voucherNo: string, ms: number, type: string, accNo: string, debit: number, credit: number, bp = "", memo = "") => {
    if (Math.abs(debit) < 0.005 && Math.abs(credit) < 0.005) return;
    GL.push({ ID: id, BranchID: BRANCH, DepartmentID: DEPT, VoucherNo: voucherNo, TransDate: fmtWib(ms), Type: type, ChartOfAccountID: COA(accNo),
      Debit: Math.round(debit * 1e6) / 1e6, Credit: Math.round(credit * 1e6) / 1e6, Memo: memo, BusinessPartnerID: bp, CurrencyID: "", Rate: 1 });
  };
  const journal = (voucherNo: string, ms: number, type: string, lines: [string, number, number][], memo = "") => {
    const id = `01${seq.gl++}`;
    for (const [acc, d, c] of lines) gl(id, voucherNo, ms, type, acc, d, c, "", memo);
  };

  interface Inv { siId: string; bp: Mitra; netto: number; ms: number; due: number }
  const invoices: Inv[] = [];
  let jadwalId = 1, jdetId = 1;
  const qtySoldByDay = new Map<number, { k: number; k5: number }>();

  const makeOrder = (m: Mitra, lines: { itemId: string; qty: number }[], soMs: number, doMs: number, driverId: string, plat: string, armadaIdx: number | null) => {
    const soId = `01${seq.so++}`, doId = `01${seq.do++}`, siId = `01${seq.si++}`;
    const due = doMs + TOP_DAYS[m.top] * DAY;
    const priced = lines.map((l) => {
      const price = l.itemId === "0110" || l.itemId === "0112" ? 0 : priceOf(l.itemId, m.priceLevel);
      return { ...l, price, amount: price * l.qty, name: ITEM[l.itemId].Name as string };
    });
    const netto = priced.reduce((s, l) => s + l.amount, 0);
    const soNo = voucher("SO", soMs), doNo = voucher("DO", doMs), siNo = voucher("SI", doMs);
    const base = { BranchID: BRANCH, DepartmentID: DEPT, BusinessPartnerID: m.id, CurrencyID: "", Rate: 1, StatusForm: 1, SalesmanID: driverId, IsDeleted: false };
    SO.push({ ...base, SalesOrderID: soId, VoucherNo: soNo, ReferenceNo: "", TransDate: fmtWib(soMs), DueDate: fmtWib(due), TermOfPaymentID: m.top,
      AddressInvoice: m.address, AddressDelivery: "", AddressDeliveryID: "", IsClosed: true, Notes: "", Amount: netto, Disc: 0, DiscValue: 0, DiscRp: 0,
      Tax: 0, TaxValue: 0, Netto: netto, IsInvoiced: true, ModifiedDate: fmtWib(soMs), ServiceTaxValue: 0, ServiceTax: 0, Visitor: 0, PromotionID: "",
      Number: 1, DiscRpBefore: 0, ProjectID: "", BillOfQuantityID: "", NotesDelivery: "", DeliveryMemo: "", Status: "" });
    DO.push({ ...base, DeliveryOrderID: doId, VoucherNo: doNo, TransDate: fmtWib(doMs), Notes: "", SalesOrderID: soId, IsClosed: true,
      ExpeditionID: armadaIdx === null ? "" : "011", VehicleNo: plat, AddressDelivery: "", ModifiedDate: fmtWib(doMs), PIC: "", IsInvoiced: true,
      OverLimit: false, ReferenceNo: "", DueDate: fmtWib(due), ProjectID: "", AddressDeliveryID: "" });
    SI.push({ ...base, SalesInvoiceID: siId, VoucherNo: siNo, ReferenceNo: "", TaxNo: "", TransDate: fmtWib(doMs + MIN), DueDate: fmtWib(due), Notes: "",
      TermOfPaymentID: m.top, SalesOrderID: soId, DeliveryOrderID: `'${doId}'`, SalesDepositID: "", Amount: netto, Disc: 0, DiscValue: 0, DiscRp: 0,
      Tax: 0, TaxValue: 0, Netto: netto, BankID: "", Paid: 0, Deposit: 0, IsClosed: false, ModifiedDate: fmtWib(doMs + MIN), IsAccountReceiveable: false,
      ServiceTax: 0, ServiceTaxValue: 0, Visitor: 0, IsTX: false, PromotionID: "", IsPerforma: false, DiscRpBefore: 0, ProjectID: "", IsExported: false, BillOfQuantityID: "" });
    const doJ = `01${seq.gl++}`, siJ = `01${seq.gl++}`;
    let hpp1399 = 0;
    const byAcc: Record<string, { inv: string; rev: string; cogs: string }> = {
      "019": { inv: "14013", rev: "4001", cogs: "5002" }, "0110": { inv: "14013", rev: "4001", cogs: "5002" },
      "0111": { inv: "14013.1", rev: "4004", cogs: "5004" }, "0112": { inv: "14013.1", rev: "4004", cogs: "5004" },
    };
    const sums: Record<string, number> = {};
    const add = (k: string, v: number) => (sums[k] = (sums[k] ?? 0) + v);
    for (const l of priced) {
      const sodId = `01${seq.sod++}`;
      SOD.push({ SalesOrderDetailID: sodId, SalesOrderID: soId, ItemID: l.itemId, Name: l.name, Qty: l.qty, Unit: "Kantong", Price: l.price, Disc: 0, DiscValue: 0, DiscRp: 0, Ratio: 1, Amount: l.amount, FlagClosed: "" });
      DOD.push({ DeliveryOrderDetailID: `01${seq.dod++}`, DeliveryOrderID: doId, ItemID: l.itemId, Qty: l.qty, Unit: "Kantong", UnitRatio: l.qty, Ratio: 1, Price: l.price, Disc: 0, DiscRp: 0, Amount: l.amount, Delivered: l.qty, Name: l.name, Outstanding: l.qty, Cashback: 0, SalesOrderDetailID: sodId });
      SID.push({ SalesInvoiceDetailID: `01${seq.sid++}`, SalesInvoiceID: siId, ItemID: l.itemId, Qty: l.qty, Unit: "Kantong", Ratio: 1, UnitRatio: 1, Price: l.price, Disc: 0, DiscValue: 0, DiscRp: 0, Amount: l.amount, Name: l.name, Value: l.amount, Netto: l.amount, Description: "", WaiterName: "", Cashback: 0 });
      const c = l.qty * hppOf(doMs, l.itemId);
      hpp1399 += c;
      add(`inv:${byAcc[l.itemId].inv}`, c); add(`rev:${byAcc[l.itemId].rev}`, l.amount); add(`cogs:${byAcc[l.itemId].cogs}`, c);
      const q = qtySoldByDay.get(doMs - (doMs % DAY)) ?? { k: 0, k5: 0 };
      if (l.itemId === "0111" || l.itemId === "0112") q.k5 += l.qty; else q.k += l.qty;
      qtySoldByDay.set(doMs - (doMs % DAY), q);
    }
    gl(doJ, doNo, doMs, "DELIVERYORDER", "1399", hpp1399, 0, m.id);
    for (const [k, v] of Object.entries(sums)) if (k.startsWith("inv:")) gl(doJ, doNo, doMs, "DELIVERYORDER", k.slice(4), 0, v, m.id);
    gl(siJ, siNo, doMs + MIN, "SALESINVOICE", "1301", netto, 0, m.id);
    for (const [k, v] of Object.entries(sums)) if (k.startsWith("rev:")) gl(siJ, siNo, doMs + MIN, "SALESINVOICE", k.slice(4), 0, v, m.id);
    for (const [k, v] of Object.entries(sums)) if (k.startsWith("cogs:")) gl(siJ, siNo, doMs + MIN, "SALESINVOICE", k.slice(5), v, 0, m.id);
    gl(siJ, siNo, doMs + MIN, "SALESINVOICE", "1399", 0, hpp1399, m.id);
    if (netto > 0) invoices.push({ siId, bp: m, netto, ms: doMs + MIN, due });
    return { soId, doId, siId, qty: lines.reduce((s, l) => s + l.qty, 0) };
  };

  const orderLines = (m: Mitra, factor: number) => {
    const qty = Math.max(1, Math.round(m.baseQty * factor * Math.exp(gauss() * 0.25)));
    const lines = [{ itemId: "019", qty }];
    if (m.tipe === "Agen" && qty >= 50 && rand() < 0.5) lines.push({ itemId: "0110", qty: Math.floor(qty / 25) });
    if (m.has5kg && rand() < 0.45) {
      const q5 = intBetween(5, 30);
      lines.push({ itemId: "0111", qty: q5 });
      if (q5 >= 20 && rand() < 0.4) lines.push({ itemId: "0112", qty: 1 });
    }
    return lines;
  };

  const kasExpense: { ms: number; acc: string; amt: number; memo: string }[] = [];
  days.forEach((d, di) => {
    const dow = new Date(d).getUTCDay();
    const weekday = [0.85, 0.95, 1, 1, 1, 1.05, 1.1][dow];
    const weather = Math.min(1.3, Math.max(0.7, 1 + gauss() * 0.12));
    const trend = 1 + 0.1 * (di / days.length);
    const factor = weekday * weather * trend;

    // Pesanan antar per zona -> armada zona itu.
    ZONES.forEach((_, zi) => {
      const zoneMitra = mitra.filter((m) => m.zone === zi && m.tipe !== "TakeAway" && m.joinMs <= d && (m.churnMs === null || d < m.churnMs));
      const orders = zoneMitra.filter((m) => rand() < Math.min(0.97, m.pOrder * (0.85 + 0.15 * factor))).map((m) => ({ m, lines: orderLines(m, factor) }));
      if (!orders.length) return;
      const a = ARMADA[zi];
      // Urutkan dari terdekat pabrik, pecah jadi trip sesuai kapasitas.
      orders.sort((x, y) => km(PABRIK, x.m) - km(PABRIK, y.m));
      const trips: typeof orders[] = [[]];
      let load = 0;
      for (const o of orders) {
        const q = o.lines.reduce((s, l) => s + l.qty, 0);
        if (load + q > a.kap && trips[trips.length - 1].length) { trips.push([]); load = 0; }
        trips[trips.length - 1].push(o); load += q;
      }
      // Sopir tetap per armada; dua sopir cadangan bergantian di hari Minggu.
      const driver = dow === 0 && zi < 2 ? drivers[6 + zi] : drivers[zi];
      trips.forEach((trip, ti) => {
        const jam = d + (ti === 0 ? 5 * HOUR + intBetween(15, 50) * MIN : 10 * HOUR + intBetween(30, 70) * MIN);
        let dist = 0, prev = { lat: PABRIK.lat, lng: PABRIK.lng };
        for (const o of trip) { dist += km(prev, o.m); prev = o.m; }
        dist = (dist + km(prev, PABRIK)) * 1.35;
        const durasi = Math.round(dist * 1.6 + trip.length * 9);
        const jid = jadwalId++;
        const qty5 = trip.reduce((s, o) => s + o.lines.filter((l) => l.itemId === "0111" || l.itemId === "0112").reduce((x, l) => x + l.qty, 0), 0);
        JADWAL.push({ JadwalID: jid, ArmadaID: zi + 1, SalesmanID: driver.id, JamJadwal: fmtUtc(jam), JamMulaiMuat: fmtUtc(jam - intBetween(25, 40) * MIN),
          JamSelesaiMuat: fmtUtc(jam - intBetween(3, 12) * MIN), JamAktualBerangkat: fmtUtc(jam + intBetween(0, 15) * MIN), IsDeleted: false,
          ModifiedDate: fmtUtc(jam + durasi * MIN), Status: "Terbit", CreatedByUserID: null, JarakKM: Number(dist.toFixed(1)), DurasiMenit: durasi,
          Qty5KGDimuat: qty5, CreatedDate: fmtUtc(d - 9 * HOUR + intBetween(0, 120) * MIN) });
        trip.forEach((o, ui) => {
          const soMs = d - intBetween(6, 14) * HOUR; // dipesan sore/malam sebelumnya
          const r = makeOrder(o.m, o.lines, soMs, jam - intBetween(5, 20) * MIN, driver.id, a.plat, zi);
          JDET.push({ JadwalDetailID: jdetId++, JadwalID: jid, DeliveryOrderID: r.doId, IsDeleted: false, SalesOrderID: r.soId, Urutan: ui, SalesInvoiceID: r.siId, UrutanOverride: null });
        });
        // BBM per trip, tol/parkir sesekali.
        const bbm = Math.round(((dist / a.kmpl) * (a.brand === "Suzuki" ? 10000 : 6800)) / 1000) * 1000;
        kasExpense.push({ ms: jam + durasi * MIN, acc: "6108", amt: bbm, memo: `BBM ${a.nama}` });
        if (rand() < 0.3) kasExpense.push({ ms: jam + durasi * MIN, acc: "6117", amt: intBetween(2, 8) * 5000, memo: `Tol & parkir ${a.nama}` });
      });
    });

    // TakeAway di pabrik sepanjang hari.
    const nTA = Math.round(intBetween(8, 18) * factor);
    const ta = mitra.filter((m) => m.tipe === "TakeAway");
    for (let k = 0; k < nTA; k++) {
      const m = pick(ta);
      const ms = d + intBetween(6, 17) * HOUR + intBetween(0, 59) * MIN;
      makeOrder(m, orderLines(m, factor), ms - intBetween(2, 20) * MIN, ms, "0127", "", null);
    }

    // Kebutuhan rumah tangga kantor 2x seminggu.
    if (dow === 2 || dow === 5) kasExpense.push({ ms: d + 9 * HOUR, acc: "6121", amt: intBetween(15, 60) * 10000, memo: "Rumah tangga kantor" });
    // Upah mingguan pekerja produksi, sopir & kernet tiap Sabtu (tunai).
    if (dow === 6) kasExpense.push({ ms: d + 14 * HOUR, acc: "6101.01", amt: intBetween(305, 335) * 100_000, memo: "Upah mingguan produksi & distribusi" });
  });

  // ---------- Pelunasan ----------
  const today = end + DAY - MIN;
  const payments = new Map<string, { bp: Mitra; ms: number; acc: string; parts: { inv: Inv; amt: number }[] }>();
  const addPay = (inv: Inv, ms: number, amt: number) => {
    if (ms > today) return;
    const dayKey = ms - (ms % DAY);
    const acc = inv.bp.top === "014" ? "1102" : weighted([["1102", 75], ["1201", 22], ["1101", 3]]);
    const key = `${inv.bp.id}:${dayKey}:${acc}`;
    const p = payments.get(key) ?? { bp: inv.bp, ms: dayKey + intBetween(13, 18) * HOUR + intBetween(0, 59) * MIN, acc, parts: [] };
    p.parts.push({ inv, amt });
    payments.set(key, p);
  };
  for (const inv of invoices) {
    const late = inv.bp.payer === "baik" ? weighted([[-2, 30], [0, 50], [3, 15], [10, 5]])
      : inv.bp.payer === "sedang" ? weighted([[0, 30], [5, 35], [15, 25], [30, 10]])
      : weighted([[7, 20], [20, 30], [40, 25], [999, 25]]);
    if (inv.bp.top === "014") { addPay(inv, rand() < 0.96 ? inv.ms + intBetween(5, 90) * MIN : inv.ms + intBetween(1, 3) * DAY, inv.netto); continue; }
    if (late === 999) continue; // macet, belum dibayar
    const payMs = Math.max(inv.ms + DAY, inv.due + (late + intBetween(-1, 2)) * DAY);
    if (rand() < 0.08 && inv.netto > 100000) {
      const first = Math.round(inv.netto / 2 / 1000) * 1000;
      addPay(inv, payMs, first);
      addPay(inv, payMs + intBetween(5, 15) * DAY, inv.netto - first);
    } else addPay(inv, payMs, inv.netto);
  }
  const paid = new Map<string, number>();
  // Jam bayar default sore hari, tapi tidak boleh mendahului faktur yang dibayar.
  for (const p of payments.values()) p.ms = Math.min(today, Math.max(p.ms, ...p.parts.map((x) => x.inv.ms + intBetween(5, 40) * MIN)));
  for (const p of [...payments.values()].sort((a, b) => a.ms - b.ms)) {
    const spId = `01${seq.sp++}`, no = voucher("SP", p.ms), total = p.parts.reduce((s, x) => s + x.amt, 0);
    SP.push({ SalesPaymentID: spId, VoucherNo: no, TransDate: fmtWib(p.ms), Notes: "", BusinessPartnerID: p.bp.id, Amount: total, IsDeleted: false,
      ModifiedDate: fmtWib(p.ms), ChartOfAccountID: COA(p.acc), BranchID: BRANCH, ChartOfAccountTaxID: "", ChartOfAccountExpenseID: "", ChartOfAccountDiscID: "",
      CurrencyID: "", Rate: 1, ChartOfAccountDepositID: "", DepartmentID: DEPT, IsAccountReceiveable: false, EDC: "", CardNo: "" });
    for (const part of p.parts) {
      SPD.push({ SalesPaymentDetailID: `01${seq.spd++}`, SalesPaymentID: spId, SalesInvoiceID: part.inv.siId, Amount: part.amt, Deposit: 0, DiscRp: 0,
        ModifiedDate: fmtWib(p.ms), IsDeleted: false, AddTax: 0, Expense: 0 });
      paid.set(part.inv.siId, (paid.get(part.inv.siId) ?? 0) + part.amt);
    }
    const j = `01${seq.gl++}`;
    gl(j, no, p.ms, "SALESPAYMENT", p.acc, total, 0, p.bp.id);
    gl(j, no, p.ms, "SALESPAYMENT", "1301", 0, total, p.bp.id);
  }
  for (const s of SI) {
    s.Paid = paid.get(s.SalesInvoiceID) ?? 0;
    s.IsClosed = s.Paid >= s.Netto;
  }

  // ---------- Saldo awal neraca (sehari sebelum periode) ----------
  const opening = start - DAY + 23 * HOUR;
  const openLines: [string, number, number][] = [
    ["1101", 15_000_000, 0], ["1102", 8_000_000, 0], ["1201", 185_000_000, 0], ["14011", 35_000_000, 0], ["14013", 4_000_000, 0],
    ["1701", 450_000_000, 0], ["1702", 900_000_000, 0], ["1703", 1_350_000_000, 0], ["1704", 720_000_000, 0],
    ["1801", 0, 380_000_000], ["1802", 0, 260_000_000], ["1806", 0, 120_000_000], ["2103", 0, 240_000_000],
    ["3101", 0, 1_500_000_000], ["3102", 0, 500_000_000],
  ];
  const bal = openLines.reduce((s, [, dr, cr]) => s + dr - cr, 0);
  openLines.push(["3201", 0, bal]);
  journal(voucher("JV", opening), opening, "VOUCHER", openLines, "Saldo awal");

  // ---------- Produksi & bahan baku ----------
  for (const [dayMs, q] of [...qtySoldByDay.entries()].sort((a, b) => a[0] - b[0])) {
    const ms = dayMs + 4 * HOUR;
    const v = q.k * hppOf(ms, "019") * between(1.0, 1.04), v5 = q.k5 * hppOf(ms, "0111") * between(1.0, 1.04);
    const lines: [string, number, number][] = [["14013", v, 0], ["14011", 0, v + v5]];
    if (v5 > 0) lines.push(["14013.1", v5, 0]);
    journal(voucher("TR", ms), ms, "TRANSFORMATION", lines, "Hasil produksi harian");
  }
  // Pembelian plastik mingguan: terima barang -> faktur -> bayar 14 hari kemudian.
  for (let d = start; d <= end; d += 7 * DAY) {
    const amt = Math.round((between(7.5, 9.5) * 1_000_000) / 1000) * 1000;
    const gr = voucher("GR", d + 8 * HOUR);
    journal(gr, d + 8 * HOUR, "GOODSRECEIVED", [["14011", amt, 0], ["2104", 0, amt]], "Plastik kemasan");
    journal(voucher("PI", d + 2 * DAY), d + 2 * DAY + 10 * HOUR, "PURCHASEINVOICE", [["2104", amt, 0], ["2101", 0, amt]], "Plastik kemasan");
    if (d + 16 * DAY <= today) journal(voucher("PP", d + 16 * DAY), d + 16 * DAY + 10 * HOUR, "PURCHASEPAYMENT", [["2101", amt, 0], ["1201", 0, amt]], "Plastik kemasan");
  }

  // ---------- Biaya ----------
  for (const e of kasExpense.sort((a, b) => a.ms - b.ms)) journal(voucher("EX", e.ms), e.ms, "EXPENSE", [[e.acc, e.amt, 0], ["1102", 0, e.amt]], e.memo);
  for (const ym of months) {
    const [y, mo] = ym.split("-").map(Number);
    const at = (dd: number, h = 10) => Date.UTC(y, mo - 1, dd, h);
    const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const push = (ms: number, lines: [string, number, number][], memo: string) => {
      if (ms >= start && ms <= today) journal(voucher("JV", ms), ms, "VOUCHER", lines, memo);
    };
    const listrik = 238_000_000 + intBetween(-8, 8) * 1_000_000;
    push(at(20), [["6105", listrik, 0], ["1201", 0, listrik]], "Tagihan listrik PLN");
    push(at(25), [["6101.01", 92_000_000, 0], ["6101.03", 6_300_000, 0], ["6101.04", 9_000_000, 0], ["1201", 0, 107_300_000]], "Gaji staf & BPJS karyawan");
    push(at(15), [["6115", 5_800_000, 0], ["1201", 0, 5_800_000]], "Air PDAM");
    push(at(5), [["6103", 20_000_000, 0], ["1201", 0, 20_000_000]], "Sewa gudang pendingin");
    const mesin = 14_500_000 + intBetween(-2, 3) * 500_000;
    push(at(12), [["6110", mesin, 0], ["1201", 0, mesin]], "Perawatan mesin produksi");
    push(at(18), [["8003", 6_200_000, 0], ["2103", 9_800_000, 0], ["1201", 0, 16_000_000]], "Angsuran leasing kendaraan");
    const lain = 11_000_000 + intBetween(-4, 4) * 500_000;
    push(at(22), [["6199", lain, 0], ["1201", 0, lain]], "Beban usaha lainnya");
    push(at(lastDay, 16), [["6401", 22_500_000, 0], ["6402", 12_000_000, 0], ["6405", 3_750_000, 0], ["1801", 0, 22_500_000], ["1802", 0, 12_000_000], ["1806", 0, 3_750_000]], "Penyusutan aset tetap");
    push(at(lastDay, 17), [["8002", 85_000, 0], ["1201", 0, 85_000]], "Biaya administrasi bank");
    push(at(lastDay, 17), [["1201", 420_000, 0], ["7001", 0, 420_000]], "Bunga bank");
    push(at(10), [["6126.3", 2_400_000, 0], ["1102", 0, 2_400_000]], "Ganti oli armada");
  }
  // Setoran kas kecil ke bank tiap 2-3 hari, sisakan kas Rp5 juta.
  const kasDelta = new Map<number, number>();
  const kk = COA("1102");
  for (const g of GL) if (g.ChartOfAccountID === kk) {
    const dayMs = wibDay(g.TransDate.slice(0, 10));
    kasDelta.set(dayMs, (kasDelta.get(dayMs) ?? 0) + g.Debit - g.Credit);
  }
  let kas = 0;
  days.forEach((d, i) => {
    kas += kasDelta.get(d) ?? 0;
    if (i % 3 === 2 && kas > 5_000_000) {
      const amt = Math.floor((kas - 5_000_000) / 100_000) * 100_000;
      const ms = d + 15 * HOUR;
      if (ms <= today) { journal(voucher("JV", ms), ms, "VOUCHER", [["1201", amt, 0], ["1102", 0, amt]], "Setoran kas kecil ke bank"); kas -= amt; }
    }
  });

  // ---------- Simpan ----------
  console.log("Transaksi:");
  await insertRows(pool, "ItemAverage", months.slice(0, -1).flatMap((ym, i) => Object.entries(hpp[ym]).map(([itemId, avg], k) => ({
    ItemAverageID: `01${9000 + i * 10 + k}`, Year: Number(ym.slice(0, 4)), Month: Number(ym.slice(5, 7)), ItemID: itemId, Average: avg, AverageDiff: 0,
    IsDeleted: false, ModifiedDate: fmtWib(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 3, 9)) }))));
  await insertRows(pool, "SalesOrder", SO);
  await insertRows(pool, "SalesOrderDetail", SOD);
  await insertRows(pool, "DeliveryOrder", DO);
  await insertRows(pool, "DeliveryOrderDetail", DOD);
  await insertRows(pool, "SalesInvoice", SI);
  await insertRows(pool, "SalesInvoiceDetail", SID);
  await insertRows(pool, "SalesPayment", SP);
  await insertRows(pool, "SalesPaymentDetail", SPD);
  await insertRows(pool, "GeneralLedger", GL);
  await insertRows(pool, "DashboardPengirimanJadwal", JADWAL);
  await insertRows(pool, "DashboardPengirimanJadwalDetail", JDET);
  // Target bulanan sedikit di atas laju realisasi supaya progres terlihat wajar.
  const siMonth = new Map<string, string>(SI.map((s) => [s.SalesInvoiceID, s.TransDate.slice(0, 7)]));
  await insertRows(pool, "DashboardMonthlyTarget", months.map((ym) => {
    const rev = SI.filter((s) => s.TransDate.startsWith(ym)).reduce((x, s) => x + s.Netto, 0);
    const qty = SID.filter((x) => siMonth.get(x.SalesInvoiceID) === ym).reduce((q, x) => q + x.Qty, 0);
    const daysIn = new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
    const covered = days.filter((d) => ymOf(d) === ym).length;
    return { TargetYear: Number(ym.slice(0, 4)), TargetMonth: Number(ym.slice(5, 7)),
      TargetNominal: Math.round(((rev / covered) * daysIn * 1.08) / 1e6) * 1e6, TargetQty: Math.round((qty / covered) * daysIn * 1.08),
      CreatedAt: fmtUtc(wibDay(`${ym}-01`)), UpdatedAt: fmtUtc(wibDay(`${ym}-01`)) };
  }));

  const v = (await pool.request().query(`
    SELECT (SELECT COUNT(*) FROM BusinessPartner) mitra, (SELECT COUNT(*) FROM SalesInvoice) si, (SELECT SUM(Netto) FROM SalesInvoice) omzet,
           (SELECT SUM(Netto-Paid) FROM SalesInvoice) piutang, (SELECT SUM(Debit)-SUM(Credit) FROM GeneralLedger) gl_selisih,
           (SELECT COUNT(*) FROM DashboardPengirimanJadwal) jadwal`)).recordset[0];
  console.log("Ringkasan:", v);
  await pool.close();
  process.exit(0);
}

main().catch((err) => {
  console.error("GENERATOR GAGAL:", err);
  process.exit(1);
});
