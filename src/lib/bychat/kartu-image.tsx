import { ImageResponse } from "next/og";
import type { KartuPiutangData } from "@/lib/bychat/mitra";
import { esBalokAgingBucket } from "@/lib/queries/piutang-invoice-outstanding";
import { teksPembaruan } from "@/lib/bychat/pembaruan";
import { teksIsi } from "@/lib/bychat/isi-pesanan";
import { KARTU_FONT_BASE64 as F } from "@/lib/bychat/kartu-fonts";

// Kartu piutang satu mitra sebagai PNG (lebar 1080 px, terbaca di WhatsApp).
// Gaya MENGIKUTI modul piutang dashpmp (shadcn/Glacier): latar `--background`,
// kartu `--card` ber-ring + shadow, KpiCard (label kapital kecil + angka
// font-display), dan kartu mitra seperti MitraAgingCard di aging-table.tsx
// (nama + wilayah, garis, total, baris faktur ber-nomor font-data, "Terbit ·
// Jatuh tempo", pill umur piutang, nominal). SENGAJA tanpa label status
// (Sehat/Perhatian/Kritis) dan tanpa label segmentasi/tipe mitra -- permintaan
// pemilik. Nilai warna = token tema Glacier (light) dikonversi dari oklch.
// Catatan satori: hanya flexbox; tiap div berisi >1 anak harus display:flex.

const LEBAR = 1080;
const PAD = 40;
const GAP = 20;
const MAKS_BARIS_FAKTUR = 10;

// Tinggi tetap tiap bagian -> tinggi total dapat dihitung persis.
const H_HEADER = 112;
const H_BARIS = 122;
const H_LAINNYA = 58;
const H_FOOTER = 56;
const H_KARTU_ATAS = 28 + 76 + 74; // padding atas + nama/wilayah + baris total
const PAD_KARTU = 28;
const H_REK_BARIS = 78;

// Tinggi kartu "Cara pembayaran": judul + baris rekening + catatan, atau satu
// kalimat cadangan bila PT belum mengatur rekening transfer.
const hBayar = (jumlahRekening: number) => (jumlahRekening > 0 ? 128 + H_REK_BARIS * jumlahRekening : 132);
const KALIMAT_TANPA_REKENING = "Hubungi admin kami untuk informasi pembayaran.";
const KALIMAT_KONFIRMASI = "Mohon konfirmasi setelah transfer.";

const C = {
  background: "#eaf1f6",
  card: "#f7fdff",
  foreground: "#0d1c27",
  primary: "#008b6d",
  muted: "#e2edf4",
  mutedFg: "#54676d",
  destructive: "#db2b33",
  warning: "#cc6600",
  border: "#ced9de",
  ring: "#e0e7e9",
  primary15: "#d2ece9",
};

const BUCKET_TONE: Record<string, { bg: string; fg: string }> = {
  "Belum Jatuh Tempo": { bg: C.muted, fg: C.mutedFg },
  "1-30 Hari": { bg: "#fef3c6", fg: "#973c00" },
  "31-60 Hari": { bg: "#ffedd4", fg: "#9f2d00" },
  "61-90 Hari": { bg: "#ffe2e2", fg: "#9f0712" },
  ">90 Hari": { bg: "#ffc9c9", fg: "#82181a" },
};

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};
const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;

let fontsCache: { name: string; data: ArrayBuffer; weight: 400 | 500 | 600 | 700; style: "normal" }[] | null = null;
function fonts() {
  if (!fontsCache) {
    const buf = (b64: string) => {
      const b = Buffer.from(b64, "base64");
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    fontsCache = [
      { name: "Inter", data: buf(F.inter400), weight: 400, style: "normal" },
      { name: "Inter", data: buf(F.inter500), weight: 500, style: "normal" },
      { name: "Inter", data: buf(F.inter600), weight: 600, style: "normal" },
      { name: "Inter", data: buf(F.inter700), weight: 700, style: "normal" },
      { name: "Space Grotesk", data: buf(F.grotesk500), weight: 500, style: "normal" },
      { name: "Space Grotesk", data: buf(F.grotesk600), weight: 600, style: "normal" },
      { name: "Space Grotesk", data: buf(F.grotesk700), weight: 700, style: "normal" },
      { name: "IBM Plex Mono", data: buf(F.mono400), weight: 400, style: "normal" },
      { name: "IBM Plex Mono", data: buf(F.mono500), weight: 500, style: "normal" },
    ];
  }
  return fontsCache;
}

export function tinggiKartu(data: KartuPiutangData): number {
  const tampil = Math.min(data.faktur.length, MAKS_BARIS_FAKTUR);
  const lebih = data.faktur.length > MAKS_BARIS_FAKTUR;
  const kartuMitra = H_KARTU_ATAS + tampil * H_BARIS + (lebih ? H_LAINNYA : 0) + PAD_KARTU;
  return PAD + H_HEADER + GAP + kartuMitra + GAP + hBayar(data.rekening.length) + GAP + H_FOOTER + PAD;
}

const shadowKartu = "0 4px 6px -1px rgba(13,28,39,0.10), 0 2px 4px -2px rgba(13,28,39,0.10)";
const kartuStyle = {
  display: "flex" as const,
  flexDirection: "column" as const,
  background: C.card,
  borderRadius: 17,
  border: `1px solid ${C.ring}`,
  boxShadow: shadowKartu,
};

export async function renderKartuPng(data: KartuPiutangData, now = new Date()): Promise<Uint8Array> {
  // Urut: paling lama jatuh tempo di atas (sama dengan InvoiceRow di modul piutang).
  const urut = [...data.faktur].sort((a, b) => b.hariLewat - a.hariLewat || a.tanggal.localeCompare(b.tanggal));
  const tampil = urut.slice(0, MAKS_BARIS_FAKTUR);
  const sisa = urut.slice(MAKS_BARIS_FAKTUR);
  const sisaTotal = sisa.reduce((s, f) => s + f.sisa, 0);
  const tinggi = tinggiKartu(data);
  const cetak = new Date(now.getTime() + 7 * 3600 * 1000).toISOString().replace("T", " ").slice(0, 16);

  const label = (teks: string) => (
    <div style={{ display: "flex", fontSize: 19, fontWeight: 500, letterSpacing: 1.6, textTransform: "uppercase", color: C.mutedFg }}>{teks}</div>
  );
  // Umur ditulis spesifik ("Lewat 14 hari"), warna mengikuti kelompok umur seperti di modul piutang.
  const pill = (hariLewat: number) => {
    const t = BUCKET_TONE[esBalokAgingBucket(hariLewat)];
    return (
      <div style={{ display: "flex", background: t.bg, color: t.fg, fontSize: 19, fontWeight: 500, padding: "3px 12px", borderRadius: 6 }}>
        {hariLewat > 0 ? `Lewat ${hariLewat} hari` : "Belum jatuh tempo"}
      </div>
    );
  };

  const res = new ImageResponse(
    (
      <div style={{ display: "flex", flexDirection: "column", width: LEBAR, height: tinggi, background: C.background, color: C.foreground, fontFamily: "Inter", padding: PAD }}>
        {/* Judul halaman */}
        <div style={{ display: "flex", flexDirection: "column", height: H_HEADER, justifyContent: "center" }}>
          {label("Kartu Piutang")}
          <div style={{ display: "flex", fontFamily: "Space Grotesk", fontSize: 38, fontWeight: 600, marginTop: 6 }}>{data.ptNama}</div>
          <div style={{ display: "flex", fontSize: 22, color: C.mutedFg, marginTop: 4 }}>{teksPembaruan()}</div>
        </div>

        {/* Kartu mitra (seperti MitraAgingCard) */}
        <div style={{ ...kartuStyle, marginTop: GAP, padding: `${PAD_KARTU}px ${PAD_KARTU}px ${PAD_KARTU}px` }}>
          <div style={{ display: "flex", flexDirection: "column", height: 76, justifyContent: "flex-start" }}>
            <div style={{ display: "flex", fontSize: 34, fontWeight: 500 }}>{data.mitra.nama}</div>
            <div style={{ display: "flex", fontSize: 21, color: C.mutedFg, marginTop: 6 }}>{data.mitra.wilayah ?? "-"}</div>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: 74, borderTop: `1px solid ${C.border}` }}>
            <div style={{ display: "flex", fontSize: 22, color: C.mutedFg }}>{`${data.faktur.length} faktur belum lunas`}</div>
            <div style={{ display: "flex", fontFamily: "Space Grotesk", fontSize: 38, fontWeight: 600 }}>{rp(data.totalPiutang)}</div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", borderTop: `1px solid ${C.border}` }}>
            {tampil.map((f, i) => (
              <div key={`${f.noDokumen}-${i}`} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: H_BARIS, borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 21, color: C.mutedFg }}>{f.noDokumen}</div>
                  <div style={{ display: "flex", fontSize: 21, color: C.mutedFg, marginTop: 6 }}>{`Terbit ${tgl(f.tanggal)} · Jatuh tempo ${tgl(f.jatuhTempo)}`}</div>
                  {f.isi.length > 0 && (
                    <div style={{ display: "flex", fontSize: 21, fontWeight: 500, color: C.foreground, marginTop: 6 }}>{teksIsi(f.isi)}</div>
                  )}
                </div>
                <div style={{ display: "flex", alignItems: "center" }}>
                  {pill(f.hariLewat)}
                  <div style={{ display: "flex", fontSize: 27, fontWeight: 600, marginLeft: 14, minWidth: 170, justifyContent: "flex-end" }}>{rp(f.sisa)}</div>
                </div>
              </div>
            ))}
          </div>
          {sisa.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", height: H_LAINNYA, borderTop: `1px solid ${C.border}`, fontSize: 21, color: C.mutedFg }}>
              <div style={{ display: "flex" }}>{`+${sisa.length} faktur lainnya`}</div>
              <div style={{ display: "flex", fontWeight: 600 }}>{rp(sisaTotal)}</div>
            </div>
          )}
        </div>

        {/* Cara pembayaran: rekening dari Metode Pembayaran PT (TRANSFER, konteks publik) */}
        <div style={{ ...kartuStyle, marginTop: GAP, height: hBayar(data.rekening.length), padding: `22px ${PAD_KARTU}px` }}>
          <div style={{ display: "flex", fontSize: 26, fontWeight: 600, height: 44 }}>Cara pembayaran</div>
          {data.rekening.map((r, i) => (
            <div key={`${r.bank}-${r.nomorRekening}-${i}`} style={{ display: "flex", flexDirection: "column", height: H_REK_BARIS, justifyContent: "center", borderTop: i === 0 ? "none" : `1px solid ${C.border}` }}>
              <div style={{ display: "flex", flexDirection: "row", alignItems: "center" }}>
                <div style={{ display: "flex", fontSize: 21, fontWeight: 600, color: C.primary, background: C.primary15, padding: "3px 12px", borderRadius: 6 }}>{/^bank\b/i.test(r.bank) ? r.bank : `Bank ${r.bank}`}</div>
                <div style={{ display: "flex", fontFamily: "IBM Plex Mono", fontSize: 32, fontWeight: 500, marginLeft: 16 }}>{r.nomorRekening}</div>
              </div>
              <div style={{ display: "flex", fontSize: 21, color: C.mutedFg, marginTop: 6 }}>
                {[r.atasNama ? `a.n. ${r.atasNama}` : "", r.catatan ? r.catatan.slice(0, 70) : ""].filter(Boolean).join(" · ")}
              </div>
            </div>
          ))}
          {data.rekening.length > 0 && (
            <div style={{ display: "flex", flexDirection: "row", width: "100%", height: 40, alignItems: "flex-end", fontSize: 21, color: C.mutedFg }}>{KALIMAT_KONFIRMASI}</div>
          )}
          {data.rekening.length === 0 && (
            <div style={{ display: "flex", flexDirection: "row", width: "100%", fontSize: 22, color: C.mutedFg, height: 44, alignItems: "center" }}>{KALIMAT_TANPA_REKENING}</div>
          )}
        </div>

        {/* Cetak */}
        <div style={{ display: "flex", flexDirection: "row", marginTop: GAP, height: H_FOOTER - GAP, alignItems: "center", justifyContent: "space-between", fontSize: 18, color: C.mutedFg }}>
          <div style={{ display: "flex", opacity: 0.85 }}>{`Dicetak ${cetak} WIB · ${data.ptNama}`}</div>
          {/* Watermark ekstensi: didukung oleh ByChat */}
          <div style={{ display: "flex", fontWeight: 600, letterSpacing: 0.5 }}>Didukung oleh ByChat</div>
        </div>
      </div>
    ),
    { width: LEBAR, height: tinggi, fonts: fonts() }
  );
  return new Uint8Array(await res.arrayBuffer());
}
