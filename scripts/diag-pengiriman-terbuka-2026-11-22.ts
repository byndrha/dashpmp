// Uji BACA-SAJA (2026-11-22): sebaran data tab "Pengiriman Terbuka" — berapa
// baris DO IsClosed=0 yang masih punya sisa kirim, dan umurnya.
import "dotenv/config";
import { getOpenDeliveries } from "../src/lib/queries/delivery";

async function main() {
  const rows = await getOpenDeliveries();
  const hari = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  const ember: Record<string, { baris: number; sisaPositif: number; sisa: number; do: Set<string> }> = {};
  for (const r of rows) {
    const h = hari(r.TransDate);
    const k = h <= 7 ? "≤7 hari" : h <= 30 ? "8–30 hari" : h <= 90 ? "31–90 hari" : h <= 365 ? "91–365 hari" : "> 1 tahun";
    const e = (ember[k] ??= { baris: 0, sisaPositif: 0, sisa: 0, do: new Set() });
    e.baris++;
    if (r.SisaBelumDikirim > 0) { e.sisaPositif++; e.sisa += r.SisaBelumDikirim; e.do.add(r.DeliveryOrderID); }
  }
  console.log("total baris", rows.length, "| DO unik", new Set(rows.map((r) => r.DeliveryOrderID)).size);
  console.table(Object.fromEntries(Object.entries(ember).map(([k, v]) => [k, { baris: v.baris, barisBersisa: v.sisaPositif, doBersisa: v.do.size, sisa: v.sisa }])));
  const negatif = rows.filter((r) => r.SisaBelumDikirim < 0).length;
  console.log("baris sisa negatif:", negatif, "| sudah ditagih & bersisa:", rows.filter((r) => r.IsInvoiced && r.SisaBelumDikirim > 0).length);
  console.log("panjang JSON ≈", (JSON.stringify(rows).length / 1e6).toFixed(2), "MB");
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
