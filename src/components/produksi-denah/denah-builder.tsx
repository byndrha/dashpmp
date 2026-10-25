"use client";

// Builder Denah Produksi Es Balok — editor layar penuh "ala game".
// Spec: docs/superpowers/specs/2026-10-25-produksi-es-balok-builder-denah-design.md §Builder ala game
//
// Pembagian kerja:
// - builder-state.ts   : reducer murni + riwayat undo/redo (≥100 langkah).
// - denah-kanvas.tsx   : SATU-SATUNYA mesin gambar; builder hanya memakai
//                        prop mode edit (onPointerDown/Move/Up, overlay, dst.).
// - file ini           : gestur (pilih, drag, kotak seleksi, ubah ukuran,
//                        gambar), snap grid + garis bantu, pintasan, simpan.
//
// Performa: saat drag, elemen TIDAK diubah di dokumen — kanvas menggesernya
// lewat transform (geserSementara), dan satu aksi "pindah" dikirim saat
// pointer dilepas (= satu entri riwayat). Ubah ukuran memakai transaksi
// reducer (perubahan langsung, satu entri saat selesai). Posisi kursor dan
// tampilan kanvas disimpan di toko mini agar hanya status bar / hantu alat /
// minimap yang dirender ulang saat mouse bergerak.

import { memo, useCallback, useDeferredValue, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeft, Keyboard, Maximize, PanelRight, Redo2, RefreshCw, Save, TriangleAlert, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  denahKosong,
  kotakElemen,
  validasiDenah,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type GalatDenah,
  type HasilSimpanDenah,
  type KodeProduksi,
  type TipeElemen,
  type Titik,
} from "@/lib/produksi-denah";
import { simpanDenahAction } from "@/app/produksi-denah-actions";
import { DenahKanvas, type DenahKanvasHandle, type GeserSementara, type InfoPointerKanvas } from "@/components/produksi-denah/denah-kanvas";
import {
  UKURAN_BAWAAN,
  NAMA_TIPE,
  bakBertumpuk,
  bisaRedo,
  bisaUndo,
  buatElemen,
  builderReducer,
  garisDerek,
  kotakGabungan,
  kotor as dokKotor,
  stateAwal,
  type Kotak,
} from "@/components/produksi-denah/builder-state";
import { cocokkanPintasan, DAFTAR_PINTASAN, type Alat } from "@/components/produksi-denah/pintasan-keyboard";
import { PaletAlat } from "@/components/produksi-denah/palet-alat";
import { PanelProperti } from "@/components/produksi-denah/panel-properti";
import { PanelKolom } from "@/components/produksi-denah/panel-kolom";
import { PanelValidasi } from "@/components/produksi-denah/panel-validasi";
import { Minimap, type InfoTampilan } from "@/components/produksi-denah/minimap";
import { buatToko, useToko, type Toko } from "@/components/produksi-denah/bidang";

// ---------- Tipe ----------

type Handle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
const HANDLE: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
const KURSOR_HANDLE: Record<Handle, string> = {
  nw: "nwse-resize",
  se: "nwse-resize",
  ne: "nesw-resize",
  sw: "nesw-resize",
  n: "ns-resize",
  s: "ns-resize",
  e: "ew-resize",
  w: "ew-resize",
};

type Gestur =
  | {
      jenis: "elemen";
      id: string;
      kolomId: string | null;
      cx: number;
      cy: number;
      awal: Titik;
      shift: boolean;
      ctrl: boolean;
      sudahTerpilih: boolean;
      idsGeser: ReadonlySet<string>;
      kotak: Kotak | null;
      kandidat: { x: number[]; y: number[] };
      bergerak: boolean;
      dx: number;
      dy: number;
    }
  | { jenis: "kotak"; cx: number; cy: number; awal: Titik; tambah: boolean; bergerak: boolean; akhir: Titik }
  | { jenis: "ukuran"; id: string; handle: Handle; kotak: Kotak }
  | { jenis: "titik"; id: string; ujung: "a" | "b" }
  | { jenis: "gambar"; alat: TipeElemen; cx: number; cy: number; awal: Titik; akhir: Titik; bergerak: boolean };

interface Visual {
  geser: GeserSementara | null;
  kotakSeleksi: Kotak | null;
  garisBantu: { x: number[]; y: number[] };
  gambar: { alat: TipeElemen; a: Titik; b: Titik; bergerak: boolean } | null;
  ukuran: Kotak | null;
}

const VISUAL_KOSONG: Visual = { geser: null, kotakSeleksi: null, garisBantu: { x: [], y: [] }, gambar: null, ukuran: null };
const AMBANG_PX = 3;
const AMBANG_BANTU_PX = 6;

type Penolakan = { jenis: "basi"; pesan: string } | { jenis: "kolom"; pesan: string; galat: GalatDenah[] } | null;
type Tab = "properti" | "kolom" | "validasi";

export interface DenahBuilderProps {
  kode: KodeProduksi;
  namaPerusahaan: string;
  dokumenAwal: DenahDokumen | null;
  versiAwal: number | null;
  /** Ganti fungsi simpan (pratinjau/tes). Bawaan: simpanDenahAction(kode, …). */
  onSimpan?: (dok: DenahDokumen, versiDasar: number | null) => Promise<HasilSimpanDenah>;
}

// ---------- Utilitas ----------

function ketikDiInput(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

function kotakDari(a: Titik, b: Titik): Kotak {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
}

function bersinggungan(a: Kotak, b: Kotak) {
  return a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
}

const bulat2 = (v: number) => Math.round(v * 100) / 100;
const snapTitik = (p: Titik, aktif: boolean): Titik => (aktif ? { x: Math.round(p.x), y: Math.round(p.y) } : { x: bulat2(p.x), y: bulat2(p.y) });

/** Kotak elemen saat alat diklik tanpa drag: ukuran bawaan, berpusat di kursor. */
function kotakBawaan(alat: TipeElemen, c: Titik, snap: boolean): Kotak {
  const u = UKURAN_BAWAAN[alat];
  const p = snapTitik({ x: c.x - u.w / 2, y: c.y - u.h / 2 }, snap);
  return { x: p.x, y: p.y, w: u.w, h: u.h };
}

function garisBawaan(alat: TipeElemen, c: Titik, snap: boolean): { a: Titik; b: Titik } {
  const u = UKURAN_BAWAAN[alat];
  const a = snapTitik({ x: c.x - u.w / 2, y: c.y }, snap);
  return { a, b: { x: a.x + u.w, y: a.y } };
}

const ALAT_GARIS = new Set<TipeElemen>(["derek", "dinding"]);

/** Snap pergeseran: garis bantu (tepi/tengah elemen lain) bila dekat, selain itu grid. */
function hitungGeser(kotak: Kotak, rawDx: number, rawDy: number, snap: boolean, kandidat: { x: number[]; y: number[] }, ambang: number) {
  if (!snap) return { dx: bulat2(rawDx), dy: bulat2(rawDy), gx: [] as number[], gy: [] as number[] };
  const satuSumbu = (pos: number, panjang: number, raw: number, daftar: number[]) => {
    const fitur = [0, panjang / 2, panjang];
    let terbaik: { d: number; garis: number; delta: number } | null = null;
    for (const f of fitur) {
      const p = pos + raw + f;
      for (const c of daftar) {
        const d = Math.abs(c - p);
        if (d <= ambang && (!terbaik || d < terbaik.d)) terbaik = { d, garis: c, delta: c - pos - f };
      }
    }
    if (terbaik) {
      const delta = terbaik.delta;
      const garis = fitur.map((f) => pos + delta + f).filter((v) => daftar.some((c) => Math.abs(c - v) < 1e-6));
      return { delta, garis };
    }
    return { delta: Math.round(pos + raw) - pos, garis: [] as number[] };
  };
  const sx = satuSumbu(kotak.x, kotak.w, rawDx, kandidat.x);
  const sy = satuSumbu(kotak.y, kotak.h, rawDy, kandidat.y);
  return { dx: sx.delta, dy: sy.delta, gx: sx.garis, gy: sy.garis };
}

function ubahUkuran(k: Kotak, h: Handle, p: Titik, min = 1): Kotak {
  let x1 = k.x;
  let y1 = k.y;
  let x2 = k.x + k.w;
  let y2 = k.y + k.h;
  if (h.includes("w")) x1 = Math.min(p.x, x2 - min);
  if (h.includes("e")) x2 = Math.max(p.x, x1 + min);
  if (h.includes("n")) y1 = Math.min(p.y, y2 - min);
  if (h.includes("s")) y2 = Math.max(p.y, y1 + min);
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

// ---------- Komponen utama ----------

export function DenahBuilder({ kode, namaPerusahaan, dokumenAwal, versiAwal, onSimpan }: DenahBuilderProps) {
  const router = useRouter();
  const hrefKembali = `/${kode}/produksi`;
  const [state, dispatch] = useReducer(builderReducer, dokumenAwal, (d) => stateAwal(d ?? denahKosong()));
  const [versi, setVersi] = useState<number | null>(versiAwal);
  const [alat, setAlat] = useState<Alat>("pilih");
  const [tab, setTab] = useState<Tab>("properti");
  const [visual, setVisual] = useState<Visual>(VISUAL_KOSONG);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [penolakan, setPenolakan] = useState<Penolakan>(null);
  const [contekan, setContekan] = useState(false);
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState(false);
  const [konfirmasiMuatUlang, setKonfirmasiMuatUlang] = useState(false);
  const [panelTerbuka, setPanelTerbuka] = useState(false);
  const [kursorToko] = useState(() => buatToko<Titik | null>(null));
  const [tampilanToko] = useState(() => buatToko<InfoTampilan | null>(null));
  const kanvasRef = useRef<DenahKanvasHandle>(null);
  const gestur = useRef<Gestur | null>(null);
  const lewatiPeringatan = useRef(false);

  const { dok } = state;
  const kotor = dokKotor(state);
  const terpilihSet = useMemo(() => new Set(state.terpilih), [state.terpilih]);
  const kolomTerpilihSet = useMemo(() => new Set(state.kolomTerpilih), [state.kolomTerpilih]);
  const elemenTerpilih = useMemo(() => dok.elemen.filter((e) => terpilihSet.has(e.id)), [dok.elemen, terpilihSet]);
  const byId = useMemo(() => new Map(dok.elemen.map((e) => [e.id, e])), [dok.elemen]);
  const bakTerpilih = elemenTerpilih.length === 1 && elemenTerpilih[0].tipe === "bak" ? (elemenTerpilih[0] as BakElemen) : null;

  // Validasi langsung (ditunda agar drag ubah ukuran tetap halus).
  const dokTunda = useDeferredValue(dok);
  const galat = useMemo(() => validasiDenah(dokTunda), [dokTunda]);
  const galatServer = penolakan?.jenis === "kolom" ? penolakan.galat : null;
  const sorotIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of galat) if (g.elemenId) s.add(g.elemenId);
    for (const g of galatServer ?? []) if (g.elemenId) s.add(g.elemenId);
    return s;
  }, [galat, galatServer]);
  const kolomSorotIds = useMemo(() => new Set((galatServer ?? []).map((g) => g.kolomId).filter((x): x is string => !!x)), [galatServer]);
  const tumpukIds = useMemo(() => bakBertumpuk(dok.elemen, visual.geser), [dok.elemen, visual.geser]);

  // ---------- Peringatan keluar ----------
  useEffect(() => {
    if (!kotor) return;
    const f = (e: BeforeUnloadEvent) => {
      if (lewatiPeringatan.current) return;
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", f);
    return () => window.removeEventListener("beforeunload", f);
  }, [kotor]);

  const keluar = () => {
    if (kotor) setKonfirmasiKeluar(true);
    else router.push(hrefKembali);
  };

  // ---------- Simpan ----------
  const simpan = async () => {
    if (menyimpan) return;
    const dokSimpan = state.dok;
    const g = validasiDenah(dokSimpan);
    if (g.length > 0) {
      setTab("validasi");
      setPanelTerbuka(true);
      toast.error(`Denah belum valid: ${g.length} masalah.`);
      return;
    }
    setMenyimpan(true);
    try {
      const fn = onSimpan ?? ((d: DenahDokumen, v: number | null) => simpanDenahAction(kode, d, v));
      const r = await fn(dokSimpan, versi);
      if (r.success) {
        setVersi(r.data.versi);
        dispatch({ type: "tandaiTersimpan", dok: dokSimpan });
        setPenolakan(null);
        toast.success(`Denah tersimpan · versi ${r.data.versi}`);
      } else if (r.kodeGalat === "VERSI_BASI") {
        setPenolakan({ jenis: "basi", pesan: r.error });
      } else if (r.kodeGalat === "KOLOM_TERKUNCI") {
        setPenolakan({ jenis: "kolom", pesan: r.error.split("\n")[0], galat: r.galat ?? [] });
        setTab("validasi");
        setPanelTerbuka(true);
        toast.error(`Ditolak: ${r.galat?.length ?? 0} kolom masih berisi es.`);
      } else {
        toast.error(r.error);
      }
    } catch {
      toast.error("Gagal menghubungi server. Periksa koneksi lalu coba lagi.");
    } finally {
      setMenyimpan(false);
    }
  };

  // ---------- Fokus ----------
  const fokusKotak = useCallback((k: Kotak) => {
    const w = Math.max(k.w + 8, 30);
    const h = Math.max(k.h + 8, 20);
    kanvasRef.current?.fokusKe({ x: k.x + k.w / 2 - w / 2, y: k.y + k.h / 2 - h / 2, w, h });
  }, []);

  const fokusGalat = useCallback(
    (g: GalatDenah) => {
      const e = g.elemenId ? byId.get(g.elemenId) : undefined;
      if (!e) return;
      if (g.kolomId && e.tipe === "bak" && e.kolom.some((k) => k.id === g.kolomId)) {
        dispatch({ type: "aturKolomTerpilih", bakId: e.id, kolomIds: [g.kolomId] });
      } else dispatch({ type: "pilih", ids: [e.id] });
      fokusKotak(kotakElemen(e));
    },
    [byId, fokusKotak]
  );

  // ---------- Gestur kanvas ----------

  const ambang = () => {
    const t = kanvasRef.current?.tampilan();
    return t ? AMBANG_BANTU_PX / t.skala : 0.3;
  };

  const kandidatBantu = (abaikan: ReadonlySet<string>) => {
    const x = [0, dok.kanvas.lebar / 2, dok.kanvas.lebar];
    const y = [0, dok.kanvas.tinggi / 2, dok.kanvas.tinggi];
    for (const e of dok.elemen) {
      if (abaikan.has(e.id)) continue;
      const k = kotakElemen(e);
      x.push(k.x, k.x + k.w / 2, k.x + k.w);
      y.push(k.y, k.y + k.h / 2, k.y + k.h);
    }
    return { x, y };
  };

  const onPointerDown = (info: InfoPointerKanvas): boolean => {
    const ev = info.event;
    if (alat === "geser") return false;
    const snap = !ev.altKey;
    setHoverId(null);

    // Handle ubah ukuran / titik derek (overlay).
    const handleEl = ev.target instanceof Element ? ev.target.closest("[data-handle]") : null;
    const handle = handleEl?.getAttribute("data-handle");
    if (handle && elemenTerpilih.length === 1 && !elemenTerpilih[0].terkunci) {
      const e = elemenTerpilih[0];
      dispatch({ type: "mulaiTransaksi" });
      if (handle === "a" || handle === "b") gestur.current = { jenis: "titik", id: e.id, ujung: handle };
      else gestur.current = { jenis: "ukuran", id: e.id, handle: handle as Handle, kotak: kotakElemen(e) };
      return true;
    }

    if (alat !== "pilih") {
      const a = snapTitik(info.titik, snap);
      gestur.current = { jenis: "gambar", alat, cx: ev.clientX, cy: ev.clientY, awal: a, akhir: a, bergerak: false };
      setVisual({ ...VISUAL_KOSONG, gambar: { alat, a, b: a, bergerak: false } });
      return true;
    }

    if (info.elemenId && byId.has(info.elemenId)) {
      const id = info.elemenId;
      const sudah = terpilihSet.has(id);
      const shift = ev.shiftKey;
      let ids: string[];
      if (sudah) ids = state.terpilih;
      else if (shift) {
        ids = [...state.terpilih, id];
        dispatch({ type: "pilih", ids: [id], tambah: true });
      } else {
        ids = [id];
        dispatch({ type: "pilih", ids: [id] });
      }
      const geser = ids.map((x) => byId.get(x)).filter((e): e is DenahElemen => !!e && !e.terkunci);
      const idsGeser = new Set(geser.map((e) => e.id));
      gestur.current = {
        jenis: "elemen",
        id,
        kolomId: info.kolomId,
        cx: ev.clientX,
        cy: ev.clientY,
        awal: info.titik,
        shift,
        ctrl: ev.ctrlKey || ev.metaKey,
        sudahTerpilih: sudah,
        idsGeser,
        kotak: kotakGabungan(geser),
        kandidat: kandidatBantu(idsGeser),
        bergerak: false,
        dx: 0,
        dy: 0,
      };
      return true;
    }

    gestur.current = { jenis: "kotak", cx: ev.clientX, cy: ev.clientY, awal: info.titik, akhir: info.titik, tambah: ev.shiftKey, bergerak: false };
    return true;
  };

  const onPointerMove = (info: InfoPointerKanvas, aktif: boolean) => {
    kursorToko.set(info.titik);
    if (!aktif) {
      const h = alat === "pilih" ? info.elemenId : null;
      if (h !== hoverId) setHoverId(h);
      return;
    }
    const g = gestur.current;
    if (!g) return;
    const ev = info.event;
    const snap = !ev.altKey;
    const lewatAmbang = (cx: number, cy: number) => Math.hypot(ev.clientX - cx, ev.clientY - cy) >= AMBANG_PX;

    switch (g.jenis) {
      case "elemen": {
        if (!g.bergerak && !lewatAmbang(g.cx, g.cy)) return;
        g.bergerak = true;
        if (!g.kotak) return;
        const r = hitungGeser(g.kotak, info.titik.x - g.awal.x, info.titik.y - g.awal.y, snap, g.kandidat, ambang());
        g.dx = r.dx;
        g.dy = r.dy;
        setVisual({ ...VISUAL_KOSONG, geser: { ids: g.idsGeser, dx: r.dx, dy: r.dy }, garisBantu: { x: r.gx, y: r.gy } });
        return;
      }
      case "kotak": {
        if (!g.bergerak && !lewatAmbang(g.cx, g.cy)) return;
        g.bergerak = true;
        g.akhir = info.titik;
        setVisual({ ...VISUAL_KOSONG, kotakSeleksi: kotakDari(g.awal, info.titik) });
        return;
      }
      case "ukuran": {
        const k = ubahUkuran(g.kotak, g.handle, snapTitik(info.titik, snap), snap ? 1 : 0.25);
        dispatch({ type: "aturKotak", id: g.id, kotak: k });
        setVisual({ ...VISUAL_KOSONG, ukuran: k });
        return;
      }
      case "titik": {
        const e = byId.get(g.id);
        if (e?.tipe !== "derek") return;
        const { a, b } = garisDerek(e);
        const p = snapTitik(info.titik, snap);
        dispatch({ type: "aturTitikDerek", id: g.id, titikAwal: g.ujung === "a" ? p : a, titikAkhir: g.ujung === "b" ? p : b });
        return;
      }
      case "gambar": {
        if (!g.bergerak && !lewatAmbang(g.cx, g.cy)) return;
        g.bergerak = true;
        let b = snapTitik(info.titik, snap);
        if (g.alat === "dinding" || (g.alat === "derek" && ev.shiftKey)) {
          // Dinding (dan derek + Shift) lurus mengikuti sumbu dominan.
          b = Math.abs(b.x - g.awal.x) >= Math.abs(b.y - g.awal.y) ? { x: b.x, y: g.awal.y } : { x: g.awal.x, y: b.y };
        }
        g.akhir = b;
        setVisual({ ...VISUAL_KOSONG, gambar: { alat: g.alat, a: g.awal, b, bergerak: true } });
        return;
      }
    }
  };

  const batalGestur = () => {
    const g = gestur.current;
    gestur.current = null;
    if (g && (g.jenis === "ukuran" || g.jenis === "titik")) dispatch({ type: "batalTransaksi" });
    setVisual(VISUAL_KOSONG);
  };

  const onPointerUp = (info: InfoPointerKanvas, batal: boolean) => {
    const g = gestur.current;
    if (!g) return;
    if (batal) {
      batalGestur();
      return;
    }
    gestur.current = null;
    setVisual(VISUAL_KOSONG);
    const ev = info.event;

    switch (g.jenis) {
      case "elemen": {
        if (g.bergerak) {
          if (g.dx !== 0 || g.dy !== 0) dispatch({ type: "pindah", ids: [...g.idsGeser], dx: g.dx, dy: g.dy });
          return;
        }
        if (!g.sudahTerpilih) return;
        const e = byId.get(g.id);
        if (e?.tipe === "bak" && g.kolomId && state.terpilih.length === 1) {
          dispatch({ type: "pilihKolom", bakId: e.id, kolomId: g.kolomId, rentang: g.shift, toggle: g.ctrl });
          setTab("kolom");
        } else if (g.shift) dispatch({ type: "togglePilih", id: g.id });
        else if (state.terpilih.length > 1) dispatch({ type: "pilih", ids: [g.id] });
        return;
      }
      case "kotak": {
        if (!g.bergerak) {
          if (!g.tambah) dispatch({ type: "pilih", ids: [] });
          return;
        }
        const k = kotakDari(g.awal, g.akhir);
        const ids = dok.elemen.filter((e) => bersinggungan(kotakElemen(e), k)).map((e) => e.id);
        dispatch({ type: "pilih", ids, tambah: g.tambah });
        return;
      }
      case "ukuran":
      case "titik":
        dispatch({ type: "akhiriTransaksi" });
        return;
      case "gambar": {
        const snap = !ev.altKey;
        let elemenBaru: DenahElemen;
        if (ALAT_GARIS.has(g.alat)) {
          const garis = g.bergerak && (g.akhir.x !== g.awal.x || g.akhir.y !== g.awal.y) ? { a: g.awal, b: g.akhir } : garisBawaan(g.alat, g.awal, snap);
          elemenBaru = buatElemen(g.alat, kotakDari(garis.a, garis.b), dok.elemen, garis);
        } else {
          const k = g.bergerak ? kotakDari(g.awal, g.akhir) : kotakBawaan(g.alat, g.awal, snap);
          if (k.w < 1 || k.h < 1) {
            const u = UKURAN_BAWAAN[g.alat];
            k.w = Math.max(k.w, Math.min(1, u.w));
            k.h = Math.max(k.h, Math.min(1, u.h));
          }
          elemenBaru = buatElemen(g.alat, k, dok.elemen);
        }
        dispatch({ type: "tambah", elemen: [elemenBaru] });
        setTab("properti");
        if (!ev.shiftKey) setAlat("pilih");
        return;
      }
    }
  };

  // ---------- Pintasan keyboard ----------
  const tanganiTombol = (ev: KeyboardEvent) => {
    if (ev.defaultPrevented || ev.repeat && !ev.key.startsWith("Arrow")) return;
    if (document.querySelector("[data-slot=dialog-content]")) return;
    const a = cocokkanPintasan(ev);
    if (!a) return;
    if (ketikDiInput(ev.target)) {
      if (a.jenis === "simpan") {
        ev.preventDefault();
        (ev.target as HTMLElement).blur();
        setTimeout(() => void simpanRef.current(), 0);
      }
      return;
    }
    ev.preventDefault();
    const ids = state.terpilih;
    switch (a.jenis) {
      case "alat":
        setAlat(a.alat);
        return;
      case "undo":
        if (!gestur.current) dispatch({ type: "undo" });
        return;
      case "redo":
        if (!gestur.current) dispatch({ type: "redo" });
        return;
      case "simpan":
        if (kotor && galat.length === 0) void simpan();
        return;
      case "hapus":
        if (ids.length) dispatch({ type: "hapus", ids });
        return;
      case "duplikat":
        if (ids.length) dispatch({ type: "duplikat", ids });
        return;
      case "salin":
        if (ids.length) {
          dispatch({ type: "salin", ids });
          toast(`${ids.length} elemen disalin`, { duration: 1200 });
        }
        return;
      case "potong":
        if (ids.length) dispatch({ type: "potong", ids });
        return;
      case "tempel":
        dispatch({ type: "tempel" });
        return;
      case "pilihSemua":
        dispatch({ type: "pilihSemua" });
        return;
      case "putar":
        if (ids.length) dispatch({ type: "putar", ids });
        return;
      case "kunci":
        if (ids.length) dispatch({ type: "kunci", ids, terkunci: !elemenTerpilih.every((e) => e.terkunci) });
        return;
      case "depan":
      case "belakang":
        if (ids.length) dispatch({ type: "urutan", ids, ke: a.jenis });
        return;
      case "geser":
        if (ids.length && !gestur.current) dispatch({ type: "pindah", ids, dx: a.dx, dy: a.dy });
        return;
      case "batal":
        if (gestur.current) batalGestur();
        else if (alat !== "pilih") setAlat("pilih");
        else if (state.kolomTerpilih.length && bakTerpilih) dispatch({ type: "aturKolomTerpilih", bakId: bakTerpilih.id, kolomIds: [] });
        else dispatch({ type: "pilih", ids: [] });
        return;
      case "pas":
        kanvasRef.current?.pasKeLayar();
        return;
      case "fokusSeleksi": {
        const k = kotakGabungan(elemenTerpilih);
        if (k) fokusKotak(k);
        return;
      }
      case "zoomMasuk":
        kanvasRef.current?.zoomMasuk();
        return;
      case "zoomKeluar":
        kanvasRef.current?.zoomKeluar();
        return;
      case "contekan":
        setContekan(true);
        return;
    }
  };
  const tombolRef = useRef(tanganiTombol);
  const simpanRef = useRef(simpan);
  useLayoutEffect(() => {
    tombolRef.current = tanganiTombol;
    simpanRef.current = simpan;
  });
  useEffect(() => {
    const f = (ev: KeyboardEvent) => tombolRef.current(ev);
    window.addEventListener("keydown", f);
    return () => window.removeEventListener("keydown", f);
  }, []);

  // ---------- Render ----------

  const kursor =
    alat === "geser"
      ? "cursor-grab"
      : alat !== "pilih"
        ? "cursor-crosshair"
        : visual.geser
          ? "cursor-move"
          : hoverId && !byId.get(hoverId)?.terkunci
            ? "cursor-move"
            : undefined;

  const pilihAlat = useCallback((a: Alat) => setAlat(a), []);
  const keKolom = useCallback(() => setTab("kolom"), []);
  const tutupServer = useCallback(() => setPenolakan(null), []);
  const onTampilan = useCallback((t: InfoTampilan["tampilan"], u: InfoTampilan["ukuran"]) => tampilanToko.set({ tampilan: t, ukuran: u }), [tampilanToko]);
  const pusatkan = useCallback((p: Titik) => kanvasRef.current?.pusatkanKe(p), []);

  const tombolSimpanNonaktif = menyimpan || !kotor || galat.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background text-foreground">
      {/* ---------- Bilah atas ---------- */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b px-2 sm:px-3">
        <Button variant="ghost" size="sm" onClick={keluar} title={kotor ? "Batal & kembali ke Produksi" : "Kembali ke Produksi"}>
          <ArrowLeft /> <span className="hidden sm:inline">{kotor ? "Batal" : "Kembali"}</span>
        </Button>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold">Denah Produksi</div>
          <div className="flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
            <span className="truncate">{namaPerusahaan}</span>
            <span>·</span>
            <span className="tabular-nums">{versi ? `versi ${versi}` : "belum disimpan"}</span>
            {kotor && (
              <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400">
                <span className="size-1.5 animate-pulse rounded-full bg-current" /> belum disimpan
              </span>
            )}
          </div>
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-0.5">
          <Button variant="ghost" size="icon-sm" title="Urungkan (Ctrl+Z)" aria-label="Urungkan" disabled={!bisaUndo(state)} onClick={() => dispatch({ type: "undo" })}>
            <Undo2 />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Ulangi (Ctrl+Y)" aria-label="Ulangi" disabled={!bisaRedo(state)} onClick={() => dispatch({ type: "redo" })}>
            <Redo2 />
          </Button>
        </div>
        <div className="mx-1 hidden h-5 w-px bg-border sm:block" />
        <div className="hidden items-center gap-0.5 sm:flex">
          <Button variant="ghost" size="icon-sm" title="Perkecil (−)" aria-label="Perkecil" onClick={() => kanvasRef.current?.zoomKeluar()}>
            <ZoomOut />
          </Button>
          <PersenZoom toko={tampilanToko} ukuranGrid={dok.kanvas.ukuranGrid} />
          <Button variant="ghost" size="icon-sm" title="Perbesar (+)" aria-label="Perbesar" onClick={() => kanvasRef.current?.zoomMasuk()}>
            <ZoomIn />
          </Button>
          <Button variant="ghost" size="sm" title="Pas ke layar (0)" onClick={() => kanvasRef.current?.pasKeLayar()}>
            <Maximize /> <span className="hidden lg:inline">Pas ke layar</span>
          </Button>
        </div>
        <Button variant="ghost" size="icon-sm" title="Pintasan keyboard (?)" aria-label="Pintasan keyboard" onClick={() => setContekan(true)}>
          <Keyboard />
        </Button>
        <Button variant="ghost" size="icon-sm" className="md:hidden" aria-label="Panel" onClick={() => setPanelTerbuka((v) => !v)}>
          <PanelRight />
        </Button>
        <Button
          size="sm"
          onClick={() => void simpan()}
          disabled={tombolSimpanNonaktif}
          title={galat.length > 0 ? `Perbaiki ${galat.length} masalah dulu` : !kotor ? "Tidak ada perubahan" : "Simpan (Ctrl+S)"}
        >
          <Save /> {menyimpan ? "Menyimpan…" : "Simpan"}
        </Button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        <PaletAlat alat={alat} onPilih={pilihAlat} />

        {/* ---------- Kanvas ---------- */}
        <div
          className="relative min-w-0 flex-1"
          onPointerLeave={() => {
            // Hantu alat & koordinat hilang saat kursor keluar kanvas.
            kursorToko.set(null);
            setHoverId(null);
          }}
        >
          <DenahKanvas
            ref={kanvasRef}
            dokumen={dok}
            mode="edit"
            className="absolute inset-0 rounded-none border-0"
            kontrolZoom={false}
            terpilihIds={terpilihSet}
            kolomTerpilihIds={kolomTerpilihSet}
            sorotIds={sorotIds}
            kolomSorotIds={kolomSorotIds}
            tumpukIds={tumpukIds}
            hoverId={visual.geser ? null : hoverId}
            geserSementara={visual.geser}
            kursor={kursor}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onTampilanBerubah={onTampilan}
            overlay={(ctx) => (
              <OverlayEdit
                elemenTerpilih={elemenTerpilih}
                visual={visual}
                alat={alat}
                kursorToko={kursorToko}
                unitPerPx={ctx.unitPerPx}
                kanvas={dok.kanvas}
              />
            )}
          >
            {penolakan?.jenis === "basi" && (
              <div className="absolute top-3 left-1/2 z-10 flex w-[min(560px,calc(100%-24px))] -translate-x-1/2 items-start gap-3 rounded-lg border border-destructive/50 bg-background/95 p-3 shadow-lg backdrop-blur">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1 text-sm">
                  <div className="font-medium">Denah sudah diubah orang lain</div>
                  <div className="text-xs text-muted-foreground">{penolakan.pesan} Perubahan Anda di builder ini belum tersimpan.</div>
                </div>
                <Button size="sm" onClick={() => setKonfirmasiMuatUlang(true)}>
                  <RefreshCw /> Muat ulang
                </Button>
                <button type="button" aria-label="Tutup" className="text-muted-foreground hover:text-foreground" onClick={() => setPenolakan(null)}>
                  <X className="size-4" />
                </button>
              </div>
            )}
            {dok.elemen.length === 0 && alat === "pilih" && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="rounded-xl border border-dashed bg-background/80 px-5 py-4 text-center shadow-sm backdrop-blur">
                  <div className="text-sm font-medium">Denah masih kosong</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Pilih alat <b>Bak</b> (B) di kiri, lalu klik atau tarik di kanvas. Tekan <kbd className="rounded border px-1 font-mono">?</kbd> untuk pintasan.
                  </div>
                </div>
              </div>
            )}
            <div className="pointer-events-none absolute right-3 bottom-3 hidden sm:block">
              <Minimap dokumen={dok} terpilih={terpilihSet} toko={tampilanToko} onPusatkan={pusatkan} />
            </div>
          </DenahKanvas>
        </div>

        {/* ---------- Panel kanan ---------- */}
        <aside
          className={cn(
            "absolute inset-y-0 right-0 z-20 flex w-80 max-w-[90vw] flex-col border-l bg-background shadow-xl transition-transform md:static md:translate-x-0 md:shadow-none",
            panelTerbuka ? "translate-x-0" : "translate-x-full"
          )}
        >
          <div className="flex shrink-0 gap-1 border-b p-1.5" role="tablist">
            {(
              [
                ["properti", "Properti"],
                ["kolom", `Kolom${state.kolomTerpilih.length ? ` (${state.kolomTerpilih.length})` : ""}`],
                ["validasi", "Validasi"],
              ] as [Tab, string][]
            ).map(([t, label]) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={tab === t}
                onClick={() => setTab(t)}
                className={cn(
                  "relative flex-1 rounded-md px-2 py-1 text-xs font-medium transition-colors",
                  tab === t ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
                {t === "validasi" && (galat.length > 0 || (galatServer?.length ?? 0) > 0) && (
                  <span className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] text-white tabular-nums">
                    {galat.length + (galatServer?.length ?? 0)}
                  </span>
                )}
                {t === "validasi" && galat.length === 0 && !galatServer?.length && <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span>}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "properti" && <PanelProperti dok={dok} terpilih={elemenTerpilih} dispatch={dispatch} onKeKolom={keKolom} />}
            {tab === "kolom" && <PanelKolom bak={bakTerpilih} kolomTerpilih={state.kolomTerpilih} kolomSorotIds={kolomSorotIds} dispatch={dispatch} />}
            {tab === "validasi" && <PanelValidasi galat={galat} galatServer={galatServer} elemen={dok.elemen} onFokus={fokusGalat} onTutupServer={tutupServer} />}
          </div>
        </aside>
      </div>

      {/* ---------- Bilah status ---------- */}
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground tabular-nums">
        <StatusKursor toko={kursorToko} />
        <span>
          Alat: <b className="font-medium text-foreground">{alat === "pilih" ? "Pilih" : alat === "geser" ? "Geser kanvas" : NAMA_TIPE[alat]}</b>
        </span>
        <span>
          Terpilih: <b className="font-medium text-foreground">{state.terpilih.length}</b>
          {state.kolomTerpilih.length > 0 && ` · ${state.kolomTerpilih.length} kolom`}
        </span>
        <span className="hidden sm:inline">{dok.elemen.length} elemen</span>
        <span className="hidden md:inline">Riwayat {state.lalu.length}</span>
        <span className="flex-1" />
        <span className="hidden lg:inline">Alt = tanpa snap · Spasi = geser kanvas · ? = pintasan</span>
      </footer>

      {/* ---------- Dialog ---------- */}
      <Dialog open={contekan} onOpenChange={setContekan}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Pintasan keyboard</DialogTitle>
            <DialogDescription>Builder denah bisa dikendalikan penuh dari keyboard.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {DAFTAR_PINTASAN.map((g) => (
              <div key={g.grup}>
                <div className="mb-1.5 text-xs font-semibold text-muted-foreground uppercase">{g.grup}</div>
                <dl className="flex flex-col gap-1">
                  {g.isi.map(([k, d]) => (
                    <div key={k} className="flex items-baseline justify-between gap-2 text-xs">
                      <dt className="text-muted-foreground">{d}</dt>
                      <dd>
                        <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] whitespace-nowrap">{k}</kbd>
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={konfirmasiKeluar} onOpenChange={setKonfirmasiKeluar}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Buang perubahan?</DialogTitle>
            <DialogDescription>Perubahan denah belum disimpan dan akan hilang bila Anda kembali ke halaman Produksi.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasiKeluar(false)}>
              Tetap di builder
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                lewatiPeringatan.current = true;
                setKonfirmasiKeluar(false);
                router.push(hrefKembali);
              }}
            >
              Buang & kembali
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={konfirmasiMuatUlang} onOpenChange={setKonfirmasiMuatUlang}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Muat ulang denah terbaru?</DialogTitle>
            <DialogDescription>
              Denah versi terbaru dari server akan dibuka. Perubahan Anda yang belum tersimpan di builder ini akan hilang.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasiMuatUlang(false)}>
              Batal
            </Button>
            <Button
              onClick={() => {
                lewatiPeringatan.current = true;
                window.location.reload();
              }}
            >
              <RefreshCw /> Muat ulang
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Komponen kecil berlangganan toko ----------

function PersenZoom({ toko, ukuranGrid }: { toko: Toko<InfoTampilan | null>; ukuranGrid: number }) {
  const info = useToko(toko);
  const persen = info ? Math.round((info.tampilan.skala / ukuranGrid) * 100) : 100;
  return <span className="w-12 text-center text-xs text-muted-foreground tabular-nums">{persen}%</span>;
}

function StatusKursor({ toko }: { toko: Toko<Titik | null> }) {
  const t = useToko(toko);
  return (
    <span className="w-24">
      {t ? (
        <>
          X <b className="font-medium text-foreground">{Math.floor(t.x)}</b> · Y <b className="font-medium text-foreground">{Math.floor(t.y)}</b>
        </>
      ) : (
        "X — · Y —"
      )}
    </span>
  );
}

// ---------- Overlay edit (SVG, unit grid) ----------

const OverlayEdit = memo(function OverlayEdit({
  elemenTerpilih,
  visual,
  alat,
  kursorToko,
  unitPerPx,
  kanvas,
}: {
  elemenTerpilih: DenahElemen[];
  visual: Visual;
  alat: Alat;
  kursorToko: Toko<Titik | null>;
  unitPerPx: number;
  kanvas: DenahDokumen["kanvas"];
}) {
  const px = unitPerPx;
  const fs = 11 * px;
  const sedangGeser = !!visual.geser;
  const satu = elemenTerpilih.length === 1 ? elemenTerpilih[0] : null;
  const gabung = elemenTerpilih.length > 1 ? kotakGabungan(elemenTerpilih) : null;

  return (
    <g>
      {/* Garis bantu perataan */}
      {visual.garisBantu.x.map((x) => (
        <line key={`gx${x}`} x1={x} y1={-5} x2={x} y2={kanvas.tinggi + 5} className="stroke-pink-500" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />
      ))}
      {visual.garisBantu.y.map((y) => (
        <line key={`gy${y}`} x1={-5} y1={y} x2={kanvas.lebar + 5} y2={y} className="stroke-pink-500" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeDasharray="4 3" pointerEvents="none" />
      ))}

      {/* Kotak gabungan multi-seleksi */}
      {gabung && (
        <rect
          x={gabung.x - 0.5 + (visual.geser?.dx ?? 0)}
          y={gabung.y - 0.5 + (visual.geser?.dy ?? 0)}
          width={gabung.w + 1}
          height={gabung.h + 1}
          fill="none"
          className="stroke-primary/60"
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {/* Handle elemen tunggal */}
      {satu && !satu.terkunci && !sedangGeser && <HandleElemen e={satu} px={px} />}

      {/* Label ukuran saat drag */}
      {visual.geser && satu && <LabelPosisi e={satu} dx={visual.geser.dx} dy={visual.geser.dy} fs={fs} />}
      {visual.ukuran && (
        <Pil x={visual.ukuran.x + visual.ukuran.w / 2} y={visual.ukuran.y + visual.ukuran.h + fs * 1.4} fs={fs}>
          {`${bulat2(visual.ukuran.w)} × ${bulat2(visual.ukuran.h)}`}
        </Pil>
      )}

      {/* Kotak seleksi */}
      {visual.kotakSeleksi && (
        <rect
          x={visual.kotakSeleksi.x}
          y={visual.kotakSeleksi.y}
          width={visual.kotakSeleksi.w}
          height={visual.kotakSeleksi.h}
          className="fill-primary/10 stroke-primary"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {/* Elemen yang sedang digambar */}
      {visual.gambar && <PratinjauGambar g={visual.gambar} fs={fs} />}

      {/* Hantu alat di bawah kursor */}
      {alat !== "pilih" && alat !== "geser" && !visual.gambar && <HantuAlat alat={alat} toko={kursorToko} fs={fs} />}
    </g>
  );
});

function Pil({ x, y, fs, children }: { x: number; y: number; fs: number; children: string }) {
  const w = children.length * fs * 0.62 + fs;
  return (
    <g pointerEvents="none">
      <rect x={x - w / 2} y={y - fs * 0.85} width={w} height={fs * 1.7} rx={fs * 0.5} className="fill-foreground/85" />
      <text x={x} y={y} fontSize={fs} textAnchor="middle" dominantBaseline="central" className="fill-background tabular-nums">
        {children}
      </text>
    </g>
  );
}

function LabelPosisi({ e, dx, dy, fs }: { e: DenahElemen; dx: number; dy: number; fs: number }) {
  const k = kotakElemen(e);
  return (
    <Pil x={k.x + dx + k.w / 2} y={k.y + dy + k.h + fs * 1.4} fs={fs}>
      {`${bulat2(k.x + dx)}, ${bulat2(k.y + dy)}`}
    </Pil>
  );
}

function HandleElemen({ e, px }: { e: DenahElemen; px: number }) {
  const s = 9 * px;
  if (e.tipe === "derek") {
    const { a, b } = garisDerek(e as DerekElemen);
    return (
      <g>
        {(
          [
            ["a", a],
            ["b", b],
          ] as const
        ).map(([u, p]) => (
          <circle
            key={u}
            data-handle={u}
            cx={p.x}
            cy={p.y}
            r={s * 0.75}
            className="fill-background stroke-primary"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            style={{ cursor: "crosshair" }}
          />
        ))}
      </g>
    );
  }
  const k = kotakElemen(e);
  const posisi: Record<Handle, Titik> = {
    nw: { x: k.x, y: k.y },
    n: { x: k.x + k.w / 2, y: k.y },
    ne: { x: k.x + k.w, y: k.y },
    e: { x: k.x + k.w, y: k.y + k.h / 2 },
    se: { x: k.x + k.w, y: k.y + k.h },
    s: { x: k.x + k.w / 2, y: k.y + k.h },
    sw: { x: k.x, y: k.y + k.h },
    w: { x: k.x, y: k.y + k.h / 2 },
  };
  return (
    <g>
      {HANDLE.map((h) => (
        <rect
          key={h}
          data-handle={h}
          x={posisi[h].x - s / 2}
          y={posisi[h].y - s / 2}
          width={s}
          height={s}
          rx={s * 0.2}
          className="fill-background stroke-primary"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
          style={{ cursor: KURSOR_HANDLE[h] }}
        />
      ))}
    </g>
  );
}

const KELAS_HANTU = "fill-primary/15 stroke-primary";

/** Posisi relatif (0..1) garis kolom pada hantu bak. */
function garisKolomHantu(lebar: number): number[] {
  const n = Math.min(36, Math.floor(lebar));
  return Array.from({ length: n }, (_, i) => (i + 1) / (n + 1));
}

function BentukHantu({ alat, kotak, garis, fs }: { alat: TipeElemen; kotak?: Kotak; garis?: { a: Titik; b: Titik }; fs: number }) {
  if (garis) {
    const panjang = Math.hypot(garis.b.x - garis.a.x, garis.b.y - garis.a.y);
    return (
      <g pointerEvents="none">
        <line
          x1={garis.a.x}
          y1={garis.a.y}
          x2={garis.b.x}
          y2={garis.b.y}
          className={alat === "derek" ? "stroke-orange-500/70" : "stroke-slate-500/70"}
          strokeWidth={alat === "derek" ? 4 : 6}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
        <circle cx={garis.a.x} cy={garis.a.y} r={fs * 0.35} className="fill-primary" />
        <circle cx={garis.b.x} cy={garis.b.y} r={fs * 0.35} className="fill-primary" />
        <Pil x={(garis.a.x + garis.b.x) / 2} y={(garis.a.y + garis.b.y) / 2 - fs * 1.4} fs={fs}>
          {`${bulat2(panjang)} grid`}
        </Pil>
      </g>
    );
  }
  if (!kotak) return null;
  return (
    <g pointerEvents="none">
      <rect x={kotak.x} y={kotak.y} width={kotak.w} height={kotak.h} rx={0.2} className={KELAS_HANTU} strokeWidth={1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
      {alat === "bak" &&
        kotak.w >= 2 &&
        garisKolomHantu(kotak.w).map((f, i) => (
          <line
            key={i}
            x1={kotak.x + f * kotak.w}
            y1={kotak.y + 0.3}
            x2={kotak.x + f * kotak.w}
            y2={kotak.y + kotak.h - 0.3}
            className="stroke-primary/30"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      <Pil x={kotak.x + kotak.w / 2} y={kotak.y + kotak.h + fs * 1.4} fs={fs}>
        {`${NAMA_TIPE[alat]} ${bulat2(kotak.w)} × ${bulat2(kotak.h)}`}
      </Pil>
    </g>
  );
}

function PratinjauGambar({ g, fs }: { g: NonNullable<Visual["gambar"]>; fs: number }) {
  if (ALAT_GARIS.has(g.alat)) {
    const garis = g.bergerak ? { a: g.a, b: g.b } : garisBawaan(g.alat, g.a, true);
    return <BentukHantu alat={g.alat} garis={garis} fs={fs} />;
  }
  const k = g.bergerak ? kotakDari(g.a, g.b) : kotakBawaan(g.alat, g.a, true);
  return <BentukHantu alat={g.alat} kotak={k} fs={fs} />;
}

function HantuAlat({ alat, toko, fs }: { alat: TipeElemen; toko: Toko<Titik | null>; fs: number }) {
  const c = useToko(toko);
  if (!c) return null;
  if (ALAT_GARIS.has(alat)) return <BentukHantu alat={alat} garis={garisBawaan(alat, c, true)} fs={fs} />;
  return <BentukHantu alat={alat} kotak={kotakBawaan(alat, c, true)} fs={fs} />;
}
