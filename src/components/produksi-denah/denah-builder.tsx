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
  DIAMETER_JALUR_BAWAAN,
  FLUIDA_BAWAAN,
  denahKosong,
  kotakElemen,
  lapisanElemen,
  validasiDenah,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type Fluida,
  type GalatDenah,
  type HasilSimpanDenah,
  type KodeProduksi,
  type Lapisan,
  type TipeElemen,
  type Titik,
  type Titik3D,
} from "@/lib/produksi-denah";
import { simpanDenahAction } from "@/app/produksi-denah-actions";
import { DenahKanvas, type DenahKanvasHandle, type GeserSementara, type InfoPointerKanvas } from "@/components/produksi-denah/denah-kanvas";
import {
  ELEVASI_KERJA_BAWAAN,
  UKURAN_BAWAAN,
  NAMA_TIPE,
  bakBertumpuk,
  bisaRedo,
  bisaUndo,
  buatElemen,
  buatJalur,
  builderReducer,
  garisDerek,
  kotakGabungan,
  kotor as dokKotor,
  snapTitik,
  stateAwal,
  panjangJalur,
  tempelUjungJalur,
  type Kotak,
  type OpsiJalur,
} from "@/components/produksi-denah/builder-state";
import { warnaJalur } from "@/components/produksi-denah/warna";
import { PILIHAN_FLUIDA, PILIHAN_SISTEM_KABEL } from "@/components/produksi-denah/panel-properti";
import { formatMeter, formatUkur } from "@/components/produksi-denah/format";
import { idTerlihat, lapisanTersembunyiDari, useLapisanTampil } from "@/components/produksi-denah/lapisan";
import { MenuLapisan } from "@/components/produksi-denah/menu-lapisan";
import { cocokkanPintasan, DAFTAR_PINTASAN, type Alat } from "@/components/produksi-denah/pintasan-keyboard";
import { PaletAlat } from "@/components/produksi-denah/palet-alat";
import { PanelProperti } from "@/components/produksi-denah/panel-properti";
import { PanelKolom } from "@/components/produksi-denah/panel-kolom";
import { PanelValidasi } from "@/components/produksi-denah/panel-validasi";
import { periksaTeknik } from "@/lib/produksi-denah-teknik";
import { Minimap, type InfoTampilan } from "@/components/produksi-denah/minimap";
import { InputAngka, Pilihan, Segmen, buatToko, useToko, type Toko } from "@/components/produksi-denah/bidang";

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
  | { jenis: "gambar"; alat: TipeElemen; cx: number; cy: number; awal: Titik; akhir: Titik; bergerak: boolean }
  | { jenis: "ukur"; awal: Titik };

/** Garis alat Ukur — sementara, TIDAK pernah masuk dokumen. */
type GarisUkur = { a: Titik; b: Titik };

/**
 * Jalur yang sedang digambar (alat Jalur) — belum masuk dokumen sampai selesai.
 * ujungIds[i] = elemen tempat titik i menempel; hanya titik pertama (dariId)
 * dan terakhir (keId) yang dipakai saat selesai.
 */
type JalurDigambar = { titik: Titik3D[]; ujungIds: (string | undefined)[] };

/** Radius tempel ke ujung jalur lain (piksel layar), spec §6. */
const RADIUS_TEMPEL_PX = 8;
/** Dua klik dalam waktu & jarak ini = dobel klik (selesai). */
const DOBEL_KLIK_MS = 350;
const DOBEL_KLIK_PX = 6;

const OPSI_JALUR_BAWAAN: OpsiJalur = { jenis: "pipa", fluida: FLUIDA_BAWAAN, diameterMm: DIAMETER_JALUR_BAWAAN.pipa };

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
/** Ukuran minimum elemen (meter), spec §1. */
const UKURAN_MIN = 0.05;

/** Kotak elemen saat alat diklik tanpa drag: ukuran bawaan, berpusat di kursor. */
function kotakBawaan(alat: TipeElemen, c: Titik, snap: boolean, langkah: number): Kotak {
  const u = UKURAN_BAWAAN[alat];
  const p = snapTitik({ x: c.x - u.w / 2, y: c.y - u.h / 2 }, snap, langkah);
  return { x: p.x, y: p.y, w: u.w, h: u.h };
}

function garisBawaan(alat: TipeElemen, c: Titik, snap: boolean, langkah: number): { a: Titik; b: Titik } {
  const u = UKURAN_BAWAAN[alat];
  const a = snapTitik({ x: c.x - u.w / 2, y: c.y }, snap, langkah);
  return { a, b: { x: a.x + u.w, y: a.y } };
}

const ALAT_GARIS = new Set<TipeElemen>(["derek", "dinding"]);

/** Snap pergeseran: garis bantu (tepi/tengah elemen lain) bila dekat, selain itu kelipatan langkah snap. */
function hitungGeser(kotak: Kotak, rawDx: number, rawDy: number, snap: boolean, kandidat: { x: number[]; y: number[] }, ambang: number, langkah: number) {
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
    const p = snapTitik({ x: pos + raw, y: 0 }, true, langkah).x;
    return { delta: p - pos, garis: [] as number[] };
  };
  const sx = satuSumbu(kotak.x, kotak.w, rawDx, kandidat.x);
  const sy = satuSumbu(kotak.y, kotak.h, rawDy, kandidat.y);
  return { dx: sx.delta, dy: sy.delta, gx: sx.garis, gy: sy.garis };
}

function ubahUkuran(k: Kotak, h: Handle, p: Titik, min: number): Kotak {
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
  const [alat, setAlatMentah] = useState<Alat>("pilih");
  const [ukur, setUkur] = useState<GarisUkur | null>(null);
  const [jalurDigambar, setJalurDigambar] = useState<JalurDigambar | null>(null);
  const [opsiJalur, setOpsiJalur] = useState<OpsiJalur>(OPSI_JALUR_BAWAAN);
  const klikJalurTerakhir = useRef<{ t: number; cx: number; cy: number } | null>(null);
  // Hasil ukur & jalur setengah jadi hilang setiap kali alat berganti.
  const setAlat = useCallback((a: Alat) => {
    setAlatMentah(a);
    setUkur(null);
    setJalurDigambar(null);
  }, []);
  const [lapisanTampil, aturLapisan] = useLapisanTampil();
  const [tab, setTab] = useState<Tab>("properti");
  const [visual, setVisual] = useState<Visual>(VISUAL_KOSONG);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [menyimpan, setMenyimpan] = useState(false);
  const [penolakan, setPenolakan] = useState<Penolakan>(null);
  const [contekan, setContekan] = useState(false);
  const [konfirmasiKeluar, setKonfirmasiKeluar] = useState(false);
  const [konfirmasiMuatUlang, setKonfirmasiMuatUlang] = useState(false);
  const [panelTerbuka, setPanelTerbuka] = useState(false);
  // Elevasi kerja (z bawaan titik alat Jalur) — preferensi builder, TIDAK disimpan di dokumen.
  const [elevasiKerja, setElevasiKerja] = useState(ELEVASI_KERJA_BAWAAN);
  const [kursorToko] = useState(() => buatToko<Titik | null>(null));
  const [tampilanToko] = useState(() => buatToko<InfoTampilan | null>(null));
  const kanvasRef = useRef<DenahKanvasHandle>(null);
  const gestur = useRef<Gestur | null>(null);
  const lewatiPeringatan = useRef(false);

  const { dok } = state;
  const langkahSnap = dok.kanvas.langkahSnapM;
  const kotor = dokKotor(state);
  // Seleksi EFEKTIF = hanya elemen di lapisan yang tampil. state.terpilih bisa
  // memuat elemen tersembunyi (undo/redo, lapisan disembunyikan dari tab lain);
  // elemen itu tidak pernah dikenai aksi, handle, atau label.
  const terpilih = useMemo(() => idTerlihat(state.terpilih, dok.elemen, lapisanTampil), [state.terpilih, dok.elemen, lapisanTampil]);
  const terpilihSet = useMemo(() => new Set(terpilih), [terpilih]);
  const kolomTerpilihSet = useMemo(() => new Set(state.kolomTerpilih), [state.kolomTerpilih]);
  const elemenTerpilih = useMemo(() => dok.elemen.filter((e) => terpilihSet.has(e.id)), [dok.elemen, terpilihSet]);
  const byId = useMemo(() => new Map(dok.elemen.map((e) => [e.id, e])), [dok.elemen]);
  // Elemen di lapisan tersembunyi tidak digambar dan tidak bisa dipilih.
  const tampilDiLapisan = useCallback((e: DenahElemen) => lapisanTampil.has(lapisanElemen(e)), [lapisanTampil]);
  const dokMinimap = useMemo(() => ({ ...dok, elemen: dok.elemen.filter(tampilDiLapisan) }), [dok, tampilDiLapisan]);
  /** Elemen yang baru dibuat/ditempel harus terlihat: tampilkan lapisannya bila tersembunyi. */
  const tampilkanLapisanUntuk = (elemen: readonly DenahElemen[]) => {
    for (const l of lapisanTersembunyiDari(elemen, lapisanTampil)) aturLapisan(l, true);
  };
  const bakTerpilih = elemenTerpilih.length === 1 && elemenTerpilih[0].tipe === "bak" ? (elemenTerpilih[0] as BakElemen) : null;

  // Validasi langsung (ditunda agar drag ubah ukuran tetap halus).
  const dokTunda = useDeferredValue(dok);
  const galat = useMemo(() => validasiDenah(dokTunda), [dokTunda]);
  // Peringatan teknik: hanya informasi, TIDAK pernah memblokir Simpan.
  const peringatan = useMemo(() => periksaTeknik(dokTunda), [dokTunda]);
  const galatServer = penolakan?.jenis === "kolom" ? penolakan.galat : null;
  const sorotIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of galat) if (g.elemenId) s.add(g.elemenId);
    for (const g of galatServer ?? []) if (g.elemenId) s.add(g.elemenId);
    return s;
  }, [galat, galatServer]);
  // Sorotan amber di 2D untuk elemen yang terkena peringatan teknik (spec §5).
  const peringatanIds = useMemo(() => {
    const s = new Set<string>();
    for (const g of peringatan) {
      if (g.elemenId) s.add(g.elemenId);
      for (const id of g.elemenTerkaitIds ?? []) s.add(id);
    }
    return s;
  }, [peringatan]);
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
      // Elemen di lapisan tersembunyi: tampilkan lapisannya dulu agar bisa disorot.
      if (!tampilDiLapisan(e)) aturLapisan(lapisanElemen(e), true);
      if (g.kolomId && e.tipe === "bak" && e.kolom.some((k) => k.id === g.kolomId)) {
        dispatch({ type: "aturKolomTerpilih", bakId: e.id, kolomIds: [g.kolomId] });
      } else dispatch({ type: "pilih", ids: [e.id] });
      fokusKotak(kotakElemen(e));
    },
    [byId, fokusKotak, tampilDiLapisan, aturLapisan]
  );

  // ---------- Gestur kanvas ----------

  const ambang = () => {
    const t = kanvasRef.current?.tampilan();
    return t ? AMBANG_BANTU_PX / t.skala : 0.15;
  };

  const kandidatBantu = (abaikan: ReadonlySet<string>) => {
    const x = [0, dok.kanvas.lebar / 2, dok.kanvas.lebar];
    const y = [0, dok.kanvas.tinggi / 2, dok.kanvas.tinggi];
    for (const e of dok.elemen) {
      if (abaikan.has(e.id) || !tampilDiLapisan(e)) continue;
      const k = kotakElemen(e);
      x.push(k.x, k.x + k.w / 2, k.x + k.w);
      y.push(k.y, k.y + k.h / 2, k.y + k.h);
    }
    return { x, y };
  };

  // ---------- Alat Jalur ----------

  /**
   * Titik jalur dari posisi kursor: menempel ke ujung jalur lain (radius 8 px)
   * atau ke tepi elemen di bawah kursor; selain itu snap grid. z = elevasi
   * kerja (atau z ujung jalur yang ditempeli). Alt = tanpa snap & tempel.
   */
  const titikJalur = (p: Titik, elemenId: string | null, snap: boolean): { t: Titik3D; ujungId?: string } => {
    if (snap) {
      const t = kanvasRef.current?.tampilan();
      const radius = t ? RADIUS_TEMPEL_PX / t.skala : 0.4;
      const id = elemenId && byId.has(elemenId) && tampilDiLapisan(byId.get(elemenId)!) ? elemenId : null;
      const tempel = tempelUjungJalur(p, dok.elemen.filter(tampilDiLapisan), radius, id);
      if (tempel) return { t: { x: tempel.x, y: tempel.y, z: tempel.z ?? elevasiKerja }, ujungId: tempel.elemenId };
    }
    const s = snapTitik(p, snap, langkahSnap);
    return { t: { x: s.x, y: s.y, z: elevasiKerja } };
  };

  /** Selesaikan jalur (≥ 2 titik) → elemen baru; kurang dari 2 titik = tidak ada yang dibuat. */
  const selesaiJalur = (jd: JalurDigambar | null = jalurDigambar) => {
    setJalurDigambar(null);
    klikJalurTerakhir.current = null;
    if (!jd || jd.titik.length < 2) {
      if (jd && jd.titik.length > 0) toast("Jalur butuh minimal 2 titik.", { duration: 1500 });
      return;
    }
    const baru = buatJalur(jd.titik, opsiJalur, dok.elemen, jd.ujungIds[0], jd.ujungIds[jd.ujungIds.length - 1]);
    tampilkanLapisanUntuk([baru]);
    dispatch({ type: "tambah", elemen: [baru] });
    setTab("properti");
    setAlat("pilih");
  };

  const klikJalur = (info: InfoPointerKanvas) => {
    const ev = info.event;
    const lalu = klikJalurTerakhir.current;
    const dobel = !!lalu && ev.timeStamp - lalu.t <= DOBEL_KLIK_MS && Math.hypot(ev.clientX - lalu.cx, ev.clientY - lalu.cy) <= DOBEL_KLIK_PX;
    klikJalurTerakhir.current = { t: ev.timeStamp, cx: ev.clientX, cy: ev.clientY };
    // Dobel klik = selesai (klik pertama sudah menambah titiknya).
    if (dobel && jalurDigambar) {
      selesaiJalur();
      return;
    }
    const { t, ujungId } = titikJalur(info.titik, info.elemenId, !ev.altKey);
    const jd = jalurDigambar ?? { titik: [], ujungIds: [] };
    const akhir = jd.titik[jd.titik.length - 1];
    if (akhir && akhir.x === t.x && akhir.y === t.y && akhir.z === t.z) return; // titik kembar
    setJalurDigambar({ titik: [...jd.titik, t], ujungIds: [...jd.ujungIds, ujungId] });
  };

  const onPointerDown = (info: InfoPointerKanvas): boolean => {
    const ev = info.event;
    if (alat === "geser") return false;
    const snap = !ev.altKey;
    setHoverId(null);

    if (alat === "ukur") {
      const a = snapTitik(info.titik, snap, langkahSnap);
      gestur.current = { jenis: "ukur", awal: a };
      setUkur({ a, b: a });
      return true;
    }

    if (alat === "jalur") {
      klikJalur(info);
      return true;
    }

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
      const a = snapTitik(info.titik, snap, langkahSnap);
      gestur.current = { jenis: "gambar", alat, cx: ev.clientX, cy: ev.clientY, awal: a, akhir: a, bergerak: false };
      setVisual({ ...VISUAL_KOSONG, gambar: { alat, a, b: a, bergerak: false } });
      return true;
    }

    if (info.elemenId && byId.has(info.elemenId)) {
      const id = info.elemenId;
      const sudah = terpilihSet.has(id);
      const shift = ev.shiftKey;
      let ids: string[];
      if (sudah) ids = [...terpilih];
      else if (shift) {
        ids = [...terpilih, id];
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
        const r = hitungGeser(g.kotak, info.titik.x - g.awal.x, info.titik.y - g.awal.y, snap, g.kandidat, ambang(), langkahSnap);
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
        // Minimum saat resize = satu langkah snap (tanpa snap: 1 cm).
        const k = ubahUkuran(g.kotak, g.handle, snapTitik(info.titik, snap, langkahSnap), snap ? langkahSnap : 0.01);
        dispatch({ type: "aturKotak", id: g.id, kotak: k });
        setVisual({ ...VISUAL_KOSONG, ukuran: k });
        return;
      }
      case "titik": {
        const e = byId.get(g.id);
        if (e?.tipe !== "derek") return;
        const { a, b } = garisDerek(e);
        const p = snapTitik(info.titik, snap, langkahSnap);
        dispatch({ type: "aturTitikDerek", id: g.id, titikAwal: g.ujung === "a" ? p : a, titikAkhir: g.ujung === "b" ? p : b });
        return;
      }
      case "ukur":
        setUkur({ a: g.awal, b: snapTitik(info.titik, snap, langkahSnap) });
        return;
      case "gambar": {
        if (!g.bergerak && !lewatAmbang(g.cx, g.cy)) return;
        g.bergerak = true;
        let b = snapTitik(info.titik, snap, langkahSnap);
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
    if (g?.jenis === "ukur") setUkur(null);
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
        if (e?.tipe === "bak" && g.kolomId && terpilih.length === 1) {
          dispatch({ type: "pilihKolom", bakId: e.id, kolomId: g.kolomId, rentang: g.shift, toggle: g.ctrl });
          setTab("kolom");
        } else if (g.shift) dispatch({ type: "togglePilih", id: g.id });
        else if (terpilih.length > 1) dispatch({ type: "pilih", ids: [g.id] });
        return;
      }
      case "kotak": {
        if (!g.bergerak) {
          if (!g.tambah) dispatch({ type: "pilih", ids: [] });
          return;
        }
        const k = kotakDari(g.awal, g.akhir);
        const ids = dok.elemen.filter((e) => tampilDiLapisan(e) && bersinggungan(kotakElemen(e), k)).map((e) => e.id);
        dispatch({ type: "pilih", ids, tambah: g.tambah });
        return;
      }
      case "ukuran":
      case "titik":
        dispatch({ type: "akhiriTransaksi" });
        return;
      case "ukur":
        // Hasil tetap tampil sampai alat berganti / Esc; klik tanpa tarik = hapus.
        setUkur((u) => (u && (u.a.x !== u.b.x || u.a.y !== u.b.y) ? u : null));
        return;
      case "gambar": {
        const snap = !ev.altKey;
        let elemenBaru: DenahElemen;
        if (ALAT_GARIS.has(g.alat)) {
          const garis = g.bergerak && (g.akhir.x !== g.awal.x || g.akhir.y !== g.awal.y) ? { a: g.awal, b: g.akhir } : garisBawaan(g.alat, g.awal, snap, langkahSnap);
          elemenBaru = buatElemen(g.alat, kotakDari(garis.a, garis.b), dok.elemen, garis);
        } else {
          const k = g.bergerak ? kotakDari(g.awal, g.akhir) : kotakBawaan(g.alat, g.awal, snap, langkahSnap);
          // Tarikan yang terlalu tipis (di bawah ukuran minimum 0,05 m) memakai ukuran bawaan sisi itu (maks. 1 m).
          const u = UKURAN_BAWAAN[g.alat];
          if (k.w < UKURAN_MIN) k.w = Math.min(1, u.w);
          if (k.h < UKURAN_MIN) k.h = Math.min(1, u.h);
          elemenBaru = buatElemen(g.alat, k, dok.elemen);
        }
        tampilkanLapisanUntuk([elemenBaru]);
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
    // Alat Jalur sedang menggambar: Enter = selesai, Backspace = hapus titik terakhir, Esc = batal.
    if (alat === "jalur" && jalurDigambar && !ketikDiInput(ev.target) && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        selesaiJalur();
        return;
      }
      if (ev.key === "Backspace" || ev.key === "Delete") {
        ev.preventDefault();
        const n = jalurDigambar.titik.length - 1;
        setJalurDigambar(n > 0 ? { titik: jalurDigambar.titik.slice(0, n), ujungIds: jalurDigambar.ujungIds.slice(0, n) } : null);
        return;
      }
      if (ev.key === "Escape") {
        ev.preventDefault();
        setJalurDigambar(null);
        klikJalurTerakhir.current = null;
        return;
      }
    }
    const a = cocokkanPintasan(ev, langkahSnap);
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
    const ids = [...terpilih]; // hanya elemen di lapisan tampil
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
        tampilkanLapisanUntuk(state.papanKlip);
        dispatch({ type: "tempel" });
        return;
      case "pilihSemua":
        // Hanya elemen di lapisan yang tampil.
        dispatch({ type: "pilih", ids: dok.elemen.filter(tampilDiLapisan).map((e) => e.id) });
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
        else if (ukur) setUkur(null);
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

  const pilihAlat = setAlat;
  const ubahLapisan = (l: Lapisan, tampil: boolean) => {
    aturLapisan(l, tampil);
    if (tampil) return;
    // Elemen yang disembunyikan keluar dari seleksi (tidak bisa diedit tanpa terlihat).
    const sisa = state.terpilih.filter((id) => {
      const e = byId.get(id);
      return e && lapisanElemen(e) !== l;
    });
    if (sisa.length !== state.terpilih.length) dispatch({ type: "pilih", ids: sisa });
    setHoverId(null);
  };
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
        <MenuLapisan tampil={lapisanTampil} onUbah={ubahLapisan} elemen={dok.elemen} />
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
            peringatanIds={peringatanIds}
            kolomSorotIds={kolomSorotIds}
            tumpukIds={tumpukIds}
            hoverId={visual.geser ? null : hoverId}
            geserSementara={visual.geser}
            kursor={kursor}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onTampilanBerubah={onTampilan}
            lapisanTampil={lapisanTampil}
            overlay={(ctx) => (
              <OverlayEdit
                elemenTerpilih={elemenTerpilih}
                visual={visual}
                ukur={ukur}
                alat={alat}
                jalurDigambar={jalurDigambar}
                opsiJalur={opsiJalur}
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
            {alat === "jalur" && (
              <BilahOpsiJalur opsi={opsiJalur} onUbah={setOpsiJalur} elevasiKerja={elevasiKerja} jumlahTitik={jalurDigambar?.titik.length ?? 0} />
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
              <Minimap dokumen={dokMinimap} terpilih={terpilihSet} toko={tampilanToko} onPusatkan={pusatkan} />
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
                {t === "validasi" && peringatan.length > 0 && (
                  <span
                    className="ml-1 inline-flex min-w-4 items-center justify-center rounded-full bg-amber-500 px-1 text-[10px] text-white tabular-nums"
                    title={`${peringatan.length} peringatan teknik`}
                  >
                    {peringatan.length}
                  </span>
                )}
                {t === "validasi" && galat.length === 0 && !galatServer?.length && peringatan.length === 0 && (
                  <span className="ml-1 text-emerald-600 dark:text-emerald-400">✓</span>
                )}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === "properti" && (
              <PanelProperti
                dok={dok}
                terpilih={elemenTerpilih}
                dispatch={dispatch}
                onKeKolom={keKolom}
                elevasiKerja={elevasiKerja}
                onUbahElevasiKerja={setElevasiKerja}
              />
            )}
            {tab === "kolom" && <PanelKolom bak={bakTerpilih} kolomTerpilih={state.kolomTerpilih} kolomSorotIds={kolomSorotIds} dispatch={dispatch} />}
            {tab === "validasi" && <PanelValidasi galat={galat} peringatan={peringatan} galatServer={galatServer} elemen={dok.elemen} onFokus={fokusGalat} onTutupServer={tutupServer} />}
          </div>
        </aside>
      </div>

      {/* ---------- Bilah status ---------- */}
      <footer className="flex h-7 shrink-0 items-center gap-3 border-t px-3 text-[11px] text-muted-foreground tabular-nums">
        <StatusKursor toko={kursorToko} />
        <span>
          Alat: <b className="font-medium text-foreground">{alat === "pilih" ? "Pilih" : alat === "geser" ? "Geser kanvas" : alat === "ukur" ? "Ukur" : NAMA_TIPE[alat]}</b>
        </span>
        <span>
          Terpilih: <b className="font-medium text-foreground">{terpilih.length}</b>
          {state.kolomTerpilih.length > 0 && ` · ${state.kolomTerpilih.length} kolom`}
        </span>
        <span className="hidden sm:inline">{dok.elemen.length} elemen</span>
        <span className="hidden md:inline">Riwayat {state.lalu.length}</span>
        <span className="hidden md:inline">Snap {formatMeter(langkahSnap)}</span>
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
    <span className="w-44">
      {t ? (
        <>
          X <b className="font-medium text-foreground">{formatMeter(t.x)}</b> · Y <b className="font-medium text-foreground">{formatMeter(t.y)}</b>
        </>
      ) : (
        "X — · Y —"
      )}
    </span>
  );
}

// ---------- Overlay edit (SVG, meter) ----------

const OverlayEdit = memo(function OverlayEdit({
  elemenTerpilih,
  visual,
  ukur,
  alat,
  jalurDigambar,
  opsiJalur,
  kursorToko,
  unitPerPx,
  kanvas,
}: {
  elemenTerpilih: DenahElemen[];
  visual: Visual;
  ukur: GarisUkur | null;
  alat: Alat;
  jalurDigambar: JalurDigambar | null;
  opsiJalur: OpsiJalur;
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
          x={gabung.x - 6 * px + (visual.geser?.dx ?? 0)}
          y={gabung.y - 6 * px + (visual.geser?.dy ?? 0)}
          width={gabung.w + 12 * px}
          height={gabung.h + 12 * px}
          fill="none"
          className="stroke-primary/60"
          strokeWidth={1}
          strokeDasharray="2 3"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      )}

      {/* Label dimensi elemen terpilih (diam) */}
      {satu && !sedangGeser && !visual.ukuran && <LabelDimensi e={satu} fs={fs} />}

      {/* Handle elemen tunggal */}
      {satu && !satu.terkunci && !sedangGeser && <HandleElemen e={satu} px={px} />}

      {/* Label ukuran saat drag */}
      {visual.geser && satu && <LabelPosisi e={satu} dx={visual.geser.dx} dy={visual.geser.dy} fs={fs} />}
      {visual.ukuran && (
        <Pil x={visual.ukuran.x + visual.ukuran.w / 2} y={visual.ukuran.y + visual.ukuran.h + fs * 1.4} fs={fs}>
          {`${formatMeter(visual.ukuran.w)} × ${formatMeter(visual.ukuran.h)}`}
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
      {visual.gambar && <PratinjauGambar g={visual.gambar} fs={fs} langkah={kanvas.langkahSnapM} />}

      {/* Hantu alat di bawah kursor */}
      {alat !== "pilih" && alat !== "geser" && alat !== "ukur" && alat !== "jalur" && !visual.gambar && (
        <HantuAlat alat={alat} toko={kursorToko} fs={fs} langkah={kanvas.langkahSnapM} />
      )}

      {/* Alat Jalur: titik yang sudah diklik + garis karet ke kursor */}
      {alat === "jalur" && <PratinjauJalur jd={jalurDigambar} opsi={opsiJalur} toko={kursorToko} fs={fs} px={px} langkah={kanvas.langkahSnapM} />}

      {/* Alat Ukur (sementara) */}
      {ukur && <TampilanUkur u={ukur} fs={fs} />}
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

function TampilanUkur({ u, fs }: { u: GarisUkur; fs: number }) {
  const r = fs * 0.32;
  const ada = u.a.x !== u.b.x || u.a.y !== u.b.y;
  return (
    <g pointerEvents="none">
      {ada && (
        <line x1={u.a.x} y1={u.a.y} x2={u.b.x} y2={u.b.y} className="stroke-rose-600 dark:stroke-rose-400" strokeWidth={2} strokeDasharray="6 3" vectorEffect="non-scaling-stroke" />
      )}
      <circle cx={u.a.x} cy={u.a.y} r={r} className="fill-rose-600 stroke-background dark:fill-rose-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      {ada && <circle cx={u.b.x} cy={u.b.y} r={r} className="fill-rose-600 stroke-background dark:fill-rose-400" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
      {ada && (
        <Pil x={(u.a.x + u.b.x) / 2} y={(u.a.y + u.b.y) / 2 - fs * 1.4} fs={fs}>
          {formatUkur(u.a, u.b)}
        </Pil>
      )}
    </g>
  );
}

function PratinjauJalur({ jd, opsi, toko, fs, px, langkah }: { jd: JalurDigambar | null; opsi: OpsiJalur; toko: Toko<Titik | null>; fs: number; px: number; langkah: number }) {
  const c = useToko(toko);
  const warna = warnaJalur(opsi);
  const tebal = Math.max(2 * px, opsi.diameterMm / 1000);
  const titik = jd?.titik ?? [];
  const akhir = titik[titik.length - 1];
  const kursor = c ? snapTitik(c, true, langkah) : null;
  const r = fs * 0.32;
  return (
    <g pointerEvents="none">
      {titik.length > 1 && (
        <polyline points={titik.map((t) => `${t.x},${t.y}`).join(" ")} fill="none" stroke={warna} strokeWidth={tebal} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
      )}
      {akhir && kursor && (
        <>
          <line x1={akhir.x} y1={akhir.y} x2={kursor.x} y2={kursor.y} stroke={warna} strokeWidth={tebal} strokeDasharray={`${6 * px} ${4 * px}`} opacity={0.6} />
          <Pil x={(akhir.x + kursor.x) / 2} y={(akhir.y + kursor.y) / 2 - fs * 1.4} fs={fs}>
            {formatMeter(Math.hypot(kursor.x - akhir.x, kursor.y - akhir.y))}
          </Pil>
        </>
      )}
      {titik.map((t, i) => (
        <circle key={i} cx={t.x} cy={t.y} r={r} fill={warna} className="stroke-background" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
      ))}
      {kursor && <circle cx={kursor.x} cy={kursor.y} r={r * 0.8} fill="none" stroke={warna} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />}
    </g>
  );
}

/** Bilah opsi alat Jalur (melayang di atas kanvas): jenis, fluida/sistem, diameter. */
function BilahOpsiJalur({ opsi, onUbah, elevasiKerja, jumlahTitik }: { opsi: OpsiJalur; onUbah: (o: OpsiJalur) => void; elevasiKerja: number; jumlahTitik: number }) {
  return (
    <div className="absolute top-3 left-1/2 z-10 flex w-[min(640px,calc(100%-24px))] -translate-x-1/2 flex-col gap-1.5 rounded-lg border bg-background/95 p-2 text-xs shadow-lg backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="size-3 shrink-0 rounded-full border" style={{ background: warnaJalur(opsi) }} aria-hidden />
        <div className="w-32">
          <Segmen<OpsiJalur["jenis"]>
            nilai={opsi.jenis}
            pilihan={[
              { nilai: "pipa", label: "Pipa" },
              { nilai: "kabel", label: "Kabel" },
            ]}
            onUbah={(jenis) =>
              onUbah(
                jenis === opsi.jenis
                  ? opsi
                  : jenis === "kabel"
                    ? { jenis, sistem: opsi.sistem ?? "daya", diameterMm: DIAMETER_JALUR_BAWAAN.kabel }
                    : { jenis, fluida: opsi.fluida ?? FLUIDA_BAWAAN, diameterMm: DIAMETER_JALUR_BAWAAN.pipa }
              )
            }
          />
        </div>
        <div className="w-40">
          {opsi.jenis === "pipa" ? (
            <Pilihan<Fluida> nilai={opsi.fluida ?? FLUIDA_BAWAAN} pilihan={PILIHAN_FLUIDA} ariaLabel="Fluida" onUbah={(fluida) => onUbah({ ...opsi, fluida })} />
          ) : (
            <Pilihan<"daya" | "kontrol"> nilai={opsi.sistem ?? "daya"} pilihan={PILIHAN_SISTEM_KABEL} ariaLabel="Sistem kabel" onUbah={(sistem) => onUbah({ ...opsi, sistem })} />
          )}
        </div>
        <div className="flex items-center gap-1">
          <span className="text-muted-foreground">Ø</span>
          <div className="w-24">
            <InputAngka nilai={opsi.diameterMm} min={1} max={2000} satuan="mm" onUbah={(diameterMm) => onUbah({ ...opsi, diameterMm })} />
          </div>
        </div>
        <span className="text-muted-foreground">
          z <b className="font-medium text-foreground">{formatMeter(elevasiKerja)}</b>
        </span>
      </div>
      <div className="text-[11px] text-muted-foreground">
        {jumlahTitik === 0
          ? "Klik untuk titik awal (menempel ke ujung jalur lain / tepi elemen)."
          : `${jumlahTitik} titik · klik = tambah titik · dobel klik / Enter = selesai · Backspace = hapus titik · Esc = batal`}
      </div>
    </div>
  );
}

function LabelPosisi({ e, dx, dy, fs }: { e: DenahElemen; dx: number; dy: number; fs: number }) {
  const k = kotakElemen(e);
  return (
    <Pil x={k.x + dx + k.w / 2} y={k.y + dy + k.h + fs * 1.4} fs={fs}>
      {`${formatMeter(k.x + dx)}, ${formatMeter(k.y + dy)}`}
    </Pil>
  );
}

/** Panjang × lebar (meter) di sisi atas & kanan elemen terpilih; derek = panjang rel. */
function LabelDimensi({ e, fs }: { e: DenahElemen; fs: number }) {
  if (e.tipe === "derek") {
    const { a, b } = garisDerek(e);
    return (
      <Pil x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 + fs * 1.6} fs={fs}>
        {`Rel ${formatMeter(Math.hypot(b.x - a.x, b.y - a.y))}`}
      </Pil>
    );
  }
  if (e.tipe === "jalur") {
    const k = kotakElemen(e);
    return (
      <Pil x={k.x + k.w / 2} y={k.y + k.h + fs * 1.8} fs={fs}>
        {`Panjang ${formatMeter(panjangJalur(e))}`}
      </Pil>
    );
  }
  const k = kotakElemen(e);
  const lebarW = formatMeter(k.w);
  const geserKanan = (formatMeter(k.h).length * 0.62 + 1) * fs * 0.5 + fs * 0.6;
  return (
    <>
      <Pil x={k.x + k.w / 2} y={k.y - fs * 2.6} fs={fs}>
        {lebarW}
      </Pil>
      <Pil x={k.x + k.w + geserKanan} y={k.y + k.h / 2} fs={fs}>
        {formatMeter(k.h)}
      </Pil>
    </>
  );
}

function HandleElemen({ e, px }: { e: DenahElemen; px: number }) {
  const s = 9 * px;
  if (e.tipe === "jalur") {
    // Jalur tanpa handle ubah ukuran (aturKotak tidak berlaku): hanya penanda titik; edit lewat tabel titik.
    return (
      <g pointerEvents="none">
        {e.titik.map((t, i) => (
          <circle key={i} cx={t.x} cy={t.y} r={s * 0.4} className="fill-background stroke-primary" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
    );
  }
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
  // ±0,42 m per kolom (ice can 360 mm + jarak 60 mm).
  const n = Math.min(36, Math.floor(lebar / 0.42));
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
          {formatMeter(panjang)}
        </Pil>
      </g>
    );
  }
  if (!kotak) return null;
  return (
    <g pointerEvents="none">
      <rect x={kotak.x} y={kotak.y} width={kotak.w} height={kotak.h} className={KELAS_HANTU} strokeWidth={1.5} strokeDasharray="5 3" vectorEffect="non-scaling-stroke" />
      {alat === "bak" &&
        kotak.w >= 2 &&
        garisKolomHantu(kotak.w).map((f, i) => (
          <line
            key={i}
            x1={kotak.x + f * kotak.w}
            y1={kotak.y + 0.2}
            x2={kotak.x + f * kotak.w}
            y2={kotak.y + kotak.h - 0.2}
            className="stroke-primary/30"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      <Pil x={kotak.x + kotak.w / 2} y={kotak.y + kotak.h + fs * 1.4} fs={fs}>
        {`${NAMA_TIPE[alat]} ${formatMeter(kotak.w)} × ${formatMeter(kotak.h)}`}
      </Pil>
    </g>
  );
}

function PratinjauGambar({ g, fs, langkah }: { g: NonNullable<Visual["gambar"]>; fs: number; langkah: number }) {
  if (ALAT_GARIS.has(g.alat)) {
    const garis = g.bergerak ? { a: g.a, b: g.b } : garisBawaan(g.alat, g.a, true, langkah);
    return <BentukHantu alat={g.alat} garis={garis} fs={fs} />;
  }
  const k = g.bergerak ? kotakDari(g.a, g.b) : kotakBawaan(g.alat, g.a, true, langkah);
  return <BentukHantu alat={g.alat} kotak={k} fs={fs} />;
}

function HantuAlat({ alat, toko, fs, langkah }: { alat: TipeElemen; toko: Toko<Titik | null>; fs: number; langkah: number }) {
  const c = useToko(toko);
  if (!c) return null;
  if (ALAT_GARIS.has(alat)) return <BentukHantu alat={alat} garis={garisBawaan(alat, c, true, langkah)} fs={fs} />;
  return <BentukHantu alat={alat} kotak={kotakBawaan(alat, c, true, langkah)} fs={fs} />;
}
