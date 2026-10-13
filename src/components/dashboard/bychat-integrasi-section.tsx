"use client";

import { useEffect, useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  getByChatIntegrasiAction,
  hapusByChatIntegrasiAction,
  setPenagihanAktifAction,
  simpanWebhookSecretAction,
  simpanByChatIntegrasiAction,
  ujiKoneksiByChatAction,
  type ByChatIntegrasiState,
} from "@/app/grup/perusahaan/bychat-actions";
import type { UjiKoneksiHasil } from "@/lib/bychat/client";

// Bagian "Integrasi ByChat" di dialog Ubah PT. Berdiri sendiri (tombolnya
// type="button" dan Enter dinonaktifkan) supaya tidak ikut men-submit form PT.
// Satu akun ByChat = satu PT; token API disimpan terenkripsi dan tidak pernah
// ditampilkan kembali.

export function BychatIntegrasiSection({ perusahaanId }: { perusahaanId: number }) {
  const [state, setState] = useState<ByChatIntegrasiState | null>(null);
  const [url, setUrl] = useState("");
  const [accountId, setAccountId] = useState("");
  const [token, setToken] = useState("");
  const [inboxId, setInboxId] = useState("");
  const [aktif, setAktif] = useState(true);
  const [penagihanAktif, setPenagihanAktif] = useState(false);
  const [webhookSecret, setWebhookSecret] = useState("");
  const [uji, setUji] = useState<UjiKoneksiHasil | null>(null);
  const [pesan, setPesan] = useState<{ teks: string; ok: boolean } | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let batal = false;
    void getByChatIntegrasiAction(perusahaanId).then((r) => {
      if (batal || !r.success) return;
      setState(r.data);
      const k = r.data.konfigurasi;
      setUrl(k?.bychatUrl ?? r.data.urlDefault);
      setAccountId(k ? String(k.bychatAccountId) : "");
      setInboxId(k?.inboxId != null ? String(k.inboxId) : "");
      setAktif(k?.aktif ?? true);
      setPenagihanAktif(r.data.penagihanAktif);
    });
    return () => {
      batal = true;
    };
  }, [perusahaanId]);

  const stopEnter = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") e.preventDefault();
  };
  const idAkun = Number(accountId);
  const tersimpan = state?.konfigurasi != null;

  function jalankanUji() {
    setPesan(null);
    startTransition(async () => {
      const r = await ujiKoneksiByChatAction({ perusahaanId, url, accountId: idAkun, token: token || null });
      if (!r.success) {
        setUji(null);
        setPesan({ teks: r.error, ok: false });
        return;
      }
      setUji(r.data);
      setPesan({ teks: r.data.pesan, ok: r.data.ok });
    });
  }

  function simpan() {
    setPesan(null);
    startTransition(async () => {
      const r = await simpanByChatIntegrasiAction({
        perusahaanId,
        url,
        accountId: idAkun,
        token: token || null,
        inboxId: inboxId ? Number(inboxId) : null,
        aktif,
      });
      if (!r.success) {
        setPesan({ teks: r.error, ok: false });
        return;
      }
      setToken("");
      setPesan({ teks: "Integrasi ByChat tersimpan.", ok: true });
      const baru = await getByChatIntegrasiAction(perusahaanId);
      if (baru.success) setState(baru.data);
    });
  }

  function ubahPenagihan(nilai: boolean) {
    setPesan(null);
    startTransition(async () => {
      const r = await setPenagihanAktifAction(perusahaanId, nilai);
      if (!r.success) {
        setPesan({ teks: r.error, ok: false });
        return;
      }
      setPenagihanAktif(nilai);
      setPesan({ teks: nilai ? "Penagihan otomatis diaktifkan." : "Penagihan otomatis dimatikan.", ok: true });
    });
  }

  function simpanWebhook(hapusRahasia: boolean) {
    setPesan(null);
    startTransition(async () => {
      const r = await simpanWebhookSecretAction(perusahaanId, hapusRahasia ? "" : webhookSecret);
      if (!r.success) {
        setPesan({ teks: r.error, ok: false });
        return;
      }
      setWebhookSecret("");
      setPesan({ teks: hapusRahasia ? "Rahasia webhook dihapus." : "Rahasia webhook tersimpan.", ok: true });
      const baru = await getByChatIntegrasiAction(perusahaanId);
      if (baru.success) setState(baru.data);
    });
  }

  function hapus() {
    startTransition(async () => {
      const r = await hapusByChatIntegrasiAction(perusahaanId);
      if (!r.success) {
        setPesan({ teks: r.error, ok: false });
        return;
      }
      setToken("");
      setAccountId("");
      setInboxId("");
      setUji(null);
      setPesan({ teks: "Integrasi ByChat dihapus.", ok: true });
      const baru = await getByChatIntegrasiAction(perusahaanId);
      if (baru.success) setState(baru.data);
    });
  }

  if (!state) {
    return (
      <fieldset className="flex flex-col gap-2 rounded-lg border p-3">
        <legend className="px-1 text-xs font-medium text-muted-foreground">Integrasi ByChat</legend>
        <p className="text-xs text-muted-foreground">Memuat…</p>
      </fieldset>
    );
  }

  return (
    <fieldset className="flex flex-col gap-2 rounded-lg border p-3" onKeyDown={stopEnter}>
      <legend className="px-1 text-xs font-medium text-muted-foreground">Integrasi ByChat</legend>
      <p className="text-xs text-muted-foreground">
        Satu akun ByChat untuk satu PT. Token adalah token pengguna khusus berperan <span className="font-medium">agen</span> (bukan administrator).
      </p>

      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-xs" htmlFor="bychat_url">URL ByChat</Label>
          <Input id="bychat_url" value={url} onChange={(e) => setUrl(e.target.value)} placeholder={state.urlDefault} className="h-8 text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="bychat_account">ID akun ByChat</Label>
          <Input id="bychat_account" inputMode="numeric" value={accountId} onChange={(e) => setAccountId(e.target.value.replace(/\D/g, ""))} className="h-8 text-xs" />
        </div>
        <div className="flex flex-col gap-1">
          <Label className="text-xs" htmlFor="bychat_inbox">Inbox WhatsApp</Label>
          {uji?.ok && uji.inbox.length > 0 ? (
            <select
              id="bychat_inbox"
              value={inboxId}
              onChange={(e) => setInboxId(e.target.value)}
              className="h-8 rounded-md border bg-background px-2 text-xs"
            >
              <option value="">(pilih inbox)</option>
              {uji.inbox.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.id} — {i.name}
                </option>
              ))}
            </select>
          ) : (
            <Input id="bychat_inbox" inputMode="numeric" value={inboxId} onChange={(e) => setInboxId(e.target.value.replace(/\D/g, ""))} placeholder="uji koneksi dulu" className="h-8 text-xs" />
          )}
        </div>
        <div className="col-span-2 flex flex-col gap-1">
          <Label className="text-xs" htmlFor="bychat_token">Token Akses API</Label>
          <Input
            id="bychat_token"
            type="password"
            autoComplete="off"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder={tersimpan ? "(tersimpan — kosongkan untuk tetap memakai yang lama)" : "wajib diisi untuk koneksi baru"}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <label className="flex items-center gap-2 text-xs">
        <input type="checkbox" checked={aktif} onChange={(e) => setAktif(e.target.checked)} />
        Aktif
      </label>

      {tersimpan && (
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <label className="flex items-center gap-2 text-xs font-medium">
            <input type="checkbox" checked={penagihanAktif} disabled={pending} onChange={(e) => ubahPenagihan(e.target.checked)} />
            Penagihan otomatis
          </label>
          <p className="text-xs text-muted-foreground">
            Mengirim kartu piutang ke mitra terjadwal lewat ByChat. Bawaan mati. Hari, jam, jeda, batas harian, dan kriteria mitra diatur di modul Piutang, tab Penagihan ByChat.
          </p>
        </div>
      )}

      {tersimpan && (
        <div className="flex flex-col gap-1 rounded-md border p-2">
          <p className="text-xs font-medium">Webhook pesan masuk (opt-out otomatis)</p>
          <p className="text-xs text-muted-foreground">
            Administrator ByChat mendaftarkan webhook (langganan <span className="font-mono">message_created</span>) ke URL di bawah, lalu rahasianya ditempel di sini. Balasan tegas seperti “stop” / “berhenti” otomatis masuk daftar opt-out.
          </p>
          <p className="break-all rounded bg-muted p-1 font-mono text-xs">{state.webhookUrl}</p>
          <div className="flex gap-2">
            <Input
              type="password"
              autoComplete="off"
              value={webhookSecret}
              onChange={(e) => setWebhookSecret(e.target.value)}
              placeholder={state.webhookSecretAda ? "(tersimpan — isi untuk mengganti)" : "rahasia webhook dari ByChat"}
              className="h-8 text-xs"
            />
            <Button type="button" size="sm" disabled={pending || !webhookSecret.trim()} onClick={() => simpanWebhook(false)}>Simpan</Button>
            {state.webhookSecretAda && (
              <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => simpanWebhook(true)}>Hapus</Button>
            )}
          </div>
        </div>
      )}

      <div className="rounded-md bg-muted p-2 text-xs">
        <p className="font-medium">URL Aplikasi Dasbor (daftarkan di ByChat akun ini)</p>
        <p className="break-all font-mono">{state.embedUrl}</p>
      </div>

      {pesan && <p className={`text-xs ${pesan.ok ? "text-green-700" : "text-destructive"}`}>{pesan.teks}</p>}

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" disabled={pending || !idAkun} onClick={jalankanUji}>
          {pending ? "Memeriksa…" : "Uji koneksi"}
        </Button>
        <Button type="button" size="sm" disabled={pending || !idAkun} onClick={simpan}>
          Simpan integrasi
        </Button>
        {tersimpan && (
          <Button type="button" variant="outline" size="sm" disabled={pending} onClick={hapus}>
            Hapus
          </Button>
        )}
      </div>
    </fieldset>
  );
}
