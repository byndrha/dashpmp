"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Combobox, ComboboxInput, ComboboxContent, ComboboxList, ComboboxItem, ComboboxEmpty } from "@/components/ui/combobox";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import type { MetodePembayaranRow, UpsertMetodePembayaranInput, Konteks } from "@/lib/queries/metode-pembayaran";
import type { ChartOfAccountOption } from "@/lib/queries/chart-of-account";
import {
  listMetodePembayaranAction,
  upsertMetodePembayaranAction,
  uploadQrisStatisImageAction,
  getSnapBiKredensialStatusAction,
  upsertSnapBiKredensialAction,
} from "@/app/grup/perusahaan/actions";

const METODE_OPTIONS: MetodePembayaranRow["metode"][] = ["TUNAI", "QRIS", "TRANSFER"];
const JENIS_OPTIONS: MetodePembayaranRow["jenis"][] = ["manual", "qris_static", "qris_dinamis"];
const JENIS_LABEL: Record<MetodePembayaranRow["jenis"], string> = {
  manual: "Manual",
  qris_static: "QRIS Statis",
  qris_dinamis: "QRIS Dinamis",
};
const KONTEKS_OPTIONS: { value: Konteks; label: string }[] = [
  { value: "driver", label: "Driver" },
  { value: "kasir", label: "Kasir" },
  { value: "publik", label: "Publik" },
];

interface CoaItem {
  value: string;
  label: string;
}

function emptyRowForm(perusahaanId: number, nextUrutan: number): UpsertMetodePembayaranInput {
  return {
    perusahaanId,
    kode: "",
    metode: "TUNAI",
    jenis: "manual",
    coaId: "",
    konteks: [],
    wajibCatatan: false,
    catatan: null,
    bankNama: null,
    nomorRekening: null,
    atasNama: null,
    urutan: nextUrutan,
    isActive: true,
  };
}

function rowToFormInput(row: MetodePembayaranRow): UpsertMetodePembayaranInput {
  return {
    id: row.id,
    perusahaanId: row.perusahaanId,
    kode: row.kode,
    metode: row.metode,
    jenis: row.jenis,
    coaId: row.coaId,
    konteks: row.konteks,
    wajibCatatan: row.wajibCatatan,
    catatan: row.catatan,
    bankNama: row.bankNama,
    nomorRekening: row.nomorRekening,
    atasNama: row.atasNama,
    urutan: row.urutan,
    isActive: row.isActive,
  };
}

// Inline add/edit block shared by both the "Tambah Metode" and row "Ubah"
// actions — same fieldset-inside-Dialog convention as PerusahaanFormDialog's
// "Tautan & Koneksi Database" block, rendered below the table instead of a
// nested Dialog.
function MetodeForm({
  form,
  chartOfAccountOptions,
  editingRow,
  onChange,
  onCancel,
  onSave,
  onUploaded,
  pending,
  error,
}: {
  form: UpsertMetodePembayaranInput;
  chartOfAccountOptions: ChartOfAccountOption[];
  editingRow: MetodePembayaranRow | null;
  onChange: (next: UpsertMetodePembayaranInput) => void;
  onCancel: () => void;
  onSave: () => void;
  onUploaded: (path: string) => void;
  pending: boolean;
  error: string | null;
}) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const coaItems: CoaItem[] = chartOfAccountOptions.map((o) => ({ value: o.id, label: `${o.id} — ${o.name}` }));
  const selectedCoa = coaItems.find((c) => c.value === form.coaId) ?? null;

  function toggleKonteks(value: Konteks) {
    const next = form.konteks.includes(value) ? form.konteks.filter((k) => k !== value) : [...form.konteks, value];
    onChange({ ...form, konteks: next });
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !editingRow) return;
    setUploading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("metodeId", String(editingRow.id));
      const result = await uploadQrisStatisImageAction(formData);
      if (!result.success) throw new Error(result.error);
      onUploaded(result.data);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Gagal mengunggah gambar QRIS.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        {editingRow ? `Ubah Metode — ${editingRow.kode}` : "Tambah Metode Pembayaran"}
      </legend>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mp-kode">Kode</Label>
          <Input id="mp-kode" value={form.kode} onChange={(e) => onChange({ ...form, kode: e.target.value })} placeholder="mis. tunai-kecil" />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Metode</Label>
          <Select value={form.metode} onValueChange={(v) => onChange({ ...form, metode: v as UpsertMetodePembayaranInput["metode"] })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => v}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {METODE_OPTIONS.map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="flex flex-col gap-1.5">
          <Label>Jenis</Label>
          <Select value={form.jenis} onValueChange={(v) => onChange({ ...form, jenis: v as UpsertMetodePembayaranInput["jenis"] })}>
            <SelectTrigger className="w-full">
              <SelectValue>{(v: string) => JENIS_LABEL[v as UpsertMetodePembayaranInput["jenis"]]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {JENIS_OPTIONS.map((j) => (
                <SelectItem key={j} value={j}>
                  {JENIS_LABEL[j]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label>Chart of Account</Label>
          <Combobox items={coaItems} value={selectedCoa} onValueChange={(item: CoaItem | null) => onChange({ ...form, coaId: item?.value ?? "" })}>
            <ComboboxInput placeholder="Cari akun..." />
            <ComboboxContent>
              <ComboboxEmpty>Tidak ditemukan.</ComboboxEmpty>
              <ComboboxList>
                {(item: CoaItem) => (
                  <ComboboxItem key={item.value} value={item}>
                    <span className="min-w-0 truncate">{item.label}</span>
                  </ComboboxItem>
                )}
              </ComboboxList>
            </ComboboxContent>
          </Combobox>
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Konteks</Label>
        <div className="flex flex-wrap gap-3">
          {KONTEKS_OPTIONS.map((k) => (
            <label key={k.value} className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={form.konteks.includes(k.value)}
                onChange={() => toggleKonteks(k.value)}
              />
              {k.label}
            </label>
          ))}
        </div>
      </div>

      <label className="flex items-center gap-1.5 text-xs">
        <input
          type="checkbox"
          className="accent-primary"
          checked={form.wajibCatatan}
          onChange={(e) => onChange({ ...form, wajibCatatan: e.target.checked })}
        />
        Wajib isi catatan saat dipakai
      </label>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="mp-catatan">Catatan (opsional)</Label>
        <Textarea
          id="mp-catatan"
          rows={2}
          value={form.catatan ?? ""}
          onChange={(e) => onChange({ ...form, catatan: e.target.value || null })}
        />
      </div>

      {form.metode === "TRANSFER" && (
        <div className="grid grid-cols-3 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mp-bank-nama">Nama Bank</Label>
            <Input
              id="mp-bank-nama"
              value={form.bankNama ?? ""}
              onChange={(e) => onChange({ ...form, bankNama: e.target.value || null })}
              placeholder="mis. Mandiri"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mp-nomor-rekening">Nomor Rekening</Label>
            <Input
              id="mp-nomor-rekening"
              value={form.nomorRekening ?? ""}
              onChange={(e) => onChange({ ...form, nomorRekening: e.target.value || null })}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="mp-atas-nama">Atas Nama</Label>
            <Input
              id="mp-atas-nama"
              value={form.atasNama ?? ""}
              onChange={(e) => onChange({ ...form, atasNama: e.target.value || null })}
            />
          </div>
        </div>
      )}

      {editingRow && editingRow.jenis === "qris_static" && (
        <div className="flex flex-col gap-1.5">
          <Label className="text-xs text-muted-foreground">Gambar QRIS Statis</Label>
          <div className="flex items-center gap-3">
            {editingRow.qrisStatisImagePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={editingRow.qrisStatisImagePath} alt="QRIS Statis" className="size-16 rounded-lg border object-cover" />
            ) : (
              <div className="flex size-16 shrink-0 items-center justify-center rounded-lg border border-dashed text-[10px] text-muted-foreground">
                Belum ada
              </div>
            )}
            <div className="flex flex-col gap-1">
              <Input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} className="text-xs" />
              {uploading && <p className="text-xs text-muted-foreground">Mengunggah...</p>}
              {uploadError && <p className="text-xs text-destructive">{uploadError}</p>}
            </div>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={pending}>
          Batal
        </Button>
        <Button type="button" size="sm" onClick={onSave} disabled={pending}>
          {pending ? "Menyimpan..." : "Simpan"}
        </Button>
      </div>
    </fieldset>
  );
}

function SnapBiForm({ perusahaanId }: { perusahaanId: number }) {
  const [status, setStatus] = useState<{ configured: boolean; clientId: string; merchantId: string; partnerId: string } | null>(null);
  const [loading, setLoading] = useState(true);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [merchantId, setMerchantId] = useState("");
  const [partnerId, setPartnerId] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getSnapBiKredensialStatusAction(perusahaanId).then((result) => {
      if (cancelled) return;
      if (result.success) {
        setStatus(result.data);
        setClientId(result.data?.clientId ?? "");
        setMerchantId(result.data?.merchantId ?? "");
        setPartnerId(result.data?.partnerId ?? "");
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [perusahaanId]);

  function handleSave() {
    setError(null);
    setSaved(false);
    startTransition(async () => {
      const result = await upsertSnapBiKredensialAction({ perusahaanId, clientId, clientSecret, merchantId, partnerId });
      if (!result.success) {
        setError(result.error);
        return;
      }
      setClientSecret("");
      setStatus({ configured: true, clientId, merchantId, partnerId });
      setSaved(true);
    });
  }

  return (
    <fieldset className="flex flex-col gap-3 rounded-lg border p-3">
      <legend className="px-1 text-xs font-medium text-muted-foreground">
        Kredensial Snap BI {status?.configured ? "(sudah dikonfigurasi)" : "(belum dikonfigurasi)"}
      </legend>
      {loading ? (
        <p className="text-xs text-muted-foreground">Memuat...</p>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">
            Dipakai untuk mengaktifkan QRIS Dinamis pada PT ini. Client Secret tidak pernah ditampilkan setelah tersimpan — isi ulang
            setiap kali menyimpan perubahan.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snap-client-id">Client ID</Label>
              <Input id="snap-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snap-merchant-id">Merchant ID</Label>
              <Input id="snap-merchant-id" value={merchantId} onChange={(e) => setMerchantId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snap-partner-id">Partner ID</Label>
              <Input id="snap-partner-id" value={partnerId} onChange={(e) => setPartnerId(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="snap-client-secret">Client Secret</Label>
              <Input
                id="snap-client-secret"
                type="password"
                value={clientSecret}
                onChange={(e) => setClientSecret(e.target.value)}
                placeholder="wajib diisi ulang"
              />
            </div>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-end gap-2">
            {saved && !pending && <p className="text-xs text-primary">Tersimpan.</p>}
            <Button type="button" size="sm" onClick={handleSave} disabled={pending}>
              {pending ? "Menyimpan..." : "Simpan Kredensial"}
            </Button>
          </div>
        </>
      )}
    </fieldset>
  );
}

export function PaymentMethodDialog({
  perusahaanId,
  perusahaanNama,
  chartOfAccountOptions,
  onOpenChange,
}: {
  perusahaanId: number | null;
  perusahaanNama: string;
  chartOfAccountOptions: ChartOfAccountOption[];
  onOpenChange: (open: boolean) => void;
}) {
  // null = not loaded yet (initial fetch in flight); an array (possibly
  // empty) once the first response has landed. Refreshes after a save never
  // reset this back to null, so the table doesn't flicker to a loading state
  // on every mutation — only the very first load shows "Memuat...".
  const [rows, setRows] = useState<MetodePembayaranRow[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [editing, setEditing] = useState<UpsertMetodePembayaranInput | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [togglingId, setTogglingId] = useState<number | null>(null);

  function refresh(id: number) {
    listMetodePembayaranAction(id).then((result) => {
      if (result.success) {
        setRows(result.data);
        setListError(null);
      } else {
        setListError(result.error);
      }
    });
  }

  useEffect(() => {
    // PaymentMethodDialog is remounted by perusahaan-list.tsx (keyed on the
    // target row) whenever it opens for a different PT, so editing/formError
    // already start at their null defaults here — this effect only needs to
    // kick off the initial fetch. refresh() itself only touches state inside
    // its .then() callback, never synchronously, so calling it here is safe.
    if (perusahaanId == null) return;
    refresh(perusahaanId);
  }, [perusahaanId]);

  const coaNameById = new Map(chartOfAccountOptions.map((o) => [o.id, o.name]));
  const editingRow = editing?.id != null ? ((rows ?? []).find((r) => r.id === editing.id) ?? null) : null;

  function handleSave() {
    if (!editing) return;
    setFormError(null);
    startTransition(async () => {
      const result = await upsertMetodePembayaranAction(editing);
      if (!result.success) {
        setFormError(result.error);
        return;
      }
      setEditing(null);
      if (perusahaanId != null) refresh(perusahaanId);
    });
  }

  function handleToggleActive(row: MetodePembayaranRow) {
    setTogglingId(row.id);
    setListError(null);
    startTransition(async () => {
      const result = await upsertMetodePembayaranAction({ ...rowToFormInput(row), isActive: !row.isActive });
      if (!result.success) {
        setListError(result.error);
      } else if (perusahaanId != null) {
        refresh(perusahaanId);
      }
      setTogglingId(null);
    });
  }

  return (
    <Dialog open={perusahaanId != null} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Kelola Pembayaran — {perusahaanNama}</DialogTitle>
          <DialogDescription>Atur metode pembayaran, gambar QRIS Statis, dan kredensial Snap BI untuk PT ini.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          {listError && <p className="text-xs text-destructive">{listError}</p>}

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Kode</TableHead>
                <TableHead>Metode</TableHead>
                <TableHead>Jenis</TableHead>
                <TableHead>COA</TableHead>
                <TableHead>Konteks</TableHead>
                <TableHead>Catatan</TableHead>
                <TableHead>Aktif</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {(rows ?? []).map((row) => (
                <TableRow key={row.id}>
                  <TableCell className="font-medium">{row.kode}</TableCell>
                  <TableCell>{row.metode}</TableCell>
                  <TableCell>{JENIS_LABEL[row.jenis]}</TableCell>
                  <TableCell className="max-w-32 truncate text-xs text-muted-foreground" title={coaNameById.get(row.coaId) ?? row.coaId}>
                    {coaNameById.get(row.coaId) ?? row.coaId}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.konteks.join(", ")}</TableCell>
                  <TableCell className="text-xs text-muted-foreground">{row.wajibCatatan ? "Wajib" : "-"}</TableCell>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={row.isActive}
                      disabled={togglingId === row.id}
                      onChange={() => handleToggleActive(row)}
                    />
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7"
                      onClick={() => {
                        setFormError(null);
                        setEditing(rowToFormInput(row));
                      }}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {rows != null && rows.length === 0 && (
                <TableRow>
                  <TableCell colSpan={8} className="whitespace-normal py-6 text-center text-sm text-muted-foreground">
                    Belum ada metode pembayaran untuk PT ini.
                  </TableCell>
                </TableRow>
              )}
              {rows == null && (
                <TableRow>
                  <TableCell colSpan={8} className="whitespace-normal py-6 text-center text-sm text-muted-foreground">
                    Memuat...
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>

          {editing ? (
            <MetodeForm
              form={editing}
              chartOfAccountOptions={chartOfAccountOptions}
              editingRow={editingRow}
              onChange={setEditing}
              onCancel={() => {
                setEditing(null);
                setFormError(null);
              }}
              onSave={handleSave}
              onUploaded={() => {
                if (perusahaanId != null) refresh(perusahaanId);
              }}
              pending={pending}
              error={formError}
            />
          ) : (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={() => {
                if (perusahaanId == null) return;
                setFormError(null);
                const nextUrutan = (rows ?? []).reduce((max, r) => Math.max(max, r.urutan), 0) + 1;
                setEditing(emptyRowForm(perusahaanId, nextUrutan));
              }}
            >
              <Plus className="size-4" />
              Tambah Metode
            </Button>
          )}

          {perusahaanId != null && <SnapBiForm perusahaanId={perusahaanId} />}
        </div>
      </DialogContent>
    </Dialog>
  );
}
