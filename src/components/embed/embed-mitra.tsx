"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { setEmbedTema, temaDariPesan } from "@/lib/embed-theme";

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
      // appContext (tema) dikirim ulang ByChat tiap tema diganti: dengarkan terus.
      const tema = temaDariPesan(ev.data);
      if (tema) {
        setEmbedTema(tema);
        return;
      }
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
    return (
      <main className="mx-auto w-full max-w-md p-4">
        <p className="text-sm text-muted-foreground">Memuat data mitra…</p>
      </main>
    );
  }
  if (tahap.s === "galat") {
    return (
      <main className="mx-auto flex w-full max-w-md flex-col gap-3 p-4 text-sm">
        <p className="rounded-lg border border-destructive/40 bg-destructive/10 p-3 text-destructive">{tahap.pesan}</p>
        {tahap.kode === "kedaluwarsa" && (
          <Button variant="outline" onClick={mintaToken}>
            Muat ulang
          </Button>
        )}
      </main>
    );
  }

  const { data } = tahap;
  const mitra = data.mitra.find((m) => m.id === dipilih) ?? null;
  const tidakBisaKirim = !data.inbox.diatur
    ? "ID inbox PT belum diatur di dashpmp."
    : !data.inbox.sesuai
      ? "Percakapan ini bukan di inbox penagihan PT."
      : null;
  const namaKontakSama = !!mitra && data.kontak.nama.trim().toLowerCase() === mitra.nama.trim().toLowerCase();
  const judulBagian = "mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground";
  const baris = "flex items-baseline justify-between gap-4 py-2";
  const angka = "shrink-0 font-medium tabular-nums";

  return (
    <main className="mx-auto flex w-full max-w-md flex-col gap-5 p-4 text-sm">
      <header className="flex flex-col gap-0.5">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{data.pt.nama}</p>
        {mitra ? (
          <>
            <h1 className="text-lg font-semibold leading-tight">{mitra.nama}</h1>
            {mitra.wilayah && <p className="text-muted-foreground">{mitra.wilayah}</p>}
            <p className="text-muted-foreground">
              {!namaKontakSama && data.kontak.nama ? `${data.kontak.nama} · ` : ""}
              {data.kontak.nomor ?? "Tanpa nomor WhatsApp"}
            </p>
          </>
        ) : (
          <>
            <h1 className="text-lg font-semibold leading-tight">{data.kontak.nama || "Kontak"}</h1>
            <p className="text-muted-foreground">{data.kontak.nomor ?? "Tanpa nomor WhatsApp"}</p>
          </>
        )}
      </header>

      {!data.kontak.nomor && (
        <p className="rounded-lg border border-warning/50 bg-warning/10 p-3">
          Kontak ini tidak memiliki nomor asli (kontak berbasis LID), jadi tidak bisa dicocokkan dengan mitra.
        </p>
      )}
      {data.kontak.nomor && data.totalCocok === 0 && (
        <p className="rounded-lg border bg-card p-3">Nomor ini belum terdaftar pada mitra mana pun di {data.pt.nama}.</p>
      )}
      {data.totalCocok > 1 && (
        <div className="flex flex-col gap-2">
          <p className="rounded-lg border border-warning/50 bg-warning/10 p-3">
            Nomor ini dipakai {data.totalCocok} mitra. Pilih mitra yang dimaksud.
          </p>
          {data.mitra.map((m) => (
            <label key={m.id} className="flex cursor-pointer items-center gap-3 rounded-lg border bg-card p-3 has-checked:border-primary">
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
              <span className="tabular-nums text-muted-foreground">{rp(m.totalPiutang)}</span>
            </label>
          ))}
        </div>
      )}

      {mitra && (
        <>
          <section className="rounded-xl border bg-card p-4">
            <p className="text-muted-foreground">Total piutang</p>
            <p className={`text-3xl font-semibold tabular-nums ${mitra.totalPiutang > 0 ? "text-destructive" : "text-primary"}`}>{rp(mitra.totalPiutang)}</p>
            <p className="mt-0.5 text-muted-foreground">{mitra.jumlahFaktur} faktur belum lunas</p>
          </section>

          {mitra.fakturTeratas.length > 0 && (
            <section>
              <h2 className={judulBagian}>Faktur paling lama</h2>
              <ul className="divide-y rounded-xl border bg-card px-4">
                {mitra.fakturTeratas.map((f) => (
                  <li key={f.noDokumen} className={baris} title={f.noDokumen}>
                    <span className="flex flex-wrap items-baseline gap-x-2">
                      <span>{tgl(f.tanggal)}</span>
                      <span className={`text-xs ${f.hariLewat > 0 ? "text-destructive" : "text-muted-foreground"}`}>
                        {f.hariLewat > 0 ? `${f.hariLewat} hari` : "belum jatuh tempo"}
                      </span>
                    </span>
                    <span className={angka}>{rp(f.sisa)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className={judulBagian}>Pembelian</h2>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">30 hari terakhir</p>
                <p className="font-semibold tabular-nums">{rp(mitra.pembelian30Hari)}</p>
              </div>
              <div className="rounded-xl border bg-card p-3">
                <p className="text-xs text-muted-foreground">90 hari terakhir</p>
                <p className="font-semibold tabular-nums">{rp(mitra.pembelian90Hari)}</p>
              </div>
            </div>
            {mitra.pembelianTerbaru.length > 0 && (
              <ul className="mt-2 divide-y rounded-xl border bg-card px-4">
                {mitra.pembelianTerbaru.map((p) => (
                  <li key={p.noDokumen} className={`${baris} text-muted-foreground`}>
                    <span>{tgl(p.tanggal)}</span>
                    <span className="shrink-0 tabular-nums">{rp(p.nilai)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="flex flex-col gap-3 border-t pt-4">
            {mitra.terakhirKirim && (
              <p className="text-xs text-muted-foreground">
                Kartu terakhir dikirim {new Date(mitra.terakhirKirim.waktu).toLocaleString("id-ID")} oleh {mitra.terakhirKirim.agenNama || "agen lain"}.
              </p>
            )}
            {tidakBisaKirim && <p className="text-warning">{tidakBisaKirim}</p>}
            {mitra.totalPiutang <= 0 && <p className="text-muted-foreground">Tidak ada piutang outstanding.</p>}
            {!pratinjau && (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button size="lg" className="h-10 flex-1" disabled={aksi.memuat || !!tidakBisaKirim || mitra.totalPiutang <= 0} onClick={() => lihatKartu(mitra.id)}>
                  {aksi.memuat ? "Menyiapkan kartu…" : "Lihat & kirim kartu piutang"}
                </Button>
                <Button size="lg" variant="outline" className="h-10 sm:shrink-0" disabled={aksi.memuat || mitra.totalPiutang <= 0} onClick={() => ambilTautan(mitra.id)}>
                  Salin tautan kartu
                </Button>
              </div>
            )}
            {tautan && (
              <div className="flex flex-col gap-1">
                <input readOnly value={tautan.url} onFocus={(e) => e.currentTarget.select()} className="w-full rounded-md border bg-background px-2 py-1.5 font-mono text-[11px]" />
                <p className="text-xs text-muted-foreground">{tautan.salin ?? "Pilih lalu salin tautan di atas."} Berlaku 30 hari, bisa dibuka tanpa login.</p>
              </div>
            )}
            {pratinjau && (
              <div className="flex flex-col gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={pratinjau.url} alt="Pratinjau kartu piutang" className="w-full rounded-lg border" />
                <p>
                  Kirim ke <span className="font-medium">{data.kontak.nomor}</span> ({mitra.nama})?
                </p>
                <div className="flex gap-2">
                  <Button size="lg" variant="outline" className="h-10" disabled={aksi.memuat} onClick={() => setPratinjau(null)}>
                    Batal
                  </Button>
                  <Button size="lg" className="h-10 flex-1" disabled={aksi.memuat} onClick={() => kirim(mitra.id)}>
                    {aksi.memuat ? "Mengirim…" : "Kirim sekarang"}
                  </Button>
                </div>
              </div>
            )}
            {aksi.pesan && <p className={aksi.ok ? "text-primary" : "text-destructive"}>{aksi.pesan}</p>}
          </section>
        </>
      )}
    </main>
  );
}
