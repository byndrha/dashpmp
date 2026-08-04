"use client";

import { useState, useTransition } from "react";
import { Pencil, X, EyeOff, Eye, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { DriverProfileRow, SaveDriverProfileInput } from "@/lib/queries/driver-profile";
import { saveDriverProfileAction, deleteDriverProfileAction } from "@/app/(dashboard)/delivery/actions";

const WEEKDAYS = ["Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu", "Minggu"];

function toDateInputValue(value: string | Date | null): string {
  if (!value) return "";
  return new Date(value).toISOString().slice(0, 10);
}

function DriverFormDialog({
  open,
  onOpenChange,
  driver,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  driver: DriverProfileRow | null;
}) {
  const [tempatLahir, setTempatLahir] = useState("");
  const [tanggalLahir, setTanggalLahir] = useState("");
  const [nik, setNik] = useState("");
  const [alamat, setAlamat] = useState("");
  const [bergabungSejak, setBergabungSejak] = useState("");
  const [hariKerja, setHariKerja] = useState<Set<string>>(new Set());
  const [jamMulaiKerja, setJamMulaiKerja] = useState("");
  const [jamSelesaiKerja, setJamSelesaiKerja] = useState("");
  const [isHidden, setIsHidden] = useState(false);
  const [simTypes, setSimTypes] = useState<string[]>([]);
  const [simDraft, setSimDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function resetFromDriver(d: DriverProfileRow | null) {
    setTempatLahir(d?.TempatLahir ?? "");
    setTanggalLahir(toDateInputValue(d?.TanggalLahir ?? null));
    setNik(d?.NIK ?? "");
    setAlamat(d?.Alamat ?? "");
    setBergabungSejak(toDateInputValue(d?.BergabungSejak ?? null));
    setHariKerja(new Set(d?.HariKerja ? d.HariKerja.split(",").filter(Boolean) : []));
    setJamMulaiKerja(d?.JamMulaiKerja ?? "");
    setJamSelesaiKerja(d?.JamSelesaiKerja ?? "");
    setIsHidden(d?.IsHiddenFromDropdown ?? false);
    setSimTypes(d?.SimTypes ?? []);
    setSimDraft("");
    setError(null);
  }

  function toggleHari(day: string) {
    setHariKerja((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });
  }

  function addSim() {
    const value = simDraft.trim().toUpperCase();
    if (!value || simTypes.includes(value)) {
      setSimDraft("");
      return;
    }
    setSimTypes((prev) => [...prev, value]);
    setSimDraft("");
  }

  function removeSim(value: string) {
    setSimTypes((prev) => prev.filter((s) => s !== value));
  }

  function handleSubmit() {
    if (!driver) return;
    setError(null);
    const input: SaveDriverProfileInput = {
      salesmanId: driver.SalesmanID,
      tempatLahir: tempatLahir.trim() || null,
      tanggalLahir: tanggalLahir || null,
      nik: nik.trim() || null,
      alamat: alamat.trim() || null,
      bergabungSejak: bergabungSejak || null,
      hariKerja: hariKerja.size > 0 ? [...hariKerja].join(",") : null,
      jamMulaiKerja: jamMulaiKerja || null,
      jamSelesaiKerja: jamSelesaiKerja || null,
      isHiddenFromDropdown: isHidden,
      simTypes,
    };
    startTransition(async () => {
      try {
        await saveDriverProfileAction(input);
        onOpenChange(false);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Gagal menyimpan data driver.");
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        onOpenChange(next);
        if (next) resetFromDriver(driver);
      }}
    >
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Data Driver &mdash; {driver?.Name}</DialogTitle>
          <DialogDescription>Data pribadi driver, tersimpan terpisah dari data Salesman ERP.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tempatLahir" className="text-xs text-muted-foreground">
                Tempat Lahir
              </Label>
              <Input id="tempatLahir" value={tempatLahir} onChange={(e) => setTempatLahir(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tanggalLahir" className="text-xs text-muted-foreground">
                Tanggal Lahir
              </Label>
              <Input id="tanggalLahir" type="date" value={tanggalLahir} onChange={(e) => setTanggalLahir(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="nik" className="text-xs text-muted-foreground">
                No. NIK
              </Label>
              <Input id="nik" value={nik} onChange={(e) => setNik(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="bergabungSejak" className="text-xs text-muted-foreground">
                Bergabung Sejak
              </Label>
              <Input
                id="bergabungSejak"
                type="date"
                value={bergabungSejak}
                onChange={(e) => setBergabungSejak(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="alamat" className="text-xs text-muted-foreground">
              Alamat
            </Label>
            <Input id="alamat" value={alamat} onChange={(e) => setAlamat(e.target.value)} />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">No. SIM</Label>
            <div className="flex flex-wrap items-center gap-1.5">
              {simTypes.map((s) => (
                <Badge key={s} variant="outline" className="gap-1 pr-1">
                  {s}
                  <button type="button" onClick={() => removeSim(s)} className="rounded-full hover:bg-muted">
                    <X className="size-3" />
                  </button>
                </Badge>
              ))}
              <Input
                value={simDraft}
                onChange={(e) => setSimDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addSim();
                  }
                }}
                placeholder="mis. A, B1..."
                className="h-7 w-24 text-xs"
              />
              <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={addSim}>
                Tambah
              </Button>
            </div>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label className="text-xs text-muted-foreground">Hari Kerja</Label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAYS.map((day) => (
                <button
                  key={day}
                  type="button"
                  onClick={() => toggleHari(day)}
                  className={cn(
                    "rounded-full border px-2.5 py-1 text-xs transition-colors",
                    hariKerja.has(day) ? "border-primary bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
                  )}
                >
                  {day}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jamMulai" className="text-xs text-muted-foreground">
                Jam Mulai Kerja
              </Label>
              <Input id="jamMulai" type="time" value={jamMulaiKerja} onChange={(e) => setJamMulaiKerja(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="jamSelesai" className="text-xs text-muted-foreground">
                Jam Selesai Kerja
              </Label>
              <Input id="jamSelesai" type="time" value={jamSelesaiKerja} onChange={(e) => setJamSelesaiKerja(e.target.value)} />
            </div>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-fit gap-1.5"
            onClick={() => setIsHidden((v) => !v)}
          >
            {isHidden ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
            {isHidden ? "Disembunyikan dari Dropdown Driver" : "Tampil di Dropdown Driver"}
          </Button>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={handleSubmit}>
            {pending ? "Menyimpan..." : "Simpan"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// Driver identity itself comes from the real ERP Salesman table (no
// "Tambah Driver" here — nothing to create, the ERP Salesman row is never
// touched). Delete here only removes this SalesmanID's dashboard-only
// extension rows (DashboardDriverProfile/DashboardDriverSim) — the driver
// reappears with a blank profile the moment anyone re-saves against the
// same SalesmanID, since identity itself isn't stored here.
export function DriverManager({ drivers }: { drivers: DriverProfileRow[] }) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<DriverProfileRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(driver: DriverProfileRow) {
    if (!confirm(`Hapus data profil dashboard untuk "${driver.Name}"? Data Salesman ERP asli tidak akan terhapus.`)) return;
    setDeletingId(driver.SalesmanID);
    deleteDriverProfileAction(driver.SalesmanID).finally(() => setDeletingId(null));
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Kelola Driver
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Kelola Driver</DialogTitle>
            <DialogDescription>Data pribadi, SIM, jadwal kerja, dan visibilitas driver di dropdown.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col divide-y rounded-lg border">
            {drivers.map((d) => (
              <div key={d.SalesmanID} className="flex items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {d.Name}
                    {d.IsHiddenFromDropdown && (
                      <Badge variant="outline" className="shrink-0 text-[10px] text-muted-foreground">
                        Tersembunyi
                      </Badge>
                    )}
                  </p>
                  <p className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {d.SimTypes.length > 0 ? `SIM ${d.SimTypes.join(", ")}` : "Belum ada data SIM"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    onClick={() => {
                      setOpen(false);
                      setEditing(d);
                    }}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    disabled={deletingId === d.SalesmanID}
                    onClick={() => handleDelete(d)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {drivers.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Belum ada driver.</p>}
          </div>
        </DialogContent>
      </Dialog>

      <DriverFormDialog
        open={!!editing}
        onOpenChange={(next) => {
          if (!next) {
            setEditing(null);
            setOpen(true);
          }
        }}
        driver={editing}
      />
    </>
  );
}
