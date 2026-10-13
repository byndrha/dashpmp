"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  batalkanRondeAction,
  getPenagihanStateAction,
  hapusOptoutAction,
  lepasJedaAction,
  setujuiRondeAction,
  simpanPengaturanPenagihanAction,
  tambahOptoutAction,
  type AntreanView,
  type PenagihanState,
} from "@/app/mkesindo/(dashboard)/aging/penagihan-actions";
import type { Pengaturan } from "@/lib/penagihan/logika";

// Tab "Penagihan ByChat" modul Piutang (MKEsindo): semua pengaturan, ronde hari
// ini, hasil, dan opt-out. Tombol aktif/nonaktif per PT ada di /grup/perusahaan.

const HARI = [
  { n: 1, l: "Sen" }, { n: 2, l: "Sel" }, { n: 3, l: "Rab" }, { n: 4, l: "Kam" }, { n: 5, l: "Jum" }, { n: 6, l: "Sab" }, { n: 7, l: "Min" },
];
const rupiah = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const jam = (iso: string | null) =>
  iso ? new Date(iso).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Jakarta" }) : "—";
const tgl = (iso: string) => new Date(iso).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jakarta" });

const LABEL_WA: Record<string, string> = {
  sent: "Terkirim ke ByChat", delivered: "Diterima", read: "Dibaca", failed: "Gagal", tidak_terkonfirmasi: "Tidak terkonfirmasi",
};
const WARNA_STATUS: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  menunggu: "outline", terkirim: "default", dilewati: "secondary", gagal: "destructive", dibatalkan: "secondary",
};

function BarisAntrean({ a, tampilJadwal }: { a: AntreanView; tampilJadwal: boolean }) {
  return (
    <TableRow>
      <TableCell className="font-medium">{a.mitraNama}</TableCell>
      <TableCell className="tabular-nums">{a.nomor ?? "—"}</TableCell>
      <TableCell className="text-right tabular-nums">{a.nomor ? rupiah(a.totalPiutang) : "—"}</TableCell>
      <TableCell className="text-right tabular-nums">{a.nomor ? `${a.jumlahFaktur} / ${a.hariLewatMaks} hr` : "—"}</TableCell>
      {tampilJadwal && <TableCell className="tabular-nums">{jam(a.jadwalRencana)}</TableCell>}
      <TableCell>
        <Badge variant={WARNA_STATUS[a.status]}>{a.status}</Badge>
      </TableCell>
      <TableCell className="max-w-64 text-xs text-muted-foreground">{a.alasan ?? ""}</TableCell>
    </TableRow>
  );
}

export function PenagihanByChatPanel() {
  const [s, setS] = useState<PenagihanState | null>(null);
  const [galatMuat, setGalatMuat] = useState<string | null>(null);
  const [form, setForm] = useState<Pengaturan | null>(null);
  const [pesan, setPesan] = useState<{ teks: string; ok: boolean } | null>(null);
  const [nomorOpt, setNomorOpt] = useState("");
  const [alasanOpt, setAlasanOpt] = useState("");
  const [pending, startTransition] = useTransition();

  const muat = useCallback(async (resetForm: boolean) => {
    const r = await getPenagihanStateAction();
    if (!r.success) {
      setGalatMuat(r.error);
      return;
    }
    setGalatMuat(null);
    setS(r.data);
    if (resetForm) setForm(r.data.pengaturan);
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void muat(true), 0);
    return () => clearTimeout(t);
  }, [muat]);

  function jalankan(fn: () => Promise<{ success: boolean; error?: string }>, ok: string, resetForm = false) {
    setPesan(null);
    startTransition(async () => {
      const r = await fn();
      if (!r.success) {
        setPesan({ teks: r.error ?? "Gagal.", ok: false });
        return;
      }
      setPesan({ teks: ok, ok: true });
      await muat(resetForm);
    });
  }

  if (galatMuat) return <p className="text-sm text-destructive">{galatMuat}</p>;
  if (!s || !form) return <p className="text-sm text-muted-foreground">Memuat…</p>;

  const ubah = <K extends keyof Pengaturan>(k: K, v: Pengaturan[K]) => setForm({ ...form, [k]: v });
  const angka = (k: keyof Pengaturan) => (e: React.ChangeEvent<HTMLInputElement>) => ubah(k, Number(e.target.value.replace(/[^\d]/g, "")) as never);
  const ronde = s.ronde;

  return (
    <div className="flex flex-col gap-4">
      {/* Status */}
      <Card>
        <CardContent className="flex flex-col gap-2 pt-4 text-sm">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={s.aktif ? "default" : "secondary"}>{s.aktif ? "Penagihan otomatis AKTIF" : "Penagihan otomatis mati"}</Badge>
            <Badge variant="outline">Mode: {s.pengaturan.mode === "otomatis" ? "Otomatis" : "Pratinjau (perlu persetujuan)"}</Badge>
          </div>
          {!s.aktif && (
            <p className="text-xs text-muted-foreground">
              Belum aktif. Aktifkan lewat Grup → Perusahaan → Ubah PT → Integrasi ByChat → “Penagihan otomatis”. Tidak ada pesan yang dikirim selama mati.
            </p>
          )}
          {!s.koneksiAda && <p className="text-xs text-destructive">Koneksi ByChat PT ini belum diatur/aktif.</p>}
          {s.koneksiAda && !s.inboxAda && <p className="text-xs text-destructive">Inbox WhatsApp belum dipilih di pengaturan Integrasi ByChat.</p>}
          {s.jedaSampai && (
            <div className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 p-2 text-xs">
              <span className="text-destructive">
                Dijeda otomatis sampai {tgl(s.jedaSampai)} karena {s.gagalBeruntun} kegagalan kirim beruntun. Periksa koneksi/inbox ByChat.
              </span>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => jalankan(lepasJedaAction, "Jeda dilepas.")}>
                Lepas jeda
              </Button>
            </div>
          )}
          {pesan && <p className={`text-xs ${pesan.ok ? "text-green-700" : "text-destructive"}`}>{pesan.teks}</p>}
        </CardContent>
      </Card>

      {/* Ronde hari ini */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Ronde hari ini</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {!ronde ? (
            <p className="text-sm text-muted-foreground">
              Belum ada ronde. Ronde disusun otomatis pada menit pertama jendela kirim (hari & jam di bawah) bila penagihan aktif.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant={ronde.status === "pratinjau" ? "outline" : "default"}>{ronde.status}</Badge>
                <span className="text-muted-foreground">{ronde.tanggal}</span>
                {ronde.disetujuiOleh && <span className="text-xs text-muted-foreground">disetujui {ronde.disetujuiOleh}</span>}
                {ronde.status === "pratinjau" && (
                  <Button size="sm" disabled={pending} onClick={() => jalankan(() => setujuiRondeAction(ronde.id), "Ronde disetujui; pengiriman berjalan sesuai jadwal.")}>
                    Setujui & jalankan
                  </Button>
                )}
                {(ronde.status === "pratinjau" || ronde.status === "berjalan") && (
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => jalankan(() => batalkanRondeAction(ronde.id), "Ronde dibatalkan.")}>
                    Batalkan sisa
                  </Button>
                )}
              </div>
              {ronde.status === "pratinjau" && (
                <p className="text-xs text-muted-foreground">
                  Tinjau daftar. Belum ada pesan yang terkirim sebelum disetujui; jadwal disusun ulang dari saat Anda menyetujui, tetap dengan jeda antar pesan.
                </p>
              )}
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mitra</TableHead>
                      <TableHead>Nomor</TableHead>
                      <TableHead className="text-right">Piutang</TableHead>
                      <TableHead className="text-right">Faktur / lewat</TableHead>
                      <TableHead>Jadwal</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Keterangan</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {s.antrean.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                          Tidak ada mitra yang memenuhi kriteria.
                        </TableCell>
                      </TableRow>
                    ) : (
                      s.antrean.map((a) => <BarisAntrean key={a.id} a={a} tampilJadwal />)
                    )}
                  </TableBody>
                </Table>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Pengaturan */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Pengaturan</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <Label className="text-xs">Hari kirim</Label>
            <div className="flex flex-wrap gap-2">
              {HARI.map((h) => (
                <label key={h.n} className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={form.hari.includes(h.n)}
                    onChange={(e) => ubah("hari", e.target.checked ? [...form.hari, h.n] : form.hari.filter((x) => x !== h.n))}
                  />
                  {h.l}
                </label>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Kolom label="Jam mulai (WIB)">
              <Input type="time" value={form.jamMulai} onChange={(e) => ubah("jamMulai", e.target.value)} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Jam selesai (WIB)">
              <Input type="time" value={form.jamSelesai} onChange={(e) => ubah("jamSelesai", e.target.value)} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Jeda min (detik)">
              <Input inputMode="numeric" value={form.jedaMinDtk} onChange={angka("jedaMinDtk")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Jeda maks (detik)">
              <Input inputMode="numeric" value={form.jedaMaksDtk} onChange={angka("jedaMaksDtk")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Jeda panjang tiap (pesan)">
              <Input inputMode="numeric" value={form.jedaPanjangTiap} onChange={angka("jedaPanjangTiap")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Lama jeda panjang (detik)">
              <Input inputMode="numeric" value={form.jedaPanjangDtk} onChange={angka("jedaPanjangDtk")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Batas pesan per hari">
              <Input inputMode="numeric" value={form.batasHarian} onChange={angka("batasHarian")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Ulangi tagih tiap (hari)">
              <Input inputMode="numeric" value={form.ulangHari} onChange={angka("ulangHari")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Faktur lewat jatuh tempo ≥ (hari)">
              <Input inputMode="numeric" value={form.minHariLewat} onChange={angka("minHariLewat")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Total piutang ≥ (Rp)">
              <Input inputMode="numeric" value={form.minPiutang} onChange={angka("minPiutang")} className="h-8 text-xs" />
            </Kolom>
            <Kolom label="Mode">
              <select
                value={form.mode}
                onChange={(e) => ubah("mode", e.target.value as Pengaturan["mode"])}
                className="h-8 rounded-md border bg-background px-2 text-xs"
              >
                <option value="pratinjau">Pratinjau (perlu persetujuan)</option>
                <option value="otomatis">Otomatis penuh</option>
              </select>
            </Kolom>
          </div>
          <p className="text-xs text-muted-foreground">
            Hanya mitra dengan nomor yang cocok tepat satu mitra yang ditagih. Perubahan berlaku mulai ronde berikutnya (ronde hari ini tidak disusun ulang).
          </p>
          <div>
            <Button size="sm" disabled={pending} onClick={() => jalankan(() => simpanPengaturanPenagihanAction(form), "Pengaturan tersimpan.", true)}>
              Simpan pengaturan
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Hasil */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Hasil penagihan terakhir</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Mitra</TableHead>
                  <TableHead>Nomor</TableHead>
                  <TableHead className="text-right">Piutang</TableHead>
                  <TableHead className="text-right">Faktur / lewat</TableHead>
                  <TableHead>Diproses</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>WhatsApp</TableHead>
                  <TableHead>Keterangan</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {s.riwayat.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-sm text-muted-foreground">
                      Belum ada penagihan otomatis.
                    </TableCell>
                  </TableRow>
                ) : (
                  s.riwayat.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="font-medium">{a.mitraNama}</TableCell>
                      <TableCell className="tabular-nums">{a.nomor ?? "—"}</TableCell>
                      <TableCell className="text-right tabular-nums">{rupiah(a.totalPiutang)}</TableCell>
                      <TableCell className="text-right tabular-nums">{a.jumlahFaktur} / {a.hariLewatMaks} hr</TableCell>
                      <TableCell className="tabular-nums">{a.diprosesPada ? tgl(a.diprosesPada) : "—"}</TableCell>
                      <TableCell>
                        <Badge variant={WARNA_STATUS[a.status]}>{a.status}</Badge>
                      </TableCell>
                      <TableCell className="text-xs">{LABEL_WA[a.statusPesan ?? ""] ?? (a.status === "terkirim" ? "Menunggu cek" : "—")}</TableCell>
                      <TableCell className="max-w-64 text-xs text-muted-foreground">{a.alasan ?? ""}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
          <p className="mt-2 text-xs text-muted-foreground">Status WhatsApp dicek ke ByChat setelah ±1 menit, 10 menit, dan 1 jam. “Terkirim ke ByChat” belum menjamin sampai; hanya “Diterima”/“Dibaca” yang menjamin. “Tidak terkonfirmasi” tidak dikirim ulang otomatis (cegah pesan ganda) — periksa di kotak masuk ByChat. Pesan yang gagal di WhatsApp ikut hitungan jeda otomatis.</p>
        </CardContent>
      </Card>

      {/* Opt-out */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Daftar opt-out (tidak ditagih otomatis)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex flex-wrap items-end gap-2">
            <Kolom label="Nomor WhatsApp">
              <Input value={nomorOpt} onChange={(e) => setNomorOpt(e.target.value)} placeholder="0812…" className="h-8 w-44 text-xs" />
            </Kolom>
            <Kolom label="Alasan (opsional)">
              <Input value={alasanOpt} onChange={(e) => setAlasanOpt(e.target.value)} className="h-8 w-64 text-xs" />
            </Kolom>
            <Button
              size="sm"
              disabled={pending || !nomorOpt.trim()}
              onClick={() =>
                jalankan(async () => {
                  const r = await tambahOptoutAction(nomorOpt, alasanOpt);
                  if (r.success) {
                    setNomorOpt("");
                    setAlasanOpt("");
                  }
                  return r;
                }, "Nomor ditambahkan ke opt-out.")
              }
            >
              Tambah
            </Button>
          </div>
          {s.optout.length === 0 ? (
            <p className="text-sm text-muted-foreground">Belum ada nomor opt-out.</p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border text-sm">
              {s.optout.map((o) => (
                <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                  <span>
                    <span className="tabular-nums">{o.nomor}</span>
                    {o.alasan && <span className="text-muted-foreground"> — {o.alasan}</span>}
                    <span className="block text-xs text-muted-foreground">
                      {o.sumber}{o.dicatatOleh ? ` · ${o.dicatatOleh}` : ""} · {tgl(o.createdAt)}
                    </span>
                  </span>
                  <Button size="sm" variant="outline" disabled={pending} onClick={() => jalankan(() => hapusOptoutAction(o.id), "Opt-out dihapus.")}>
                    Hapus
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kolom({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
