import { getPool, sql } from "@/lib/db";
import { getCompanyPool } from "@/lib/db-company";
import { resolveAgenKoneksi, type SumberAgen } from "@/lib/queries/mitra-es-balok";
import { branchFilterFor } from "@/lib/queries/piutang-pembayaran";
import { getEsBalokInvoiceOutstanding } from "@/lib/queries/piutang-invoice-outstanding";
import type { MitraRingkas, PtKode } from "@/lib/bychat/mitra";
import {
  fakturLunasEsBalok,
  sejakWib,
  susunRiwayat,
  type FakturLunasRiwayat,
  type PembayaranRiwayat,
  type RentangRiwayat,
  type RiwayatMitra,
} from "@/lib/bychat/riwayat-util";

// Riwayat pembayaran + faktur lunas satu mitra pada rentang N hari terakhir,
// seluruhnya (tanpa paginasi), SELALU terhadap database satu PT.

const iso = (d: Date | string) => new Date(d).toISOString().slice(0, 10);

async function riwayatMkesindo(mitra: MitraRingkas, sejak: string): Promise<{ pembayaran: PembayaranRiwayat[]; fakturLunas: FakturLunasRiwayat[] }> {
  const pool = await getPool();

  const bayar = await pool
    .request()
    .input("bp", sql.VarChar(16), mitra.id)
    .input("sejak", sql.Date, sejak)
    .query(`
      SELECT SalesPaymentID, VoucherNo, TransDate, Amount, Notes
      FROM SalesPayment WITH (NOLOCK)
      WHERE IsDeleted = 0 AND BusinessPartnerID = @bp AND TransDate >= @sejak
    `);
  const bayarRows = bayar.recordset as { SalesPaymentID: string; VoucherNo: string; TransDate: Date; Amount: number; Notes: string | null }[];

  const untuk = new Map<string, string[]>();
  if (bayarRows.length > 0) {
    const req = pool.request();
    const ph = bayarRows.map((p, i) => {
      req.input(`p${i}`, sql.VarChar(16), p.SalesPaymentID);
      return `@p${i}`;
    });
    const det = await req.query(`
      SELECT spd.SalesPaymentID, si.VoucherNo
      FROM SalesPaymentDetail spd WITH (NOLOCK)
      JOIN SalesInvoice si WITH (NOLOCK) ON si.SalesInvoiceID = spd.SalesInvoiceID
      WHERE spd.IsDeleted = 0 AND spd.SalesPaymentID IN (${ph.join(",")})
      ORDER BY si.TransDate
    `);
    for (const d of det.recordset as { SalesPaymentID: string; VoucherNo: string }[]) {
      const arr = untuk.get(d.SalesPaymentID) ?? [];
      if (!arr.includes(d.VoucherNo)) arr.push(d.VoucherNo);
      untuk.set(d.SalesPaymentID, arr);
    }
  }
  const pembayaran: PembayaranRiwayat[] = bayarRows.map((p) => ({
    noDokumen: p.VoucherNo,
    tanggal: iso(p.TransDate),
    jumlah: Number(p.Amount),
    untuk: untuk.get(p.SalesPaymentID) ?? [],
    catatan: p.Notes && p.Notes.trim() ? p.Notes.trim() : null,
  }));

  // Lunas = Netto > 0 dan tak ada sisa menurut vCustomerStatement (definisi
  // outstanding yang sama dengan kartu piutang).
  const lunas = await pool
    .request()
    .input("bp", sql.VarChar(16), mitra.id)
    .input("sejak", sql.Date, sejak)
    .query(`
      WITH CustomerBalance AS (
        SELECT SalesInvoiceID, SUM(Netto) AS Netto, SUM(Deposit) AS Deposit, SUM(Paid) AS Paid, SUM(OtherPayment) AS OtherPayment
        FROM vCustomerStatement
        WHERE SalesInvoiceID IN (
          SELECT SalesInvoiceID FROM SalesInvoice WHERE BusinessPartnerID = @bp AND IsDeleted = 0 AND TransDate >= @sejak
        )
        GROUP BY SalesInvoiceID
      )
      SELECT si.SalesInvoiceID, si.VoucherNo, si.TransDate, cb.Netto,
        (SELECT MAX(sp.TransDate) FROM SalesPaymentDetail spd
           JOIN SalesPayment sp ON sp.SalesPaymentID = spd.SalesPaymentID AND sp.IsDeleted = 0
          WHERE spd.SalesInvoiceID = si.SalesInvoiceID AND spd.IsDeleted = 0) AS TanggalLunas
      FROM CustomerBalance cb JOIN SalesInvoice si ON si.SalesInvoiceID = cb.SalesInvoiceID
      WHERE si.IsDeleted = 0 AND ISNULL(si.IsPerforma, 0) = 0
        AND cb.Netto > 0 AND (cb.Netto - cb.Paid - cb.Deposit - cb.OtherPayment) <= 0
    `);
  const fakturLunas: FakturLunasRiwayat[] = (lunas.recordset as { VoucherNo: string; TransDate: Date; Netto: number; TanggalLunas: Date | null }[]).map((r) => ({
    noDokumen: r.VoucherNo,
    tanggal: iso(r.TransDate),
    nilai: Number(r.Netto),
    tanggalLunas: r.TanggalLunas ? iso(r.TanggalLunas) : null,
  }));
  return { pembayaran, fakturLunas };
}

async function riwayatEsBalok(ptKode: PtKode, mitra: MitraRingkas, sejak: string): Promise<{ pembayaran: PembayaranRiwayat[]; fakturLunas: FakturLunasRiwayat[] }> {
  const pembayaran: PembayaranRiwayat[] = [];
  const pesanan: { noDokumen: string; tanggal: string; nilai: number }[] = [];

  for (const sumber of ["utama", "logistik"] as SumberAgen[]) {
    const { kode, label } = resolveAgenKoneksi(ptKode, sumber);
    const pool = await getCompanyPool(kode, label);
    const branchId = branchFilterFor(ptKode, sumber);
    const filterBranch = branchId ? "AND BranchID = @branchId" : "";
    const baru = () => {
      const req = pool.request().input("agen", sql.VarChar(16), mitra.id).input("sejak", sql.Date, sejak);
      if (branchId) req.input("branchId", sql.VarChar(16), branchId);
      return req;
    };

    const b = await baru().query(`
      SELECT NoDokumen, Tanggal, Pembayaran, Catatan FROM PMP_Pembayaran WITH (NOLOCK)
      WHERE IsDeleted = 0 AND AgenID = @agen AND Tanggal >= @sejak AND ISNULL(Pembayaran, 0) > 0 ${filterBranch}
    `);
    for (const x of b.recordset as { NoDokumen: string; Tanggal: Date; Pembayaran: number; Catatan: string | null }[]) {
      pembayaran.push({ noDokumen: x.NoDokumen, tanggal: iso(x.Tanggal), jumlah: Number(x.Pembayaran), untuk: [], catatan: x.Catatan && x.Catatan.trim() ? x.Catatan.trim() : null });
    }

    // Pembayaran yang dicatat pada baris pemesanan itu sendiri sama artinya
    // dengan baris PMP_Pembayaran (lihat piutang-invoice-outstanding).
    const p = await baru().query(`
      SELECT NoDokumen, Tanggal, ISNULL(Pembayaran, 0) AS Bayar,
        (BalokKecilRealisasi - ISNULL(BalokKecilRetur,0)) * BalokKecilHarga
          + (BalokBesarRealisasi - ISNULL(BalokBesarRetur,0)) * BalokBesarHarga AS NetValue
      FROM PMP_Pemesanan WITH (NOLOCK)
      WHERE IsDeleted = 0 AND AgenID = @agen AND Tanggal >= @sejak ${filterBranch}
    `);
    for (const x of p.recordset as { NoDokumen: string; Tanggal: Date; Bayar: number; NetValue: number }[]) {
      pesanan.push({ noDokumen: x.NoDokumen, tanggal: iso(x.Tanggal), nilai: Number(x.NetValue) });
      if (Number(x.Bayar) > 0) {
        pembayaran.push({ noDokumen: x.NoDokumen, tanggal: iso(x.Tanggal), jumlah: Number(x.Bayar), untuk: [], catatan: "Dibayar saat pemesanan" });
      }
    }
  }

  const outstanding = new Set((await getEsBalokInvoiceOutstanding(ptKode)).filter((r) => r.agenId === mitra.id).map((r) => r.noDokumen));
  return { pembayaran, fakturLunas: fakturLunasEsBalok(pesanan, outstanding, sejak) };
}

export async function getRiwayatMitra(ptKode: PtKode, mitra: MitraRingkas, hari: RentangRiwayat): Promise<RiwayatMitra> {
  const sejak = sejakWib(hari);
  const { pembayaran, fakturLunas } = ptKode === "mkesindo" ? await riwayatMkesindo(mitra, sejak) : await riwayatEsBalok(ptKode, mitra, sejak);
  return susunRiwayat(hari, pembayaran, fakturLunas);
}
