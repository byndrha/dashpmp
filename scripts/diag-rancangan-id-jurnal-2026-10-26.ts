import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY utk RANCANGAN migrasi "ID jurnal dashboard = ID dokumen".
// Mengklasifikasi tiap jurnal dashboard (memo [DASHPMP-]) menurut apa yang terjadi bila ID-nya diganti ke ID dokumennya.
type Row = { Type: string; ID: string; VoucherNo: string; dash: number; n: number; deb: number; cr: number };
async function main() {
  const pool = await getPool();
  const q = async <T = Record<string, unknown>>(s: string) => (await pool.request().query(s)).recordset as T[];

  // 1) jurnal GL sejak 20 Agu 2026 yang bertipe DO/SI/SR, dikelompokkan per (Type, ID, VoucherNo)
  const gl = await q<Row>(`
    SELECT g.[Type], g.ID, g.VoucherNo, MAX(CASE WHEN LEFT(ISNULL(g.Memo,''),9)='[DASHPMP-' THEN 1 ELSE 0 END) dash,
           COUNT(*) n, SUM(g.Debit) deb, SUM(g.Credit) cr
    FROM GeneralLedger g
    WHERE g.TransDate >= '2026-08-20' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE','SALESRETURN')
    GROUP BY g.[Type], g.ID, g.VoucherNo`);
  console.log("jurnal (Type,ID,Voucher) sejak 20 Agu:", gl.length);

  // 2) dokumen: voucher -> daftar doc (id, isDeleted)
  type Doc = { id: string; voucher: string; del: boolean };
  const ambil = async (tabel: string, kolom: string) =>
    (await q<{ id: string; voucher: string; del: boolean }>(`SELECT ${kolom} AS id, VoucherNo AS voucher, IsDeleted AS del FROM ${tabel} WHERE TransDate >= '2026-08-01'`));
  const docs: Record<string, Doc[]> = {
    DELIVERYORDER: await ambil("DeliveryOrder", "DeliveryOrderID"),
    SALESINVOICE: await ambil("SalesInvoice", "SalesInvoiceID"),
    SALESRETURN: await ambil("SalesReturn", "SalesReturnID"),
  };
  const perVoucher: Record<string, Map<string, Doc[]>> = {};
  for (const [t, ds] of Object.entries(docs)) { const m = new Map<string, Doc[]>(); for (const d of ds) m.set(d.voucher, [...(m.get(d.voucher) ?? []), d]); perVoucher[t] = m; }
  const maksId: Record<string, number> = {};
  for (const [t, ds] of Object.entries(docs)) maksId[t] = Math.max(...ds.map((d) => Number(d.id)).filter(Number.isFinite));

  // 3) peta slot (Type, ID) -> pemegang jurnal
  const slot = new Map<string, Row[]>();
  for (const r of gl) slot.set(`${r.Type}|${r.ID}`, [...(slot.get(`${r.Type}|${r.ID}`) ?? []), r]);

  const dashboard = gl.filter((r) => r.dash === 1);
  const kelas: Record<string, { n: number; deb: number; contoh: string[] }> = {};
  const catat = (k: string, r: Row, contoh?: string) => { (kelas[k] ??= { n: 0, deb: 0, contoh: [] }).n++; kelas[k].deb += r.deb; if (kelas[k].contoh.length < 3) kelas[k].contoh.push(contoh ?? `${r.Type[0]} ${r.VoucherNo} id=${r.ID}`); };
  const berbahaya: Record<string, number> = {};
  for (const r of dashboard) {
    const cand = perVoucher[r.Type]?.get(r.VoucherNo) ?? [];
    if (cand.length === 0) { catat("D. tanpa dokumen (yatim/di luar jendela)", r); continue; }
    if (cand.length > 1) { catat("E. voucher kembar (>1 dokumen) -> tinjau manual", r); continue; }
    const doc = cand[0];
    if (doc.del) { catat("D2. dokumen sudah terhapus (yatim)", r); continue; }
    if (r.ID === doc.id) { catat("A. sudah ID = ID dokumen", r); continue; }
    const pemegang = (slot.get(`${r.Type}|${doc.id}`) ?? []).filter((x) => x.VoucherNo !== r.VoucherNo);
    const sama = (slot.get(`${r.Type}|${doc.id}`) ?? []).filter((x) => x.VoucherNo === r.VoucherNo);
    if (sama.length > 0) { catat("C2. slot tujuan dipegang jurnal voucher YANG SAMA (duplikat)", r); continue; }
    if (pemegang.length === 0) catat("B1. slot tujuan KOSONG -> langsung bisa dipindah", r);
    else if (pemegang.every((x) => x.dash === 1)) catat("B2. slot dipegang jurnal dashboard lain (pindah berantai/2 fase)", r);
    else catat("C1. slot dipegang jurnal ERP voucher lain -> tinjau manual", r);
    if (Number(r.ID) > maksId[r.Type]) berbahaya[r.Type] = (berbahaya[r.Type] ?? 0) + 1;
  }
  console.log("== KLASIFIKASI jurnal dashboard (Type,ID,Voucher) ==");
  for (const k of Object.keys(kelas).sort()) console.log(k, JSON.stringify({ n: kelas[k].n, debit: Math.round(kelas[k].deb), contoh: kelas[k].contoh }));
  console.log("== ID dokumen terbesar per tipe ==", JSON.stringify(maksId));
  console.log("== jurnal dashboard (butuh pindah) yg ID-nya > ID dokumen terbesar tipe itu (bom waktu) ==", JSON.stringify(berbahaya));
  const perTipe = dashboard.reduce((a: Record<string, number>, r) => ({ ...a, [r.Type]: (a[r.Type] ?? 0) + 1 }), {});
  console.log("== jurnal dashboard per tipe ==", JSON.stringify(perTipe));
  const berantai = new Set<string>();
  for (const r of dashboard) { const d = perVoucher[r.Type]?.get(r.VoucherNo); if (d?.length === 1 && !d[0].del && r.ID !== d[0].id) berantai.add(`${r.Type}|${d[0].id}`); }
  // deteksi siklus tukar (J1.target dipegang J2 dan J2.target dipegang J1)
  let siklus = 0;
  for (const r of dashboard) {
    const d = perVoucher[r.Type]?.get(r.VoucherNo); if (!(d?.length === 1) || d[0].del) continue;
    for (const p of slot.get(`${r.Type}|${d[0].id}`) ?? []) {
      if (p.dash !== 1 || p.VoucherNo === r.VoucherNo) continue;
      const dp = perVoucher[p.Type]?.get(p.VoucherNo); if (!(dp?.length === 1) || dp[0].del) continue;
      if (dp[0].id === r.ID) siklus++;
    }
  }
  console.log("== pasangan siklus tukar-posisi ==", siklus / 2);
  await pool.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
