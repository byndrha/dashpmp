"use client";

// Dropdown "Pilih armada" di Buat Pemesanan: setiap armada tampil dengan
// foto, plat nomor, kondisi (DashboardArmada.Status), status sekarang
// (tersedia / dalam pengiriman / ...), kapasitas total, dan sisa kapasitas
// kantong pada keberangkatan (batch) di jam pengiriman yang dipilih.
// Kapasitas penuh HANYA diperingatkan — armada tetap bisa dipilih.
import { AlertTriangle, Truck } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ArmadaRow } from "@/lib/queries/armada";
import type { ArmadaKetersediaan, ArmadaOperationalStatus } from "@/lib/queries/pengiriman-jadwal";

const jamWib = new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Jakarta" });

const KONDISI_KELAS: Record<ArmadaRow["Status"], string> = {
  Baik: "bg-primary/15 text-primary",
  Rusak: "bg-destructive/15 text-destructive",
  Perbaikan: "bg-warning/15 text-warning",
  Tertahan: "bg-warning/15 text-warning",
};

function labelOperasional(s: ArmadaOperationalStatus | null | undefined): { teks: string; kelas: string } {
  if (!s) return { teks: "Status belum diketahui", kelas: "text-muted-foreground" };
  switch (s.kind) {
    case "diam":
      return { teks: "Tersedia", kelas: "text-primary" };
    case "tiba":
      return { teks: "Tersedia · baru kembali", kelas: "text-primary" };
    case "proses_muat":
      return { teks: "Sedang dimuat", kelas: "text-warning" };
    case "menunggu_keberangkatan":
      return { teks: "Menunggu berangkat", kelas: "text-warning" };
    case "dalam_pengiriman":
      return { teks: `Dalam pengiriman${s.mitraTujuan ? ` → ${s.mitraTujuan}` : ""}`, kelas: "text-chart-3" };
    case "perjalanan_kembali":
      return { teks: "Perjalanan kembali", kelas: "text-chart-3" };
    case "maintenance":
      return { teks: s.label, kelas: "text-destructive" };
  }
}

export interface InfoKapasitas {
  maks: number | null;
  terisi: number; // kantong yang sudah ada di batch jam itu (0 bila belum ada batch)
  sisa: number | null; // maks - terisi, minimal 0
  melebihi: boolean; // terisi + pesanan ini > maks
  bentrokTerbit: boolean; // batch di jam itu sudah berangkat → server akan menolak
  batch: ArmadaKetersediaan["batch"];
}

export function infoKapasitas(armada: ArmadaRow, k: ArmadaKetersediaan | undefined, candidateQty: number): InfoKapasitas {
  const terisi = k?.batch?.terisi ?? 0;
  const maks = armada.KapasitasMaks;
  return {
    maks,
    terisi,
    sisa: maks != null ? Math.max(maks - terisi, 0) : null,
    melebihi: maks != null && terisi + candidateQty > maks,
    bentrokTerbit: k?.batch?.status === "Terbit",
    batch: k?.batch ?? null,
  };
}

// Plat nomor sebagai chip hitam bertulisan putih (seperti plat asli) —
// sengaja tidak mengikuti tema.
function Plat({ nomor }: { nomor: string }) {
  return (
    <span className="shrink-0 rounded-[3px] bg-neutral-900 px-1.5 py-px font-mono text-[10px] font-semibold tracking-wide text-white">
      {nomor}
    </span>
  );
}

function Foto({ armada, kecil }: { armada: ArmadaRow; kecil?: boolean }) {
  const ukuran = kecil ? "size-6" : "h-11 w-14";
  return armada.FotoPath ? (
    // eslint-disable-next-line @next/next/no-img-element -- foto unggahan bebas ukuran, sama dengan pengiriman-board.tsx
    <img src={armada.FotoPath} alt={armada.Nama} className={cn(ukuran, "shrink-0 rounded-md object-cover")} />
  ) : (
    <span className={cn(ukuran, "flex shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground")}>
      <Truck className={kecil ? "size-3.5" : "size-5"} />
    </span>
  );
}

function BarisKapasitas({ info, candidateQty, memuat }: { info: InfoKapasitas; candidateQty: number; memuat: boolean }) {
  if (info.maks == null) return <span className="text-muted-foreground">Kapasitas belum diatur</span>;
  const persen = Math.min(100, ((info.terisi + candidateQty) / info.maks) * 100);
  // Kantong 5 KG dihitung setengah (konvensi JADWAL_KANTONG_EXPR, sama dengan
  // cek kapasitas di server), jadi sisa bisa pecahan — maksimal 1 desimal.
  const angka = (v: number) => v.toLocaleString("id-ID", { maximumFractionDigits: 1 });
  return (
    <span className="flex min-w-0 flex-col gap-0.5 tabular-nums">
      {/* terisi / total kantong (kosong = 0 / total, penuh = total / total),
          lalu keterangan batch di bawahnya. Merah bila pesanan ini membuat
          batch melebihi kapasitas. */}
      <span>
        {memuat ? (
          <span>…</span>
        ) : (
          <span className={cn("font-semibold", info.melebihi ? "text-destructive" : "text-foreground")}>{angka(info.terisi)}</span>
        )}{" "}
        / <span className="font-semibold text-foreground">{angka(info.maks)}</span> kantong
      </span>
      <span>
        {memuat
          ? "Menghitung sisa…"
          : info.batch
            ? `Batch ${jamWib.format(new Date(info.batch.jamJadwal))}`
            : "Belum ada batch di jam ini"}
      </span>
      {!memuat && (
        <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
          <span
            className={cn("block h-full rounded-full", info.melebihi ? "bg-destructive" : "bg-primary")}
            style={{ width: `${persen}%` }}
          />
        </span>
      )}
    </span>
  );
}

export function ArmadaPilihan({
  armadaList,
  value,
  onChange,
  ketersediaan,
  memuat,
  candidateQty,
  kosong,
  tanpaWaktu = false,
}: {
  armadaList: ArmadaRow[];
  value: string;
  onChange: (v: string) => void;
  ketersediaan: Map<number, ArmadaKetersediaan>;
  memuat: boolean;
  // true bila tanggal/jam kirim belum diisi (mis. Ubah Pemesanan untuk SO
  // yang belum dijadwalkan): sisa kapasitas per batch belum bisa dihitung.
  tanpaWaktu?: boolean;
  candidateQty: number;
  kosong: string; // nilai "belum dipilih"
}) {
  const terpilih = armadaList.find((a) => String(a.ArmadaID) === value) ?? null;
  const infoTerpilih = terpilih ? infoKapasitas(terpilih, ketersediaan.get(terpilih.ArmadaID), candidateQty) : null;

  return (
    <div className="flex flex-col gap-1.5">
      <Select value={value} onValueChange={(v) => onChange(v ?? kosong)}>
        <SelectTrigger className="h-auto min-h-9 w-full py-1">
          <SelectValue placeholder="Pilih armada">
            {(v: string) => {
              const a = armadaList.find((x) => String(x.ArmadaID) === v);
              if (!a) return "Pilih armada";
              return (
                <span className="flex min-w-0 items-center gap-2">
                  <Foto armada={a} kecil />
                  <span className="truncate font-medium">{a.Nama}</span>
                  {a.PlatNomor && <Plat nomor={a.PlatNomor} />}
                </span>
              );
            }}
          </SelectValue>
        </SelectTrigger>
        {/* Lebar bawaan SelectContent = lebar pemicu (--anchor-width), jadi
            tidak melebihi dialog Buat Pemesanan. alignItemWithTrigger=false:
            daftar muncul di bawah pemicu, tidak menimpa isian di atasnya. */}
        <SelectContent alignItemWithTrigger={false} className="p-1">
          {armadaList.map((a) => {
            const k = ketersediaan.get(a.ArmadaID);
            const info = infoKapasitas(a, k, candidateQty);
            const op = labelOperasional(k?.operasional);
            return (
              // Armada yang kondisinya bukan "Baik" tetap tidak bisa dipilih
              // (aturan lama); kapasitas penuh TIDAK menonaktifkan pilihan.
              <SelectItem
                key={a.ArmadaID}
                value={String(a.ArmadaID)}
                disabled={a.Status !== "Baik"}
                className="mb-1 overflow-hidden border py-2 pl-2.5 whitespace-normal last:mb-0 focus:ring-2 focus:ring-primary data-[selected]:ring-2 data-[selected]:ring-primary/60"
              >
                {/* Foto armada sebagai latar di ±60% sisi kanan: mode cover di
                    area itu = sedikit zoom (tidak terlalu dekat, tidak utuh),
                    dengan fade-out ke kiri lewat mask gradasi supaya foto
                    menyatu dengan latar kartu di area teks. */}
                {a.FotoPath && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 w-[62%] bg-cover bg-center [mask-image:linear-gradient(to_right,transparent,black_55%)]"
                    style={{ backgroundImage: `url(${JSON.stringify(a.FotoPath)})` }}
                  />
                )}
                {/* Tanpa foto: ikon truk besar di sisi kanan sebagai pengganti,
                    di tempat yang sama dengan foto, dengan fade yang sama. */}
                {!a.FotoPath && (
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-0 flex w-[38%] items-center justify-center text-muted-foreground/40"
                  >
                    <Truck className="size-12" strokeWidth={1.4} />
                  </span>
                )}
                <span className="relative flex w-full min-w-0 items-start gap-2.5 whitespace-normal">
                  <span className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate text-sm font-semibold">{a.Nama}</span>
                      {a.PlatNomor && <Plat nomor={a.PlatNomor} />}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium", KONDISI_KELAS[a.Status])}>{a.Status}</span>
                      <span className={cn("truncate text-[11px] font-medium", memuat ? "text-muted-foreground" : op.kelas)}>
                        {memuat && !k ? "Memuat status…" : op.teks}
                      </span>
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      {tanpaWaktu ? (
                        <span className="flex flex-col gap-0.5">
                          <span>
                            Kapasitas{" "}
                            <span className="font-semibold text-foreground">
                              {a.KapasitasMaks != null ? a.KapasitasMaks.toLocaleString("id-ID") : "-"}
                            </span>{" "}
                            kantong
                          </span>
                          <span>Isi tanggal & jam kirim untuk melihat sisa</span>
                        </span>
                      ) : (
                        <BarisKapasitas info={info} candidateQty={candidateQty} memuat={memuat && !k} />
                      )}
                    </span>
                    {!memuat && !tanpaWaktu && (info.melebihi || info.bentrokTerbit) && (
                      <span className="flex items-center gap-1 text-[11px] font-medium text-destructive">
                        <AlertTriangle className="size-3 shrink-0" />
                        {info.bentrokTerbit
                          ? "Batch di jam ini sudah berangkat"
                          : `Penuh — pesanan ini melebihi ${(info.terisi + candidateQty - (info.maks ?? 0)).toLocaleString("id-ID")} kantong`}
                      </span>
                    )}
                  </span>
                </span>
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>

      {/* Peringatan untuk armada terpilih — tidak menghalangi simpan. */}
      {terpilih && infoTerpilih && !memuat && !tanpaWaktu && (infoTerpilih.melebihi || infoTerpilih.bentrokTerbit) && (
        <p className="flex items-start gap-1.5 rounded-md bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          {infoTerpilih.bentrokTerbit
            ? `${terpilih.Nama} sudah berangkat pada batch jam ini — pilih jam atau armada lain.`
            : `${terpilih.Nama} melebihi kapasitas: ${(infoTerpilih.terisi + candidateQty).toLocaleString("id-ID")} dari ${infoTerpilih.maks?.toLocaleString("id-ID")} kantong. Pesanan tetap bisa disimpan.`}
        </p>
      )}
    </div>
  );
}
