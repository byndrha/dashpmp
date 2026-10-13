"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

// Panel "Mitra" di sidebar percakapan ByChat. Menerima token konteks
// bertanda tangan lewat postMessage (hanya dari origin ByChat), dan menyertakan
// token yang MASIH BERLAKU pada tiap aksi (token berumur 60 detik; bila habis
// diminta ulang ke ByChat). Tidak ada cookie dashpmp yang dipakai.

interface Aging {
  bucket: string;
  jumlah: number;
  total: number;
}
interface Faktur {
  noDokumen: string;
  tanggal: string;
  jatuhTempo: string;
  hariLewat: number;
  sisa: number;
}
interface Pembelian {
  noDokumen: string;
  tanggal: string;
  nilai: number;
}
interface MitraData {
  id: string;
  nama: string;
  wilayah: string | null;
  totalPiutang: number;
  jumlahFaktur: number;
  aging: Aging[];
  fakturTeratas: Faktur[];
  pembelianTerbaru: Pembelian[];
  pembelian30Hari: number;
  pembelian90Hari: number;
  terakhirKirim: { agenNama: string; waktu: string } | null;
}
interface Resp {
  pt: { kode: string; nama: string };
  kontak: { nama: string; nomor: string | null };
  agen: { nama: string; peran: string };
  inbox: { diatur: boolean; sesuai: boolean };
  totalCocok: number;
  mitra: MitraData[];
}
type Tahap = { s: "menunggu" } | { s: "memuat" } | { s: "siap"; data: Resp } | { s: "galat"; pesan: string; kode?: string };

const rp = (n: number) => `Rp ${Math.round(n).toLocaleString("id-ID")}`;
const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const tgl = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return `${d} ${BULAN[m - 1]} ${y}`;
};

// Hanya untuk mendeteksi pergantian percakapan di UI; server tetap
// memverifikasi tanda tangan token.
function conversationDari(token: string): string | null {
  try {
    const p = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return p.conversation_id != null ? String(p.conversation_id) : null;
  } catch {
    return null;
  }
}

export function EmbedMitra({ allowedOrigins }: { allowedOrigins: string[] }) {
  const [tahap, setTahap] = useState<Tahap>({ s: "menunggu" });
  const [dipilih, setDipilih] = useState<string | null>(null);
  const [pratinjau, setPratinjau] = useState<{ url: string } | null>(null);
  const [aksi, setAksi] = useState<{ memuat: boolean; pesan: string | null; ok: boolean }>({ memuat: false, pesan: null, ok: false });
  const [tautan, setTautan] = useState<{ url: string; salin: string | null } | null>(null);
  const tokenRef = useRef<{ token: string; exp: number } | null>(null);
  const penunggu = useRef<((t: string) => void)[]>([]);
  const conversasiRef = useRef<string | null>(null);

  const mintaToken = useCallback(() => {
    if (window.parent === window) return;
    window.parent.postMessage("chatwoot-dashboard-app:fetch-info", "*");
  }, []);

  const panggil = useCallback(async (path: string, body: Record<string, unknown>, token: string) => {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, token }),
      cache: "no-store",
    });
  }, []);

  const muat = useCallback(
    async (token: string, pesanSesudah?: { pesan: string; ok: boolean }) => {
      setTahap({ s: "memuat" });
      try {
        const res = await panggil("/api/bychat/mitra", {}, token);
        const json = await res.json();
        if (!res.ok) {
          setTahap({ s: "galat", pesan: json?.error?.pesan ?? "Gagal memuat data mitra.", kode: json?.error?.kode });
          return;
        }
        const data = json as Resp;
        setTahap({ s: "siap", data });
        setDipilih(data.mitra.length === 1 ? data.mitra[0].id : null);
        setPratinjau(null);
        setTautan(null);
        setAksi({ memuat: false, pesan: pesanSesudah?.pesan ?? null, ok: pesanSesudah?.ok ?? false });
      } catch {
        setTahap({ s: "galat", pesan: "Tidak dapat menghubungi server dashpmp." });
      }
    },
    [panggil]
  );

  // Token yang masih berlaku, atau minta baru ke ByChat dan tunggu (maks 10 dtk).
  const tokenSegar = useCallback((): Promise<string> => {
    const t = tokenRef.current;
    if (t && t.exp > Date.now() + 5000) return Promise.resolve(t.token);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Sesi konteks kedaluwarsa. Muat ulang panel.")), 10000);
      penunggu.current.push((tok) => {
        clearTimeout(timer);
        resolve(tok);
      });
      mintaToken();
    });
  }, [mintaToken]);

  useEffect(() => {
    if (window.parent === window) {
      const t = setTimeout(() => setTahap({ s: "galat", pesan: "Panel ini hanya berfungsi di dalam ByChat (Aplikasi Dasbor)." }), 0);
      return () => clearTimeout(t);
    }
    function onMsg(ev: MessageEvent) {
      if (!allowedOrigins.includes(ev.origin)) return;
      let d: unknown = ev.data;
      if (typeof d === "string") {
        try {
          d = JSON.parse(d);
        } catch {
          return;
        }
      }
      if (!d || typeof d !== "object") return;
      const m = d as { event?: string; data?: { token?: string; expires_in?: number } };
      if (m.event !== "appContextSigned" || !m.data?.token) return;
      const token = m.data.token;
      tokenRef.current = { token, exp: Date.now() + (m.data.expires_in ?? 60) * 1000 };
      penunggu.current.splice(0).forEach((f) => f(token));
      const conv = conversationDari(token);
      if (conv !== conversasiRef.current) {
        conversasiRef.current = conv;
        void muat(token);
      }
    }
    window.addEventListener("message", onMsg);
    mintaToken();
    return () => window.removeEventListener("message", onMsg);
  }, [allowedOrigins, mintaToken, muat]);

  async function lihatKartu(mitraId: string) {
    setAksi({ memuat: true, pesan: null, ok: false });
    try {
      const res = await panggil("/api/bychat/kartu", { mitraId }, await tokenSegar());
      if (!res.ok) {
        const j = await res.json();
        throw new Error(j?.error?.pesan ?? "Gagal membuat kartu.");
      }
      setPratinjau({ url: URL.createObjectURL(await res.blob()) });
      setAksi({ memuat: false, pesan: null, ok: false });
    } catch (e) {
      setAksi({ memuat: false, pesan: (e as Error).message, ok: false });
    }
  }

  async function ambilTautan(mitraId: string) {
    setAksi({ memuat: true, pesan: null, ok: false });
    try {
      const res = await panggil("/api/bychat/tautan", { mitraId }, await tokenSegar());
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.pesan ?? "Gagal membuat tautan.");
      let salin: string | null = null;
      try {
        await navigator.clipboard.writeText(j.url);
        salin = "Tautan disalin.";
      } catch {
        salin = null; // iframe tanpa izin clipboard: tautan tetap ditampilkan untuk disalin manual
      }
      setTautan({ url: j.url, salin });
      setAksi({ memuat: false, pesan: null, ok: false });
    } catch (e) {
      setAksi({ memuat: false, pesan: (e as Error).message, ok: false });
    }
  }

  async function kirim(mitraId: string) {
    setAksi({ memuat: true, pesan: null, ok: false });
    try {
      const res = await panggil("/api/bychat/kirim", { mitraId, konfirmasi: true }, await tokenSegar());
      const j = await res.json();
      if (!res.ok) throw new Error(j?.error?.pesan ?? "Gagal mengirim kartu.");
      const hasil = {
        pesan: j.replayed ? "Kartu ini sudah pernah dikirim hari ini (tidak dikirim ulang)." : "Kartu piutang terkirim ke WhatsApp mitra.",
        ok: true,
      };
      setAksi({ memuat: false, ...hasil });
      setPratinjau(null);
      // Muat ulang supaya "terakhir dikirim" ikut diperbarui, tanpa menghapus pesan hasil.
      const t = tokenRef.current?.token;
      if (t) void muat(t, hasil);
    } catch (e) {
      setAksi({ memuat: false, pesan: (e as Error).message, ok: false });
    }
  }

  if (tahap.s === "menunggu" || tahap.s === "memuat") {
    return <p className="p-3 text-xs text-muted-foreground">Memuat data mitra…</p>;
  }
  if (tahap.s === "galat") {
    return (
      <div className="flex flex-col gap-2 p-3 text-xs">
        <p className="text-destructive">{tahap.pesan}</p>
        {tahap.kode === "kedaluwarsa" && (
          <Button size="sm" variant="outline" onClick={mintaToken}>
            Muat ulang
          </Button>
        )}
      </div>
    );
  }

  const { data } = tahap;
  const mitra = data.mitra.find((m) => m.id === dipilih) ?? null;
  const tidakBisaKirim = !data.inbox.diatur
    ? "ID inbox PT belum diatur di dashpmp."
    : !data.inbox.sesuai
      ? "Percakapan ini bukan di inbox penagihan PT."
      : null;

  return (
    <div className="flex flex-col gap-3 p-3 text-xs">
      <div>
        <p className="text-[10px] uppercase tracking-wide text-muted-foreground">{data.pt.nama}</p>
        <p className="text-sm font-semibold">{data.kontak.nama || "Kontak"}</p>
        <p className="text-muted-foreground">{data.kontak.nomor ?? "Tanpa nomor WhatsApp"}</p>
      </div>

      {!data.kontak.nomor && (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
          Kontak ini tidak memiliki nomor asli (kontak berbasis LID), jadi tidak bisa dicocokkan dengan mitra.
        </p>
      )}
      {data.kontak.nomor && data.totalCocok === 0 && (
        <p className="rounded-md border p-2">Nomor ini belum terdaftar pada mitra mana pun di {data.pt.nama}.</p>
      )}
      {data.totalCocok > 1 && (
        <div className="flex flex-col gap-1.5">
          <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-amber-900">
            Nomor ini dipakai {data.totalCocok} mitra. Pilih mitra yang dimaksud.
          </p>
          {data.mitra.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-center gap-2 rounded-md border p-2">
              <input
                type="radio"
                name="mitra"
                checked={dipilih === m.id}
                onChange={() => {
                  setDipilih(m.id);
                  setPratinjau(null);
                  setTautan(null);
                  setAksi({ memuat: false, pesan: null, ok: false });
                }}
              />
              <span className="flex-1 font-medium">{m.nama}</span>
              <span className="text-muted-foreground">{rp(m.totalPiutang)}</span>
            </label>
          ))}
        </div>
      )}

      {mitra && (
        <div className="flex flex-col gap-3">
          <div>
            <p className="text-sm font-semibold">{mitra.nama}</p>
            {mitra.wilayah && <p className="text-muted-foreground">{mitra.wilayah}</p>}
          </div>

          <div className="rounded-md border p-2">
            <p className="text-muted-foreground">Total piutang</p>
            <p className={`text-lg font-semibold ${mitra.totalPiutang > 0 ? "text-red-600" : "text-green-600"}`}>{rp(mitra.totalPiutang)}</p>
            <p className="text-muted-foreground">{mitra.jumlahFaktur} faktur belum lunas</p>
          </div>

          {mitra.fakturTeratas.length > 0 && (
            <div className="flex flex-col gap-1">
              <p className="font-medium">Faktur paling lama</p>
              {mitra.fakturTeratas.map((f) => (
                <div key={f.noDokumen} className="flex justify-between gap-2">
                  <span className="truncate" title={f.noDokumen}>
                    {tgl(f.tanggal)} • {f.hariLewat > 0 ? `${f.hariLewat} hr` : "belum"}
                  </span>
                  <span>{rp(f.sisa)}</span>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <p className="font-medium">Pembelian</p>
            <div className="flex justify-between">
              <span>30 hari terakhir</span>
              <span>{rp(mitra.pembelian30Hari)}</span>
            </div>
            <div className="flex justify-between">
              <span>90 hari terakhir</span>
              <span>{rp(mitra.pembelian90Hari)}</span>
            </div>
            {mitra.pembelianTerbaru.map((p) => (
              <div key={p.noDokumen} className="flex justify-between text-muted-foreground">
                <span>{tgl(p.tanggal)}</span>
                <span>{rp(p.nilai)}</span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-2 border-t pt-2">
            {mitra.terakhirKirim && (
              <p className="text-muted-foreground">
                Kartu terakhir dikirim {new Date(mitra.terakhirKirim.waktu).toLocaleString("id-ID")} oleh {mitra.terakhirKirim.agenNama || "agen lain"}.
              </p>
            )}
            {tidakBisaKirim && <p className="text-amber-700">{tidakBisaKirim}</p>}
            {mitra.totalPiutang <= 0 && <p className="text-muted-foreground">Tidak ada piutang outstanding.</p>}
            {!pratinjau && (
              <Button size="sm" disabled={aksi.memuat || !!tidakBisaKirim || mitra.totalPiutang <= 0} onClick={() => lihatKartu(mitra.id)}>
                {aksi.memuat ? "Menyiapkan kartu…" : "Lihat & kirim kartu piutang"}
              </Button>
            )}
            {!pratinjau && (
              <Button size="sm" variant="outline" disabled={aksi.memuat || mitra.totalPiutang <= 0} onClick={() => ambilTautan(mitra.id)}>
                Salin tautan kartu
              </Button>
            )}
            {tautan && (
              <div className="flex flex-col gap-1">
                <input readOnly value={tautan.url} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border bg-background px-2 py-1 font-mono text-[11px]" />
                <p className="text-muted-foreground">{tautan.salin ?? "Pilih lalu salin tautan di atas."} Berlaku 30 hari, bisa dibuka tanpa login.</p>
              </div>
            )}
            {pratinjau && (
              <div className="flex flex-col gap-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pratinjau.url} alt="Pratinjau kartu piutang" className="w-full rounded-md border" />
                <p>
                  Kirim ke <span className="font-medium">{data.kontak.nomor}</span> ({mitra.nama})?
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={aksi.memuat} onClick={() => setPratinjau(null)}>
                    Batal
                  </Button>
                  <Button size="sm" disabled={aksi.memuat} onClick={() => kirim(mitra.id)}>
                    {aksi.memuat ? "Mengirim…" : "Kirim sekarang"}
                  </Button>
                </div>
              </div>
            )}
            {aksi.pesan && <p className={aksi.ok ? "text-green-700" : "text-destructive"}>{aksi.pesan}</p>}
          </div>
        </div>
      )}
    </div>
  );
}
