// Ekspor .xlsx tab "Rincian per Mitra" Piutang Es Balok (PMPutra, PMPersada,
// PMPakis). Dibangun di browser dari data yang sudah ada di layar (mengikuti
// filter & urutan yang sedang aktif), tanpa query tambahan.
//
// Empat lembar:
//   1. Rekening Mitra    — satu baris per Mitra: mutasi periode, Sisa Hutang
//                          akhir periode (RUMUS, bisa diaudit), status & hutang
//                          bersih hari ini, pesanan belum lunas ERP, Selisih ERP.
//   2. Transaksi Periode — setiap pesanan/pembayaran/tarikan dalam periode.
//   3. Pesanan Belum Lunas — pesanan yang masih terbuka di ERP (semua periode).
//   4. Keterangan        — arti kolom & dua dasar angka (bersih vs ERP).
import ExcelJS from "exceljs";
import { triggerXlsxDownload } from "@/lib/export-xlsx";
import {
  ES_BALOK_JATUH_TEMPO_HARI,
  esBalokStatus,
  type EsBalokPiutangStatus,
  type RingkasanPiutangTerbuka,
} from "@/lib/piutang-es-balok-status";
import { SEGMENTASI_OPTIONS } from "@/lib/segmentasi-mitra";
import type { PiutangPerAgenRow } from "@/lib/queries/penjualan-piutang";

const RUPIAH = '"Rp "#,##0;[Red]-"Rp "#,##0;"-"';
const ANGKA = '#,##0;-#,##0;"-"';
const TANGGAL = "dd/mm/yyyy";

const WARNA = {
  judul: "FF0F172A",
  redup: "FF64748B",
  kepala: "FF1E293B",
  kepalaTeks: "FFFFFFFF",
  total: "FFF1F5F9",
  garis: "FFE2E8F0",
  hutang: "FFB91C1C",
  tabungan: "FF15803D",
  peringatan: "FFB45309",
};

const STATUS_WARNA: Record<EsBalokPiutangStatus, { isi: string; teks: string }> = {
  Sehat: { isi: "FFDCFCE7", teks: "FF166534" },
  Perhatian: { isi: "FFFEF3C7", teks: "FF92400E" },
  Kritis: { isi: "FFFEE2E2", teks: "FF991B1B" },
};

const JENIS_LABEL: Record<"pesanan" | "pembayaran" | "tarikan", string> = {
  pesanan: "Pemesanan",
  pembayaran: "Pembayaran",
  tarikan: "Tarikan tabungan",
};

function segmentasiLabel(v: PiutangPerAgenRow["segmentasi"]): string {
  if (!v) return "Belum ditentukan";
  return SEGMENTASI_OPTIONS.find((s) => s.value === v)?.label ?? String(v);
}

// "yyyy-MM-dd" → Date UTC tengah malam (ExcelJS menulis Date sebagai UTC,
// jadi tanggal tidak bergeser sehari di zona WIB).
function tanggalExcel(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function tglIndo(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}/${m}/${y}`;
}

function garisTipis(cell: ExcelJS.Cell) {
  cell.border = { bottom: { style: "thin", color: { argb: WARNA.garis } } };
}

// Blok judul di atas tabel; mengembalikan nomor baris kepala tabel.
function tulisJudul(sheet: ExcelJS.Worksheet, judul: string, baris: string[], lebarKolom: number): number {
  sheet.mergeCells(1, 1, 1, lebarKolom);
  const j = sheet.getCell(1, 1);
  j.value = judul;
  j.font = { bold: true, size: 14, color: { argb: WARNA.judul } };
  baris.forEach((teks, i) => {
    sheet.mergeCells(2 + i, 1, 2 + i, lebarKolom);
    const c = sheet.getCell(2 + i, 1);
    c.value = teks;
    c.font = { size: 10, color: { argb: WARNA.redup } };
  });
  return baris.length + 3; // satu baris kosong sebelum kepala tabel
}

function tulisKepala(sheet: ExcelJS.Worksheet, nomorBaris: number, kepala: string[]) {
  const row = sheet.getRow(nomorBaris);
  kepala.forEach((h, i) => {
    const c = row.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: WARNA.kepalaTeks } };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.kepala } };
    c.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  });
  row.height = 32;
}

function gayaTotal(row: ExcelJS.Row, jumlahKolom: number) {
  for (let i = 1; i <= jumlahKolom; i++) {
    const c = row.getCell(i);
    c.font = { ...(c.font ?? {}), bold: true };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.total } };
    c.border = { top: { style: "thin", color: { argb: WARNA.kepala } } };
  }
}

function kolomHuruf(n: number): string {
  let s = "";
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export interface EksporRekeningMitraInput {
  namaPerusahaan: string;
  awalISO: string;
  akhirISO: string;
  filterAktif: string[]; // mis. ["Status: Kritis", "Cari: \"restu\""]
  rows: PiutangPerAgenRow[]; // sudah difilter & diurut seperti di layar
  terbuka: RingkasanPiutangTerbuka;
}

// Membangun workbook saja (tanpa unduh) — dipisah supaya bisa diuji di Node.
export function bangunRekeningMitra(input: EksporRekeningMitraInput): { workbook: ExcelJS.Workbook; namaFile: string } {
  const { namaPerusahaan, awalISO, akhirISO, filterAktif, rows, terbuka } = input;
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dashboard PMP Group";
  wb.created = new Date();

  const dicetak = new Intl.DateTimeFormat("id-ID", {
    timeZone: "Asia/Jakarta",
    dateStyle: "long",
    timeStyle: "short",
  }).format(new Date());
  const periode = `Periode ${tglIndo(awalISO)} s.d. ${tglIndo(akhirISO)}`;
  const infoUmum = [
    `${namaPerusahaan} · Es Balok`,
    periode,
    `Filter: ${filterAktif.length ? filterAktif.join(" · ") : "tidak ada (semua Mitra)"} · ${rows.length} Mitra`,
    `Dicetak ${dicetak} WIB`,
  ];
  const bersihDari = (agenId: string) => (terbuka.bersih ? terbuka.bersih[agenId] : terbuka.agen[agenId]);

  // ---------------------------------------------------------------- Lembar 1
  const s1 = wb.addWorksheet("Rekening Mitra", { properties: { defaultRowHeight: 18 } });
  const KEPALA_1 = [
    "No",
    "Kode",
    "Mitra",
    "Segmentasi",
    "Piutang Awal",
    "Tabungan Awal",
    "Pesanan",
    "Retur",
    "Pembayaran",
    "Tarikan",
    "Saldo Akhir Periode",
    "Jenis Saldo",
    "Status Hari Ini",
    "Hutang Bersih Hari Ini",
    "Tagihan Terlama (hari lewat jatuh tempo)",
    "Pesanan Belum Lunas (ERP)",
    "Selisih ERP",
  ];
  const lebar1 = [5, 9, 28, 16, 15, 15, 16, 13, 16, 14, 18, 12, 13, 18, 18, 18, 15];
  lebar1.forEach((w, i) => (s1.getColumn(i + 1).width = w));
  const kepala1 = tulisJudul(s1, "Rekening Mitra — Piutang Es Balok", infoUmum, KEPALA_1.length);
  tulisKepala(s1, kepala1, KEPALA_1);

  const awalData1 = kepala1 + 1;
  rows.forEach((r, i) => {
    const n = awalData1 + i;
    const bersih = bersihDari(r.agenId);
    const fifo = terbuka.agen[r.agenId];
    const status = esBalokStatus(bersih ? bersih[1] : null);
    const hutangBersih = bersih ? bersih[0] : 0;
    const erp = fifo ? fifo[0] : 0;
    const selisih = Math.max(0, erp - hutangBersih);
    const row = s1.getRow(n);
    row.values = [
      i + 1,
      r.agenId,
      r.nama,
      segmentasiLabel(r.segmentasi),
      r.hutangAwal,
      r.tabunganAwal,
      r.pesanan,
      r.retur,
      r.pembayaran,
      r.tarikan,
      // Sisa Hutang = Piutang Awal − Tabungan Awal + Pesanan − Retur − Pembayaran + Tarikan
      { formula: `E${n}-F${n}+G${n}-H${n}-I${n}+J${n}`, result: r.saldoAkhir },
      r.saldoAkhir > 0 ? "Hutang" : r.saldoAkhir < 0 ? "Tabungan" : "Lunas",
      status,
      hutangBersih,
      bersih ? (bersih[1] >= 9999 ? "Saldo awal ERP" : bersih[1]) : null,
      erp,
      selisih,
    ];
    for (const c of [5, 6, 7, 8, 9, 10, 11, 14, 16, 17]) row.getCell(c).numFmt = RUPIAH;
    row.getCell(15).numFmt = '0;"belum jatuh tempo ("0")";0';
    row.getCell(15).alignment = { horizontal: "center" };
    row.getCell(1).alignment = { horizontal: "center" };
    const jenis = row.getCell(12);
    jenis.font = { color: { argb: r.saldoAkhir > 0 ? WARNA.hutang : r.saldoAkhir < 0 ? WARNA.tabungan : WARNA.redup } };
    const st = row.getCell(13);
    st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_WARNA[status].isi } };
    st.font = { bold: true, color: { argb: STATUS_WARNA[status].teks } };
    st.alignment = { horizontal: "center" };
    if (selisih >= 1) row.getCell(17).font = { bold: true, color: { argb: WARNA.peringatan } };
    for (let c = 1; c <= KEPALA_1.length; c++) garisTipis(row.getCell(c));
  });
  const akhirData1 = awalData1 + rows.length - 1;
  const total1 = s1.getRow(akhirData1 + 1);
  total1.getCell(3).value = `Total ${rows.length} Mitra`;
  if (rows.length > 0) {
    for (const c of [5, 6, 7, 8, 9, 10, 11, 14, 16, 17]) {
      const h = kolomHuruf(c);
      total1.getCell(c).value = { formula: `SUM(${h}${awalData1}:${h}${akhirData1})` };
      total1.getCell(c).numFmt = RUPIAH;
    }
  }
  gayaTotal(total1, KEPALA_1.length);
  s1.views = [{ state: "frozen", ySplit: kepala1, xSplit: 3 }];
  if (rows.length > 0) s1.autoFilter = { from: { row: kepala1, column: 1 }, to: { row: akhirData1, column: KEPALA_1.length } };

  // ---------------------------------------------------------------- Lembar 2
  const s2 = wb.addWorksheet("Transaksi Periode");
  const KEPALA_2 = ["Tanggal", "No Dokumen", "Jenis", "Kode", "Mitra", "Es Balok Kecil", "Es Balok Besar", "Menambah Hutang", "Mengurangi Hutang"];
  [12, 30, 17, 9, 28, 13, 13, 17, 17].forEach((w, i) => (s2.getColumn(i + 1).width = w));
  const kepala2 = tulisJudul(s2, "Transaksi Periode — Piutang Es Balok", infoUmum, KEPALA_2.length);
  tulisKepala(s2, kepala2, KEPALA_2);
  const transaksi = rows
    .flatMap((r) => r.transaksi.map((t) => ({ r, t })))
    .sort((a, b) => a.t.tanggal.localeCompare(b.t.tanggal) || a.r.nama.localeCompare(b.r.nama));
  const awalData2 = kepala2 + 1;
  transaksi.forEach(({ r, t }, i) => {
    const row = s2.getRow(awalData2 + i);
    row.values = [
      tanggalExcel(t.tanggal),
      t.noDokumen,
      JENIS_LABEL[t.tipe],
      r.agenId,
      r.nama,
      t.tipe === "pesanan" ? t.balokKecil : null,
      t.tipe === "pesanan" ? t.balokBesar : null,
      t.jumlah > 0 ? t.jumlah : null,
      t.jumlah < 0 ? -t.jumlah : null,
    ];
    row.getCell(1).numFmt = TANGGAL;
    row.getCell(6).numFmt = ANGKA;
    row.getCell(7).numFmt = ANGKA;
    row.getCell(8).numFmt = RUPIAH;
    row.getCell(9).numFmt = RUPIAH;
    for (let c = 1; c <= KEPALA_2.length; c++) garisTipis(row.getCell(c));
  });
  const akhirData2 = awalData2 + transaksi.length - 1;
  const total2 = s2.getRow(akhirData2 + 1);
  total2.getCell(2).value = `Total ${transaksi.length} transaksi`;
  if (transaksi.length > 0) {
    for (const c of [6, 7, 8, 9]) {
      const h = kolomHuruf(c);
      total2.getCell(c).value = { formula: `SUM(${h}${awalData2}:${h}${akhirData2})` };
      total2.getCell(c).numFmt = c >= 8 ? RUPIAH : ANGKA;
    }
  }
  gayaTotal(total2, KEPALA_2.length);
  s2.views = [{ state: "frozen", ySplit: kepala2 }];
  if (transaksi.length > 0) s2.autoFilter = { from: { row: kepala2, column: 1 }, to: { row: akhirData2, column: KEPALA_2.length } };

  // ---------------------------------------------------------------- Lembar 3
  const s3 = wb.addWorksheet("Pesanan Belum Lunas");
  const KEPALA_3 = ["Kode", "Mitra", "No Dokumen", "Tanggal Pesan", "Jatuh Tempo", "Lewat Jatuh Tempo (hari)", "Sisa Belum Lunas (ERP)", "Status Umur", "Keterangan"];
  [9, 28, 30, 13, 13, 14, 18, 13, 44].forEach((w, i) => (s3.getColumn(i + 1).width = w));
  const kepala3 = tulisJudul(
    s3,
    "Pesanan Belum Lunas menurut ERP — semua periode",
    [...infoUmum, "Pembayaran dialokasikan ke pesanan terlama dulu, per database (utama/logistik)."],
    KEPALA_3.length
  );
  tulisKepala(s3, kepala3, KEPALA_3);
  const ditampilkan = new Map(rows.map((r) => [r.agenId, r]));
  const pesananTerbuka = Object.entries(terbuka.dokumen)
    .map(([kunci, v]) => {
      const pisah = kunci.indexOf("|");
      return { agenId: kunci.slice(0, pisah), noDokumen: kunci.slice(pisah + 1), sisa: v[0], lewat: v[1], tanggal: v[2] ?? null };
    })
    .filter((p) => ditampilkan.has(p.agenId))
    .sort((a, b) => ditampilkan.get(a.agenId)!.nama.localeCompare(ditampilkan.get(b.agenId)!.nama) || (a.tanggal ?? "").localeCompare(b.tanggal ?? ""));
  const awalData3 = kepala3 + 1;
  pesananTerbuka.forEach((p, i) => {
    const r = ditampilkan.get(p.agenId)!;
    const tertutup = terbuka.bersih ? !terbuka.bersih[p.agenId] : false;
    const jt = p.tanggal ? new Date(Date.UTC(+p.tanggal.slice(0, 4), +p.tanggal.slice(5, 7) - 1, +p.tanggal.slice(8, 10) + ES_BALOK_JATUH_TEMPO_HARI)) : null;
    const status = tertutup ? null : esBalokStatus(p.lewat);
    const row = s3.getRow(awalData3 + i);
    row.values = [
      p.agenId,
      r.nama,
      p.noDokumen,
      tanggalExcel(p.tanggal),
      jt,
      Math.max(0, p.lewat),
      p.sisa,
      status ?? "—",
      tertutup ? "Tertutup saldo lain: hutang bersih Mitra sudah nol, perlu pindah buku di ERP" : null,
    ];
    row.getCell(4).numFmt = TANGGAL;
    row.getCell(5).numFmt = TANGGAL;
    row.getCell(6).numFmt = "0";
    row.getCell(6).alignment = { horizontal: "center" };
    row.getCell(7).numFmt = RUPIAH;
    const st = row.getCell(8);
    st.alignment = { horizontal: "center" };
    if (status) {
      st.fill = { type: "pattern", pattern: "solid", fgColor: { argb: STATUS_WARNA[status].isi } };
      st.font = { bold: true, color: { argb: STATUS_WARNA[status].teks } };
    } else {
      st.font = { color: { argb: WARNA.redup } };
      row.getCell(9).font = { color: { argb: WARNA.peringatan } };
    }
    for (let c = 1; c <= KEPALA_3.length; c++) garisTipis(row.getCell(c));
  });
  const akhirData3 = awalData3 + pesananTerbuka.length - 1;
  const total3 = s3.getRow(akhirData3 + 1);
  total3.getCell(2).value = `Total ${pesananTerbuka.length} pesanan`;
  if (pesananTerbuka.length > 0) {
    total3.getCell(7).value = { formula: `SUM(G${awalData3}:G${akhirData3})` };
    total3.getCell(7).numFmt = RUPIAH;
  }
  gayaTotal(total3, KEPALA_3.length);
  s3.views = [{ state: "frozen", ySplit: kepala3 }];
  if (pesananTerbuka.length > 0) s3.autoFilter = { from: { row: kepala3, column: 1 }, to: { row: akhirData3, column: KEPALA_3.length } };

  // ---------------------------------------------------------------- Lembar 4
  const s4 = wb.addWorksheet("Keterangan");
  s4.getColumn(1).width = 34;
  s4.getColumn(2).width = 100;
  const ket: [string, string][] = [
    ["Saldo Akhir Periode", "Piutang Awal − Tabungan Awal + Pesanan − Retur − Pembayaran + Tarikan, sampai akhir periode. Positif = sisa hutang, negatif = tabungan. Ditulis sebagai rumus."],
    ["Jenis Saldo", "Hutang / Tabungan / Lunas menurut Saldo Akhir Periode."],
    ["Hutang Bersih Hari Ini", "Saldo gabungan database utama + logistik sampai hari ini (dasar yang sama dengan Sisa Hutang di kartu dan panel ringkasan). Kosong/nol bila Mitra lunas atau punya tabungan."],
    ["Status Hari Ini", `Dari tagihan terlama yang belum tertutup hutang bersih: Sehat ≤ 30 hari lewat jatuh tempo, Perhatian 31–60 hari, Kritis > 60 hari. Jatuh tempo = tanggal pesanan + ${ES_BALOK_JATUH_TEMPO_HARI} hari.`],
    ["Tagihan Terlama", "Hari lewat jatuh tempo dari tagihan terlama yang belum tertutup. \"Saldo awal ERP\" = sebagian hutang berasal dari saldo awal di data Mitra (tanpa tanggal)."],
    ["Pesanan Belum Lunas (ERP)", "Total pesanan yang masih terbuka di ERP, dihitung per database (pembayaran melunasi pesanan terlama dulu). Rinciannya di lembar Pesanan Belum Lunas."],
    ["Selisih ERP", "Bagian Pesanan Belum Lunas (ERP) yang MELEBIHI hutang bersih — sudah tertutup tabungan, kelebihan bayar, atau saldo di database lain yang belum dipindahbukukan di ERP. Yang perlu ditagih hanya hutang bersihnya."],
    ["Tertutup saldo lain", "Di lembar Pesanan Belum Lunas: pesanan Mitra yang hutang bersihnya sudah nol. Masih tercatat terbuka di ERP sampai dipindahbukukan."],
    ["Transaksi Periode", "Menambah Hutang = pesanan dan tarikan tabungan; Mengurangi Hutang = pembayaran."],
  ];
  const kepala4 = tulisJudul(s4, "Keterangan Kolom", infoUmum, 2);
  tulisKepala(s4, kepala4, ["Kolom", "Arti"]);
  ket.forEach(([k, v], i) => {
    const row = s4.getRow(kepala4 + 1 + i);
    row.values = [k, v];
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(1).alignment = { vertical: "top" };
    for (let c = 1; c <= 2; c++) garisTipis(row.getCell(c));
  });

  const slug = namaPerusahaan.toLowerCase().replace(/^pt\s+/, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  return { workbook: wb, namaFile: `rekening-mitra-es-balok-${slug}-${awalISO}_${akhirISO}.xlsx` };
}

export async function eksporRekeningMitra(input: EksporRekeningMitraInput): Promise<void> {
  const { workbook, namaFile } = bangunRekeningMitra(input);
  await triggerXlsxDownload(workbook, namaFile);
}
