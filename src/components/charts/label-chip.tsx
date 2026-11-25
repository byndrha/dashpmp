// Label angka di atas titik grafik (SVG recharts) dengan latar chip: kotak
// membulat berlatar kartu + garis tepi warna seri, supaya angka tetap
// terbaca saat jatuh di atas batang, garis seri lain, atau garis kisi.
// Lebar chip diperkirakan dari jumlah karakter (font tabular, ~0,62em per
// karakter) — getBBox tidak tersedia saat render server/awal.
export function LabelChip({
  x,
  y,
  teks,
  warna,
  fontSize = 9,
  posisi = "atas",
  batasBawah,
}: {
  x: number;
  y: number; // titik data; chip diletakkan di atas (bawaan) atau bawahnya
  teks: string;
  warna: string;
  fontSize?: number;
  // "bawah": untuk seri kedua di grafik yang sama (mis. balok besar di
  // bawah titik, balok kecil di atas) supaya chip dua garis tidak bertumpuk.
  posisi?: "atas" | "bawah";
  // Dasar area plot (px). Chip "bawah" yang akan melewatinya (titik dekat
  // dasar grafik) dipindah ke atas titik supaya tidak menimpa label sumbu X.
  batasBawah?: number;
}) {
  const padX = 4;
  const tinggi = fontSize + 6;
  const lebar = Math.ceil(teks.length * fontSize * 0.62) + padX * 2;
  const keBawah = posisi === "bawah" && (batasBawah == null || y + 7 + tinggi <= batasBawah);
  const atas = keBawah ? y + 7 : y - 7 - tinggi;
  return (
    <g pointerEvents="none">
      <rect
        x={x - lebar / 2}
        y={atas}
        width={lebar}
        height={tinggi}
        rx={tinggi / 2}
        fill="var(--card)"
        stroke={warna}
        strokeOpacity={0.45}
        strokeWidth={1}
      />
      <text
        x={x}
        y={atas + tinggi / 2}
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={fontSize}
        fontWeight={600}
        fill={warna}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {teks}
      </text>
    </g>
  );
}
