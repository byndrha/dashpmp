"use client";

// Dialog Driver Health Check di Validasi Rute: tekanan darah, alkohol,
// pandangan, dan SIM. Penilaian langsung di layar hanya pratinjau — hasil
// yang berlaku adalah baris yang dikembalikan server setelah Simpan.
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { CircleCheck, CircleX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EditorSimDriver, rapikanSims } from "@/components/dashboard/editor-sim-driver";
import { cn } from "@/lib/utils";
import { BATAS_TENSI, hariIniWibISO, nilaiHealthCheck, type SimDriver } from "@/lib/health-check-driver";
import type { HealthCheckRow } from "@/lib/queries/driver-health-check";
import {
  getSimDriverAction,
  simpanSimDriverAction,
  simpanHealthCheckAction,
  ambilAlihHealthCheckAction,
} from "@/app/mkesindo/(dashboard)/delivery/actions";

/** Ikon status Health Check terbaru: kosong bila belum pernah dicek. */
export function StatusHealthCheck({ row }: { row: HealthCheckRow | null }) {
  if (!row) return null;
  if (row.Lolos) {
    return (
      <span title="Health Check lolos" className="inline-flex">
        <CircleCheck className="size-4 text-emerald-600 dark:text-emerald-400" aria-label="Health Check lolos" />
      </span>
    );
  }
  if (row.AmbilAlih) {
    return (
      <span title="Diambil alih" className="inline-flex">
        <CircleCheck className="size-4 text-amber-500 dark:text-amber-400" aria-label="Health Check diambil alih" />
      </span>
    );
  }
  return (
    <span title={row.AlasanGagal ? `Tidak lolos: ${row.AlasanGagal}` : "Health Check tidak lolos"} className="inline-flex">
      <CircleX className="size-4 text-destructive" aria-label="Health Check tidak lolos" />
    </span>
  );
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
    <div className="flex gap-1.5" role="radiogroup" aria-label="Hasil tes pandangan">
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
  onTutup,
  onSelesai,
}: {
  jadwalId: number;
  salesmanId: string;
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

  async function handleSimpanSim() {
    setSibuk(true);
    try {
      if (await simpanSim()) toast.success("Data SIM disimpan");
    } finally {
      setSibuk(false);
    }
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
          <ul className="mt-1.5 list-disc pl-5 text-xs text-destructive">
            {alasanList.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        </div>
        {modeAmbilAlih ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted-foreground">
              Kode ambil-alih didapat dari Manager, berlaku 3 menit dan hanya bisa dipakai sekali.
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
              <Button variant="outline" disabled={sibuk} onClick={() => setModeAmbilAlih(false)}>
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
          <span className="text-xs text-muted-foreground">sesuai tampilan alat (harus 0)</span>
        </div>
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>Pandangan</Label>
          <LabelHasil status={statusPandangan} />
        </div>
        <PilihanPandangan nilai={pandangan} onUbah={setPandangan} />
      </section>

      <section className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>SIM</Label>
          <LabelHasil status={statusSim} />
        </div>
        {simMemuat ? (
          <Skeleton className="h-16 w-full" />
        ) : simGagalMuat ? (
          <p className="text-xs text-destructive">Gagal memuat SIM: {simGagalMuat}</p>
        ) : (
          <>
            <EditorSimDriver sims={sims} onUbah={setSims} />
            {simBerubah && (
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] text-amber-700 dark:text-amber-400">Perubahan SIM belum disimpan</span>
                <Button type="button" size="sm" variant="outline" disabled={sibuk} onClick={handleSimpanSim}>
                  Simpan SIM
                </Button>
              </div>
            )}
          </>
        )}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="accent-primary"
            checked={simDibawa}
            onChange={(e) => setSimDibawa(e.target.checked)}
          />
          SIM fisik dibawa
        </label>
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
            {sibuk ? "Menyimpan..." : simBerubah ? "Simpan SIM & Health Check" : "Simpan"}
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
  onSelesai,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jadwalId: number;
  salesmanId: string;
  namaDriver: string;
  onSelesai: (row: HealthCheckRow) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Health Check Driver</DialogTitle>
          <DialogDescription>
            {namaDriver} — wajib lolos sebelum Selesai Muat. Berlaku hanya untuk keberangkatan ini.
          </DialogDescription>
        </DialogHeader>
        {/* Dipasang ulang tiap dibuka / ganti driver agar formulir selalu kosong. */}
        {open && (
          <IsiHealthCheck
            key={`${jadwalId}|${salesmanId}`}
            jadwalId={jadwalId}
            salesmanId={salesmanId}
            onTutup={() => onOpenChange(false)}
            onSelesai={onSelesai}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
