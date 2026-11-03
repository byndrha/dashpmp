import "dotenv/config";
import { getPool } from "../src/lib/db";

// DIAGNOSTIK READ-ONLY: komposisi saldo 1399 Oktober 2026 per kategori DO.
type G = { Type: string; VoucherNo: string; net: number };
type DO = { id: string; voucherNo: string; invoiced: boolean; terhapus: boolean };
type SI = { id: string; voucherNo: string; doId: string; terhapus: boolean };

async function main() {
  const pool = await getPool();
  const q = async <T>(s: string) => (await pool.request().query(s)).recordset as T[];
  const gl = await q<G>(`
    SELECT g.[Type], g.VoucherNo, SUM(g.Debit-g.Credit) net FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID
    WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01' AND g.[Type] IN ('DELIVERYORDER','SALESINVOICE','SALESRETURN') GROUP BY g.[Type], g.VoucherNo`);
  const dos = await q<DO>(`SELECT DeliveryOrderID id, VoucherNo voucherNo, IsInvoiced invoiced, IsDeleted terhapus FROM DeliveryOrder WHERE TransDate>='2026-09-25'`);
  const sis = await q<SI>(`SELECT SalesInvoiceID id, VoucherNo voucherNo, REPLACE(DeliveryOrderID,'''','') doId, IsDeleted terhapus FROM SalesInvoice WHERE TransDate>='2026-09-25'`);
  const srs = await q<SI>(`SELECT SalesReturnID id, VoucherNo voucherNo, REPLACE(DeliveryOrderID,'''','') doId, IsDeleted terhapus FROM SalesReturn WHERE TransDate>='2026-09-25'`);

  const netGL = new Map<string, number>(); for (const g of gl) netGL.set(`${g.Type}|${g.VoucherNo}`, (netGL.get(`${g.Type}|${g.VoucherNo}`) ?? 0) + g.net);
  const siPerDo = new Map<string, SI[]>(); for (const s of sis.filter((x) => !x.terhapus)) siPerDo.set(s.doId, [...(siPerDo.get(s.doId) ?? []), s]);
  const srPerDo = new Map<string, SI[]>(); for (const s of srs.filter((x) => !x.terhapus)) srPerDo.set(s.doId, [...(srPerDo.get(s.doId) ?? []), s]);
  const doByVoucher = new Map<string, DO>(); for (const d of dos) doByVoucher.set(d.voucherNo, d);
  const dipakai = new Set<string>();

  const kat: Record<string, { n: number; net: number; contoh: string[] }> = {};
  const catat = (k: string, net: number, c: string) => { const x = (kat[k] ??= { n: 0, net: 0, contoh: [] }); x.n++; x.net += net; if (x.contoh.length < 3) x.contoh.push(c); };
  for (const [kunci, debit] of netGL) {
    const [tipe, voucher] = kunci.split("|");
    if (tipe !== "DELIVERYORDER") continue;
    const d = doByVoucher.get(voucher);
    if (!d || d.terhapus) { catat("X. jurnal DO milik DO terhapus/tak ditemukan", debit, voucher); dipakai.add(kunci); continue; }
    const kredit = (siPerDo.get(d.id) ?? []).reduce((s, x) => { dipakai.add(`SALESINVOICE|${x.voucherNo}`); return s + (netGL.get(`SALESINVOICE|${x.voucherNo}`) ?? 0); }, 0)
                 + (srPerDo.get(d.id) ?? []).reduce((s, x) => { dipakai.add(`SALESRETURN|${x.voucherNo}`); return s + (netGL.get(`SALESRETURN|${x.voucherNo}`) ?? 0); }, 0);
    dipakai.add(kunci);
    const sisa = debit + kredit; // kredit bernilai negatif (Debit-Credit)
    const adaSIAktif = (siPerDo.get(d.id) ?? []).length > 0;
    if (Math.abs(sisa) < 0.5) catat("A. DO seimbang dengan SI/SR (nol)", sisa, voucher);
    else if (!d.invoiced && !adaSIAktif) catat("B. DO belum ditagih (barang dalam perjalanan -- wajar)", sisa, voucher);
    else if (adaSIAktif && Math.abs(kredit) < 0.5) catat("C. DO sudah ber-SI aktif tapi SI belum punya kredit 1399 (SI buatan ERP 2 baris, menunggu closing)", sisa, voucher);
    else if (adaSIAktif) catat("D. DO ber-SI aktif, kredit 1399 SI tidak sama dgn debit DO", sisa, `${voucher} debit=${debit.toFixed(2)} kredit=${kredit.toFixed(2)}`);
    else catat("E. DO IsInvoiced=1 tapi tak ada SI aktif terhubung", sisa, voucher);
  }
  // jurnal SI/SR 1399 yang tidak terpakai oleh DO manapun (yatim / SI tanpa DO terhubung)
  for (const [kunci, net] of netGL) {
    if (dipakai.has(kunci) || kunci.startsWith("DELIVERYORDER")) continue;
    catat("Y. jurnal SI/SR 1399 tanpa DO terhubung (SI terhapus / DO tidak ditemukan)", net, kunci);
  }
  let total = 0;
  for (const k of Object.keys(kat).sort()) { total += kat[k].net; console.log(k, JSON.stringify({ n: kat[k].n, net: Math.round(kat[k].net), contoh: kat[k].contoh })); }
  console.log("TOTAL terklasifikasi:", Math.round(total * 100) / 100);
  const tot = await q<{ s: number }>(`SELECT SUM(g.Debit-g.Credit) s FROM GeneralLedger g JOIN ChartOfAccount c ON c.ChartOfAccountID=g.ChartOfAccountID WHERE c.AccountNo='1399' AND g.TransDate>='2026-10-01'`);
  console.log("Net 1399 Oktober (basis data):", tot[0].s, "(jendela DO sejak 25 Sep; selisih = jurnal Sep yg beririsan, jika ada)");
  await pool.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
