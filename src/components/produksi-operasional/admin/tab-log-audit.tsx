"use client";

// Tab Log audit layar admin (spec §8) — hanya untuk admin produksi (dirender
// tab-operasional.tsx kalau bolehKelolaProduksi; getLogAction memakai gerbang
// "kelola"). Filter tanggal (kalender WIB, bawaan 7 hari), operator, bak, aksi.
// "Ekspor Excel" mengekspor persis baris yang sedang tampil.

import { useEffect, useMemo, useState } from "react";
import { FileSpreadsheet, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getLogAction } from "@/app/produksi-operasional-actions";
import { exportRowsToXlsx, type XlsxColumn } from "@/lib/export-xlsx";
import type { KodeProduksi } from "@/lib/produksi-denah";
import type { BarisLog } from "@/lib/queries/produksi-operasional";
import { jamWib, singkatVarian, tanggalJamWib } from "../warna-tahap";

const BATAS = 1000;
const WIB_OFFSET_MS = 7 * 3_600_000;
const KELAS_SELECT =
  "h-8 rounded-lg border border-input bg-transparent px-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30";

const LABEL_AKSI: Record<string, string> = {
  isi_air: "Isi Air",
  panen: "Panen",
  tandai_babonan: "Tandai Babonan",
  buang_babonan: "Buang Babonan",
  mulai_maintenance: "Mulai Maintenance",
  selesai_maintenance: "Selesai Maintenance",
  koreksi_isian: "Koreksi isian",
  batal_panen: "Batal panen",
};

function objek(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}

function bil(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function teks(v: unknown): string | null {
  return typeof v === "string" && v ? v : null;
}

function varianLabel(v: unknown): string {
  return v === "kecil" || v === "besar" ? singkatVarian(v) : "?";
}

function waktuLabel(v: unknown): string {
  const t = teks(v);
  return t && !Number.isNaN(Date.parse(t)) ? tanggalJamWib(t) : "?";
}

/** "sisa 36 → 34" bila sisa sebelum & sesudah diketahui. */
function sisaBerubah(sebelum: Record<string, unknown>, sisaSesudah: unknown): string | null {
  const a = bil(sebelum.sisa);
  const b = bil(sisaSesudah);
  return a !== null && b !== null ? `sisa ${a} → ${b}` : null;
}

/** Ringkasan perubahan satu baris log (sebelum → sesudah; bentuknya per aksi, lihat queries/produksi-operasional.ts). */
export function ringkasPerubahan(l: BarisLog): string {
  const a = objek(l.sebelum);
  const s = objek(l.sesudah);
  const bagian: (string | null)[] = [];
  switch (l.aksi) {
    case "isi_air":
      bagian.push(`+${bil(s.jumlah) ?? "?"} can ${varianLabel(s.varian)}`);
      break;
    case "panen": {
      const muatan = Array.isArray(s.muatan) ? s.muatan.map(objek) : [];
      for (const m of muatan) bagian.push(`${teks(m.plat) ?? "?"} ${bil(m.jumlah) ?? "?"}`);
      const bab = bil(s.babonan) ?? 0;
      const pecah = bil(s.pecah) ?? 0;
      if (bab > 0) bagian.push(`Babonan ${bab}`);
      if (pecah > 0) bagian.push(`pecah ${pecah}`);
      bagian.push(sisaBerubah(a, s.sisa));
      if (s.isiUlang === true) bagian.push("isi ulang");
      if (s.belumSiap === true && bil(s.persen) !== null) bagian.push(`belum siap ${bil(s.persen)}%`);
      break;
    }
    case "tandai_babonan":
      bagian.push(`${bil(s.jumlah) ?? "?"} can → Babonan`, sisaBerubah(a, s.sisa));
      break;
    case "buang_babonan":
      bagian.push(`${bil(s.jumlah) ?? "?"} can dibuang`, sisaBerubah(a, s.sisa));
      break;
    case "mulai_maintenance":
      bagian.push(teks(s.catatan));
      break;
    case "selesai_maintenance": {
      const mulai = teks(a.mulaiAt);
      bagian.push(mulai ? `sejak ${tanggalJamWib(mulai)}` : null, teks(a.catatan));
      break;
    }
    case "koreksi_isian": {
      if (a.mulaiAt !== s.mulaiAt) bagian.push(`waktu isi ${waktuLabel(a.mulaiAt)} → ${waktuLabel(s.mulaiAt)}`);
      if (a.varian !== s.varian) bagian.push(`varian ${varianLabel(a.varian)} → ${varianLabel(s.varian)}`);
      if (a.sisa !== s.sisa) bagian.push(sisaBerubah(a, s.sisa));
      if (a.jumlahAwal !== s.jumlahAwal) bagian.push(`awal ${bil(a.jumlahAwal) ?? "?"} → ${bil(s.jumlahAwal) ?? "?"}`);
      if (bagian.length === 0) bagian.push("tanpa perubahan nilai");
      break;
    }
    case "batal_panen": {
      const dimuat = bil(a.dimuat) ?? 0;
      const keBab = (bil(a.keBabonan) ?? 0) + (bil(a.pecah) ?? 0);
      const panenAt = teks(a.panenAt);
      bagian.push(
        `${dimuat === 0 && keBab > 0 ? `Tandai Babonan ${keBab} can` : `panen ${dimuat} dimuat${keBab > 0 ? ` + ${keBab} Babonan` : ""}`}${panenAt ? ` (${tanggalJamWib(panenAt)})` : ""}`,
      );
      if (s.dikembalikan === true) {
        const isian = objek(a.isian);
        bagian.push(`dikembalikan, ${sisaBerubah(isian, s.sisaIsian) ?? "sisa diperbarui"}`);
      } else {
        bagian.push("hanya ditandai (can tidak dikembalikan)");
      }
      break;
    }
  }
  return bagian.filter((b): b is string => !!b).join(" · ");
}

function tanggalWibHariIni(): string {
  return new Date(Date.now() + WIB_OFFSET_MS).toISOString().slice(0, 10);
}

function geserTanggal(tanggal: string, hari: number): string {
  const [y, m, d] = tanggal.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + hari)).toISOString().slice(0, 10);
}

/** Awal hari kalender WIB sebagai instant ISO. */
function awalHariWib(tanggal: string): string {
  return new Date(`${tanggal}T00:00:00+07:00`).toISOString();
}

const KOLOM_EXCEL: XlsxColumn[] = [
  { header: "Waktu (WIB)", key: "waktu", width: 18, type: "text" },
  { header: "Lokasi", key: "lokasi", width: 20, type: "text" },
  { header: "Aksi", key: "aksi", width: 20, type: "text" },
  { header: "Perubahan", key: "perubahan", width: 60, type: "text" },
  { header: "Operator", key: "operator", width: 22, type: "text" },
  { header: "Peran", key: "peran", width: 10, type: "text" },
  { header: "Shift", key: "shift", width: 8, type: "number", numFmt: "0" },
  { header: "Alasan", key: "alasan", width: 40, type: "text" },
];

function waktuExcel(iso: string): string {
  // "2026-11-09 08:10" WIB — teks supaya Excel tidak menggeser zona waktu.
  return new Date(Date.parse(iso) + WIB_OFFSET_MS).toISOString().slice(0, 16).replace("T", " ");
}

export function TabLogAudit({ kode, daftarBak }: { kode: KodeProduksi; daftarBak: { id: string; nama: string }[] }) {
  const [hariIni] = useState(tanggalWibHariIni);
  const [dari, setDari] = useState(() => geserTanggal(hariIni, -6));
  const [sampai, setSampai] = useState(hariIni);
  const [akunId, setAkunId] = useState("");
  const [bakId, setBakId] = useState("");
  const [aksi, setAksi] = useState("");
  const [baris, setBaris] = useState<BarisLog[]>([]);
  // Operator yang pernah muncul (opsi filter tidak menyusut saat difilter).
  const [operatorDikenal, setOperatorDikenal] = useState<Map<string, string>>(new Map());
  const [galat, setGalat] = useState<string | null>(null);
  const [memuat, setMemuat] = useState(false);
  const [mengekspor, setMengekspor] = useState(false);

  const rentangSah = /^\d{4}-\d{2}-\d{2}$/.test(dari) && /^\d{4}-\d{2}-\d{2}$/.test(sampai) && dari <= sampai;

  const [segar, setSegar] = useState(0);
  // Kunci filter yang terakhir selesai dimuat: selama berbeda dari filter
  // sekarang, permintaan masih berjalan.
  const kunci = `${dari}|${sampai}|${akunId}|${bakId}|${aksi}|${segar}`;
  const [selesaiKunci, setSelesaiKunci] = useState<string | null>(null);

  useEffect(() => {
    if (!rentangSah) return;
    let batal = false;
    const selesai = () => {
      setSelesaiKunci(kunci);
      setMemuat(false);
    };
    getLogAction(kode, {
      dari: awalHariWib(dari),
      sampai: awalHariWib(geserTanggal(sampai, 1)),
      akunId: akunId || undefined,
      bakId: bakId || undefined,
      aksi: aksi || undefined,
      batas: BATAS,
    }).then(
      (r) => {
        if (batal) return;
        if (r.success) {
          setBaris(r.data);
          setGalat(null);
          setOperatorDikenal((lama) => {
            const baru = new Map(lama);
            let berubah = false;
            for (const l of r.data) {
              if (baru.get(l.akunId) !== l.akunNama) {
                baru.set(l.akunId, l.akunNama);
                berubah = true;
              }
            }
            return berubah ? baru : lama;
          });
        } else {
          setGalat(r.error);
        }
        selesai();
      },
      () => {
        if (batal) return;
        setGalat("Gagal memuat log — periksa koneksi.");
        selesai();
      },
    );
    return () => {
      batal = true;
    };
    // `kunci` merangkum semua filter + tombol Segarkan.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kode, kunci, rentangSah]);

  const sedangMuat = rentangSah && (memuat || selesaiKunci !== kunci);
  const segarkan = () => {
    setMemuat(true);
    setSegar((n) => n + 1);
  };

  const tampil = useMemo(
    () =>
      baris.map((l) => ({
        log: l,
        lokasi: l.bakNama || l.kolomNomor !== null ? `${l.bakNama ?? "Bak"}${l.kolomNomor !== null ? ` – Rek ${l.kolomNomor}` : ""}` : "—",
        perubahan: ringkasPerubahan(l),
      })),
    [baris],
  );
  const operatorUrut = useMemo(() => [...operatorDikenal].sort((a, b) => a[1].localeCompare(b[1])), [operatorDikenal]);

  async function ekspor() {
    setMengekspor(true);
    try {
      await exportRowsToXlsx({
        filename: `Log_Produksi_${kode}_${tanggalWibHariIni()}.xlsx`,
        sheetName: "Log produksi",
        columns: KOLOM_EXCEL,
        rows: tampil.map((t) => ({
          waktu: waktuExcel(t.log.at),
          lokasi: t.lokasi,
          aksi: LABEL_AKSI[t.log.aksi] ?? t.log.aksi,
          perubahan: t.perubahan,
          operator: t.log.akunNama,
          peran: t.log.peran,
          shift: t.log.shift || null,
          alasan: t.log.alasan ?? "",
        })),
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Gagal membuat file .xlsx.");
    } finally {
      setMengekspor(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          Dari
          <Input type="date" value={dari} max={sampai} onChange={(e) => setDari(e.target.value)} className="h-8 w-auto" />
        </label>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          s/d
          <Input type="date" value={sampai} min={dari} max={hariIni} onChange={(e) => setSampai(e.target.value)} className="h-8 w-auto" />
        </label>
        <select className={KELAS_SELECT} value={akunId} onChange={(e) => setAkunId(e.target.value)} aria-label="Filter operator">
          <option value="">Semua operator</option>
          {operatorUrut.map(([id, nama]) => (
            <option key={id} value={id}>
              {nama}
            </option>
          ))}
        </select>
        <select className={KELAS_SELECT} value={bakId} onChange={(e) => setBakId(e.target.value)} aria-label="Filter bak">
          <option value="">Semua bak</option>
          {daftarBak.map((b) => (
            <option key={b.id} value={b.id}>
              {b.nama}
            </option>
          ))}
        </select>
        <select className={KELAS_SELECT} value={aksi} onChange={(e) => setAksi(e.target.value)} aria-label="Filter aksi">
          <option value="">Semua aksi</option>
          {Object.entries(LABEL_AKSI).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <Button variant="ghost" size="sm" onClick={segarkan} disabled={sedangMuat || !rentangSah}>
          <RefreshCw className={cn("size-3.5", sedangMuat && "animate-spin")} /> Segarkan
        </Button>
        <Button variant="outline" size="sm" className="ml-auto" onClick={() => void ekspor()} disabled={mengekspor || tampil.length === 0}>
          <FileSpreadsheet className="size-3.5" /> {mengekspor ? "Membuat…" : "Ekspor Excel"}
        </Button>
      </div>

      {!rentangSah && (
        <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">Rentang tanggal tidak sah: tanggal awal harus ≤ tanggal akhir.</p>
      )}
      {rentangSah && galat && <p className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{galat}</p>}
      {baris.length >= BATAS && (
        <p className="rounded-lg bg-amber-100 p-3 text-xs text-amber-900 dark:bg-amber-950/60 dark:text-amber-100">
          Menampilkan {BATAS} baris terbaru saja. Persempit rentang tanggal atau filter untuk melihat sisanya.
        </p>
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Waktu</TableHead>
              <TableHead>Lokasi</TableHead>
              <TableHead>Aksi</TableHead>
              <TableHead>Perubahan</TableHead>
              <TableHead>Operator · shift</TableHead>
              <TableHead>Alasan</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tampil.length === 0 && (
              <TableRow>
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  {sedangMuat ? "Memuat…" : "Tidak ada catatan pada rentang dan filter ini."}
                </TableCell>
              </TableRow>
            )}
            {tampil.map(({ log: l, lokasi, perubahan }) => (
              <TableRow key={l.id}>
                <TableCell className="whitespace-nowrap tabular-nums" title={l.at}>
                  {tanggalJamWib(l.at)}
                </TableCell>
                <TableCell className="whitespace-nowrap">{lokasi}</TableCell>
                <TableCell className="whitespace-nowrap">
                  <span className={cn((l.aksi === "koreksi_isian" || l.aksi === "batal_panen") && "font-semibold text-amber-700 dark:text-amber-400")}>
                    {LABEL_AKSI[l.aksi] ?? l.aksi}
                  </span>
                </TableCell>
                <TableCell className="min-w-56 text-xs">{perubahan || "—"}</TableCell>
                <TableCell className="whitespace-nowrap text-xs">
                  {l.akunNama} <span className="text-muted-foreground">({l.peran}{l.shift ? ` · S${l.shift}` : ""})</span>
                </TableCell>
                <TableCell className="min-w-40 text-xs">{l.alasan ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Semua waktu dalam WIB (tanggal kalender, bukan tanggal bisnis). Terbaru di atas
        {tampil.length > 0 && ` · ${tampil.length} baris · terakhir ${jamWib(tampil[0].log.at)}`}.
      </p>
    </div>
  );
}
