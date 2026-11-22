"use client";

// Ringkasan Piutang Es Balok (desain ulang 2026-11-22). Semua angka di sini
// memakai SATU dasar: saldo bersih per Mitra (utama+logistik digabung), sama
// dengan tabel "Tren Pergerakan Piutang Bulanan" yang sudah dikonfirmasi.
// Karena itu:
//   - Umur piutang & status menjumlah TEPAT ke Total Hutang
//     (getUmurPiutangBersih), tidak lagi FIFO per sumber yang bisa ~2×.
//   - Pergerakan periode dibaca sebagai alur Saldo Awal → Saldo Akhir; selisih
//     yang tersisa (Mitra yang berpindah antara hutang & tabungan) ditampilkan
//     terang-terangan, bukan disembunyikan.
// Tampilan ada di RingkasanPiutang (dipakai bersama Es Kristal).
import { PiggyBank } from "lucide-react";
import { RingkasanPiutang } from "@/components/dashboard/ringkasan-piutang";
import { formatRupiah } from "@/lib/format";
import type { PiutangSummaryData } from "@/lib/queries/penjualan-piutang";
import type { EsBalokPeriodSummary } from "@/lib/queries/piutang-invoice-outstanding";
import type { UmurPiutangBersih } from "@/lib/queries/umur-piutang-bersih";

export function RingkasanPiutangEsBalok({
  data,
  periode,
  umur,
  periodeLabel,
}: {
  data: PiutangSummaryData;
  periode: EsBalokPeriodSummary;
  umur: UmurPiutangBersih;
  periodeLabel: string;
}) {
  const rasio = periode.totalPenjualanPeriode > 0 ? (data.totalPiutangSaatIni / periode.totalPenjualanPeriode) * 100 : 0;
  // Saldo Akhir − (Saldo Awal + Penjualan − Pembayaran + Tarikan): Mitra yang
  // pindah antara hutang dan tabungan (Total Hutang hanya menjumlah saldo
  // bersih positif), tidak ada selisih lain.
  const perpindahan =
    periode.saldoAkhirPeriode -
    (periode.saldoAwalPeriode + periode.totalPenjualanPeriode - periode.totalPembayaranPeriode + periode.totalTarikanPeriode);

  return (
    <RingkasanPiutang
      totalHutang={data.totalPiutangSaatIni}
      jumlahMitra={umur.jumlahAgen}
      infoPosisi={{
        ikon: <PiggyBank className="size-3" />,
        label: "Tabungan mitra",
        nilai: formatRupiah(data.totalTabunganSaatIni),
        nadaPositif: true,
      }}
      rasio={rasio}
      periodeLabel={periodeLabel}
      alur={{
        saldoAwal: periode.saldoAwalPeriode,
        penjualan: periode.totalPenjualanPeriode,
        pembayaran: periode.totalPembayaranPeriode,
        tarikan: periode.totalTarikanPeriode,
        penyesuaian: {
          label: "Pindah hutang ↔ tabungan",
          nilai: perpindahan,
          keterangan:
            "Mitra yang berpindah antara hutang dan tabungan selama periode ini. Total Hutang hanya menjumlah mitra yang saldo bersihnya hutang.",
        },
        saldoAkhir: periode.saldoAkhirPeriode,
        catatan: "Rumus sama dengan tabel Tren Pergerakan Piutang Bulanan.",
      }}
      umur={{
        total: umur.total,
        ember: umur.ember,
        status: umur.status,
        catatan:
          "Dihitung dari saldo bersih tiap mitra: pembayaran melunasi tagihan tertua dulu, sehingga sisa hutang adalah pesanan & tarikan terbaru. Status mitra mengikuti tagihan tertuanya yang belum lunas.",
      }}
    />
  );
}
