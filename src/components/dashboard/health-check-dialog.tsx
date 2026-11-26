"use client";

// Dialog Driver Health Check di Validasi Rute: tekanan darah, alkohol,
// pandangan, dan SIM. Penilaian langsung di layar hanya pratinjau — hasil
// yang berlaku adalah baris yang dikembalikan server setelah Simpan.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CircleX, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorSimDriver, rapikanSims } from "@/components/dashboard/editor-sim-driver";
import { cn } from "@/lib/utils";
import { formatDate, formatTime } from "@/lib/format";
import { BATAS_TENSI, hariIniWibISO, nilaiHealthCheck, type SimDriver } from "@/lib/health-check-driver";
import type { HealthCheckRow } from "@/lib/queries/driver-health-check";
import {
  getSimDriverAction,
  simpanSimDriverAction,
  simpanHealthCheckAction,
  ambilAlihHealthCheckAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

// Ikon status dipindah ke status-health-check.tsx (dipakai juga di papan).
export { StatusHealthCheck } from "@/components/dashboard/status-health-check";

/** Baris terbaru yang tidak lolos dan belum diambil alih — syarat ambil alih. */
function gagalBelumDiambilAlih(row: HealthCheckRow | null | undefined): row is HealthCheckRow {
  return row != null && !row.Lolos && !row.AmbilAlih;
}

/** "" → null; koma desimal diterima; teks tak terbaca → null (bukan NaN). */
function keAngka(teks: string): number | null {
  const t = teks.trim().replace(",", ".");
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function LabelHasil({ status }: { status: "lolos" | "gagal" | null }) {
  if (status == null) return <span className="text-[11px] text-muted-foreground">Belum diisi</span>;
  return status === "lolos" ? (
    <span className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">Lolos</span>
  ) : (
    <span className="text-[11px] font-medium text-destructive">Tidak lolos</span>
  );
}

function PilihanPandangan({ nilai, onUbah }: { nilai: boolean | null; onUbah: (v: boolean) => void }) {
  return (
    <div className="flex gap-1.5" role="radiogroup" aria-label="Hasil tes fokus pandangan">
      {[
        { v: true, label: "Lolos" },
        { v: false, label: "Tidak lolos" },
      ].map((p) => (
        <Button
          key={p.label}
          type="button"
          size="sm"
          role="radio"
          aria-checked={nilai === p.v}
          variant={nilai === p.v ? "default" : "outline"}
          className={cn(nilai === p.v && !p.v && "bg-destructive text-white hover:bg-destructive/90")}
          onClick={() => onUbah(p.v)}
        >
          {p.label}
        </Button>
      ))}
    </div>
  );
}

function IsiHealthCheck({
  jadwalId,
  salesmanId,
  terbaru,
  onTutup,
  onSelesai,
}: {
  jadwalId: number;
  salesmanId: string;
  terbaru: HealthCheckRow | null;
  onTutup: () => void;
  onSelesai: (row: HealthCheckRow) => void;
}) {
  // Tanggal WIB dibekukan saat dialog dibuka — cukup untuk umur sebuah dialog.
  const [hariIni] = useState(() => hariIniWibISO());
  const [sistolik, setSistolik] = useState("");
  const [diastolik, setDiastolik] = useState("");
  const [alkohol, setAlkohol] = useState("");
  const [pandangan, setPandangan] = useState<boolean | null>(null);
  const [simDibawa, setSimDibawa] = useState(false);
  const [catatan, setCatatan] = useState("");

  const [sims, setSims] = useState<SimDriver[]>([]);
  // JSON SIM terakhir yang tersimpan di server (null = belum dimuat).
  const [simsTersimpan, setSimsTersimpan] = useState<string | null>(null);
  const [simGagalMuat, setSimGagalMuat] = useState<string | null>(null);

  const [sibuk, setSibuk] = useState(false);
  const [hasil, setHasil] = useState<HealthCheckRow | null>(null);
  // Hasil gagal terakhir (dari baris terbaru induk saat dialog dibuka, atau
  // dari Simpan di sesi ini) — membuat "Ambil alih dengan kode" tetap
  // terjangkau walau dialog dibuka ulang setelah pemeriksaan yang gagal.
  const [gagalTerakhir, setGagalTerakhir] = useState<HealthCheckRow | null>(() =>
    gagalBelumDiambilAlih(terbaru) && terbaru.JadwalID === jadwalId && terbaru.SalesmanID === salesmanId ? terbaru : null,
  );
  const [modeAmbilAlih, setModeAmbilAlih] = useState(false);
  const [kode, setKode] = useState("");
  const [alasan, setAlasan] = useState("");
  const [galatAmbilAlih, setGalatAmbilAlih] = useState<string | null>(null);

  useEffect(() => {
    let batal = false;
    getSimDriverAction(salesmanId).then((r) => {
      if (batal) return;
      if (r.success) {
        setSims(r.data);
        setSimsTersimpan(JSON.stringify(rapikanSims(r.data)));
      } else {
        setSimGagalMuat(r.error);
      }
    });
    return () => {
      batal = true;
    };
  }, [salesmanId]);

  const simsRapi = useMemo(() => rapikanSims(sims), [sims]);
  const simMemuat = simsTersimpan == null && simGagalMuat == null;
  const simBerubah = simsTersimpan != null && JSON.stringify(simsRapi) !== simsTersimpan;
  // Baris yang sudah berisi nomor/tanggal tapi golongannya kosong, atau
  // golongan ganda, ditolak server — tunggu dilengkapi sebelum disimpan.
  const golonganRapi = simsRapi.map((s) => s.jenisSim);
  const simSiapSimpan =
    golonganRapi.every((g) => g !== "") && new Set(golonganRapi).size === golonganRapi.length;
  const [statusSimpanSim, setStatusSimpanSim] = useState<"menyimpan" | "tersimpan" | null>(null);

  // Data SIM disimpan OTOMATIS ke data driver (jeda 0,8 dtk setelah berhenti
  // mengetik) — tidak bergantung pada tombol Simpan Health Check, jadi SIM
  // yang sudah diisi tidak hilang walau dialog ditutup dan tidak perlu
  // diinput ulang di keberangkatan berikutnya.
  useEffect(() => {
    if (!simBerubah || !simSiapSimpan) return;
    const json = JSON.stringify(simsRapi);
    const t = setTimeout(async () => {
      setStatusSimpanSim("menyimpan");
      const r = await simpanSimDriverAction(salesmanId, simsRapi);
      if (r.success) {
        setSimsTersimpan(json);
        setStatusSimpanSim("tersimpan");
      } else {
        setStatusSimpanSim(null);
        toast.error(r.error);
      }
    }, 800);
    return () => clearTimeout(t);
  }, [simBerubah, simSiapSimpan, simsRapi, salesmanId]);

  const masukan = {
    sistolik: keAngka(sistolik),
    diastolik: keAngka(diastolik),
    kadarAlkohol: keAngka(alkohol),
    pandanganLolos: pandangan,
    simDibawa,
  };
  const pratinjau = nilaiHealthCheck({ ...masukan, sims: simsRapi }, hariIni);
  const gagalDengan = (awalan: string) => pratinjau.alasanGagal.some((a) => a.startsWith(awalan));
  const statusTensi =
    masukan.sistolik == null || masukan.diastolik == null ? null : gagalDengan("Tekanan darah") ? "gagal" : "lolos";
  const statusAlkohol = masukan.kadarAlkohol == null ? null : gagalDengan("Kadar alkohol") ? "gagal" : "lolos";
  const statusPandangan = pandangan == null ? null : pandangan ? "lolos" : "gagal";
  const statusSim = simMemuat ? null : gagalDengan("Tidak ada SIM") || !simDibawa ? "gagal" : "lolos";

  async function simpanSim(): Promise<boolean> {
    const r = await simpanSimDriverAction(salesmanId, simsRapi);
    if (!r.success) {
      toast.error(r.error);
      return false;
    }
    setSims(simsRapi);
    setSimsTersimpan(JSON.stringify(simsRapi));
    return true;
  }

  async function handleSimpan() {
    setSibuk(true);
    try {
      // Server menilai SIM dari data tersimpan — perubahan SIM di formulir
      // harus tersimpan dulu agar hasilnya sama dengan pratinjau.
      if (simBerubah && !(await simpanSim())) return;
      const r = await simpanHealthCheckAction({
        jadwalId,
        salesmanId,
        masukan,
        catatan: catatan.trim() === "" ? null : catatan.trim(),
      });
      if (!r.success) {
        toast.error(r.error);
        return;
      }
      onSelesai(r.data);
      if (r.data.Lolos) {
        toast.success("Health Check lolos");
        onTutup();
      } else {
        setGagalTerakhir(r.data);
        setHasil(r.data);
      }
    } finally {
      setSibuk(false);
    }
  }

  async function handleAmbilAlih() {
    setSibuk(true);
    setGalatAmbilAlih(null);
    try {
      const r = await ambilAlihHealthCheckAction({ jadwalId, salesmanId, kode: kode.trim(), alasan: alasan.trim() });
      if (!r.success) {
        setGalatAmbilAlih(r.error);
        return;
      }
      onSelesai(r.data);
      toast.success("Health Check diambil alih");
      onTutup();
    } finally {
      setSibuk(false);
    }
  }

  // ---- Setelah disimpan dan tidak lolos ----
  if (hasil) {
    const alasanList = (hasil.AlasanGagal ?? "").split("; ").filter(Boolean);
    return (
      <div className="flex flex-col gap-3">
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
            <CircleX className="size-4" />
            Tidak lolos Health Check
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            Diperiksa {formatDate(hasil.DiperiksaPada)} {formatTime(hasil.DiperiksaPada)}
          </p>
          <ul className="mt-1.5 list-disc pl-5 text-xs text-destructive">
            {alasanList.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        {modeAmbilAlih ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Kode ambil alih didapat dari Manager, berlaku 3 menit dan hanya bisa dipakai sekali.
            </p>
            <Input
              type="text"
              inputMode="numeric"
              maxLength={6}
              placeholder="Kode 6 digit"
              value={kode}
              onChange={(e) => setKode(e.target.value)}
            />
            <Textarea
              placeholder="Alasan ambil alih (wajib)"
              maxLength={400}
              value={alasan}
              onChange={(e) => setAlasan(e.target.value)}
            />
            {galatAmbilAlih && <p className="text-sm text-destructive">{galatAmbilAlih}</p>}
            <div className="flex justify-end gap-2">
              <Button
              variant="outline"
              disabled={sibuk}
              onClick={() => {
                setModeAmbilAlih(false);
                setGalatAmbilAlih(null);
              }}
            >
                Batal
              </Button>
              <Button
                disabled={sibuk || kode.trim().length !== 6 || alasan.trim() === ""}
                onClick={handleAmbilAlih}
              >
                {sibuk ? "Memproses..." : "Konfirmasi"}
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="outline" onClick={onTutup}>
              Ganti driver
            </Button>
            <Button variant="outline" onClick={() => setHasil(null)}>
              Periksa ulang
            </Button>
            <Button onClick={() => setModeAmbilAlih(true)}>Ambil alih dengan kode</Button>
          </div>
        )}
      </div>
    );
  }

  // ---- Formulir ----
  return (
    <div className="flex flex-col gap-4">
      {gagalTerakhir && (
        <div className="flex flex-col gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-destructive">
              <CircleX className="size-4" />
              Health Check terakhir tidak lolos
            </p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              {formatDate(gagalTerakhir.DiperiksaPada)} {formatTime(gagalTerakhir.DiperiksaPada)}
              {gagalTerakhir.AlasanGagal ? ` — ${gagalTerakhir.AlasanGagal}` : ""}
            </p>
          </div>
          <div className="flex justify-end">
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={sibuk}
              onClick={() => {
                setHasil(gagalTerakhir);
                setModeAmbilAlih(true);
              }}
            >
              Ambil alih dengan kode
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">Atau periksa ulang dengan formulir di bawah.</p>
        </div>
      )}
      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Tekanan darah</Label>
          <LabelHasil status={statusTensi} />
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Sistolik"
            aria-label="Sistolik"
            value={sistolik}
            onChange={(e) => setSistolik(e.target.value)}
            className="w-24"
          />
          <span className="text-muted-foreground">/</span>
          <Input
            type="number"
            inputMode="numeric"
            placeholder="Diastolik"
            aria-label="Diastolik"
            value={diastolik}
            onChange={(e) => setDiastolik(e.target.value)}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">mmHg</span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Batas lolos {BATAS_TENSI.sistolikMin}–{BATAS_TENSI.sistolikMaks} / {BATAS_TENSI.diastolikMin}–
          {BATAS_TENSI.diastolikMaks}
        </p>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="hc-alkohol">Kadar alkohol</Label>
          <LabelHasil status={statusAlkohol} />
        </div>
        <div className="flex items-center gap-1.5">
          <Input
            id="hc-alkohol"
            type="number"
            inputMode="decimal"
            step="any"
            min={0}
            placeholder="0"
            value={alkohol}
            onChange={(e) => setAlkohol(e.target.value)}
            className="w-24"
          />
          <span className="text-xs text-muted-foreground">sesuai tampilan alat (Normal = 0)</span>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Fokus Pandangan</Label>
          <LabelHasil status={statusPandangan} />
        </div>
        <PilihanPandangan nilai={pandangan} onUbah={setPandangan} />
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-3">
            <Label>SIM</Label>
            <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                className="accent-primary"
                checked={simDibawa}
                onChange={(e) => setSimDibawa(e.target.checked)}
              />
              SIM fisik dibawa
            </label>
          </div>
          {!simMemuat && !simGagalMuat && sims.length === 0 ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 gap-1 px-2 text-xs"
              onClick={() => setSims([{ jenisSim: "", nomorSim: null, berlakuHingga: null }])}
            >
              <Plus className="size-3.5" />
              Tambah SIM
            </Button>
          ) : (
            <LabelHasil status={statusSim} />
          )}
        </div>
        {simMemuat ? (
          <Skeleton className="h-16 w-full" />
        ) : simGagalMuat ? (
          <p className="text-xs text-destructive">Gagal memuat SIM: {simGagalMuat}</p>
        ) : sims.length > 0 ? (
          <>
            <EditorSimDriver sims={sims} onUbah={setSims} />
            {simBerubah && !simSiapSimpan ? (
              <span className="text-[11px] text-amber-700 dark:text-amber-400">
                Lengkapi golongan SIM (tidak boleh ganda) agar tersimpan
              </span>
            ) : statusSimpanSim === "menyimpan" ? (
              <span className="text-[11px] text-muted-foreground">Menyimpan data SIM…</span>
            ) : statusSimpanSim === "tersimpan" && !simBerubah ? (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Data SIM tersimpan</span>
            ) : null}
          </>
        ) : null}
        {pratinjau.peringatan.map((p) => (
          <p key={p} className="text-[11px] text-amber-700 dark:text-amber-400">
            {p}
          </p>
        ))}
      </section>

      <section className="flex flex-col gap-1.5">
        <Label htmlFor="hc-catatan">Catatan (opsional)</Label>
        <Textarea id="hc-catatan" maxLength={400} value={catatan} onChange={(e) => setCatatan(e.target.value)} />
      </section>

      <div className="flex items-center justify-between gap-2">
        <span className={cn("text-xs font-medium", pratinjau.lolos ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
          {pratinjau.lolos ? "Semua syarat terpenuhi" : `${pratinjau.alasanGagal.length} syarat belum terpenuhi`}
        </span>
        <div className="flex gap-2">
          <Button variant="outline" disabled={sibuk} onClick={onTutup}>
            Batal
          </Button>
          <Button disabled={sibuk || simMemuat || simGagalMuat != null} onClick={handleSimpan}>
            {sibuk ? "Menyimpan..." : "Simpan"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export function HealthCheckDialog({
  open,
  onOpenChange,
  jadwalId,
  salesmanId,
  namaDriver,
  terbaru = null,
  onSelesai,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jadwalId: number;
  salesmanId: string;
  namaDriver: string;
  /** Baris Health Check terbaru untuk jadwal+driver ini (dari induk). */
  terbaru?: HealthCheckRow | null;
  onSelesai: (row: HealthCheckRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          {/* pr-8: memberi ruang tombol tutup (X) di pojok kanan atas. */}
          <DialogTitle className="flex items-center justify-between gap-3 pr-8">
            <span>Health Check Driver</span>
            <span className="truncate text-sm font-medium text-muted-foreground">{namaDriver}</span>
          </DialogTitle>
          <DialogDescription className="sr-only">Health Check driver {namaDriver} untuk keberangkatan ini</DialogDescription>
        </DialogHeader>
        {/* Dipasang ulang tiap dibuka / ganti driver agar formulir selalu kosong. */}
        {open && (
          <IsiHealthCheck
            key={`${jadwalId}|${salesmanId}`}
            jadwalId={jadwalId}
            salesmanId={salesmanId}
            terbaru={terbaru}
            onTutup={() => onOpenChange(false)}
            onSelesai={onSelesai}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
