"use client";

// Kanvas SVG bersama Denah Produksi Es Balok — SATU-SATUNYA mesin gambar
// denah. Dipakai penampil (mode "lihat", Task 2) dan builder (mode "edit",
// Task 3). Builder menambah perilaku edit lewat prop (onPointerDown/Move/Up,
// overlay, terpilihIds, sorotIds), BUKAN dengan menyalin kode gambar.
//
// Sistem koordinat: semua gambar dalam METER (skemaVersi 2, lihat
// src/lib/produksi-denah.ts). Pan/zoom = viewBox SVG: tampilan.x/y = titik
// (meter) di pojok kiri atas viewport, tampilan.skala = piksel layar per meter.
// Bak (cangkang dinding, lajur kolom, ice can) digambar dari tataBakMeter()
// — geometri yang sama dengan mode 3D.
//
// Performa (target 10 bak × 66 kolom × 36 ice can):
// - Setiap elemen dirender oleh komponen memo; daftar elemen di-useMemo, jadi
//   pan hanya mengubah atribut viewBox — elemen tidak dirender ulang.
// - Detail yang bergantung zoom (nomor kolom, ice can, ukuran teks) memakai
//   skala yang DIBULATKAN ke tangga √2 (skalaKira), jadi elemen hanya
//   dirender ulang saat zoom melewati satu anak tangga.
// - Ice can digambar sebagai SATU <path> per varian per bak, dan hanya bila
//   sel ice can ≥ 3 px di layar.
// - Hit-test lewat atribut data-elemen-id / data-kolom-id + closest(), tanpa
//   handler per elemen.

import {
  memo,
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from "react";
import { Box, CircleDot, Droplets, Fan, GlassWater, Lock, Maximize, Minus, Plus, ThermometerSun, Wind, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { segmenJalur, segmenTertanam, tataBakMeter, type TataBak } from "@/lib/produksi-denah-geometri";
import { MawarAngin } from "@/components/produksi-denah/mawar-angin";
import { formatAngka, panjangSkalaBatang } from "@/components/produksi-denah/format";
import { WARNA_AIR, WARNA_BETON, warnaJalur } from "@/components/produksi-denah/warna";
import {
  kotakElemen,
  lapisanElemen as lapisanDari,
  type AreaElemen,
  type BakElemen,
  type BetonElemen,
  type JenisTangki,
  type Lapisan,
  type TangkiElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type JalurElemen,
  type LabelElemen,
  type MesinElemen,
  type Titik,
} from "@/lib/produksi-denah";

// ---------- API publik ----------

export type ModeKanvas = "lihat" | "edit";

export interface Tampilan {
  x: number; // meter di tepi kiri viewport
  y: number; // meter di tepi atas viewport
  skala: number; // piksel layar per meter
}

export interface InfoPointerKanvas {
  event: React.PointerEvent<SVGSVGElement>;
  titik: Titik; // posisi kursor dalam meter (belum di-snap)
  elemenId: string | null; // elemen di bawah kursor saat pointerdown/move
  kolomId: string | null; // kolom bak di bawah kursor (elemenId = bak induknya)
}

export interface KonteksOverlay {
  tampilan: Tampilan;
  unitPerPx: number; // 1 piksel layar dalam meter (untuk handle berukuran tetap)
  lebarPx: number;
  tinggiPx: number;
}

export interface DenahKanvasHandle {
  pasKeLayar(): void;
  zoomMasuk(): void;
  zoomKeluar(): void;
  /** Konversi koordinat layar (clientX/Y) ke meter. */
  keGrid(clientX: number, clientY: number): Titik;
  /** Pusatkan viewport ke kotak (meter), zoom secukupnya. */
  fokusKe(kotak: { x: number; y: number; w: number; h: number }): void;
  /** Geser viewport agar titik (meter) ini di tengah (zoom tetap). */
  pusatkanKe(titik: Titik, animasi?: boolean): void;
  /** Tampilan saat ini (null sebelum ukuran wadah diketahui). */
  tampilan(): Tampilan | null;
  svg(): SVGSVGElement | null;
}

/** Pergeseran sementara (pratinjau drag) — elemen digeser lewat transform tanpa mengubah dokumen. */
export interface GeserSementara {
  ids: ReadonlySet<string>;
  dx: number;
  dy: number;
}

export interface DenahKanvasProps {
  dokumen: DenahDokumen;
  mode?: ModeKanvas;
  /** Elemen terpilih (garis seleksi). Gunakan Set yang stabil (useMemo). */
  terpilihIds?: ReadonlySet<string>;
  /** Kolom terpilih (ID DenahKolom) — ditandai di dalam bak. */
  kolomTerpilihIds?: ReadonlySet<string>;
  /** Elemen bermasalah (mis. galat validasi) — garis merah. */
  sorotIds?: ReadonlySet<string>;
  /** Elemen terkena peringatan teknik (periksaTeknik) — garis amber, tidak memblokir. */
  peringatanIds?: ReadonlySet<string>;
  /** Klik (tanpa geser) pada elemen, atau null pada ruang kosong. */
  onPilihElemen?: (elemenId: string | null, info: InfoPointerKanvas) => void;
  /** Klik pada kolom bak. Bila tidak diisi, klik kolom = onPilihElemen(bakId). */
  onPilihKolom?: (bakId: string, kolomId: string, info: InfoPointerKanvas) => void;
  /**
   * Dipanggil pada pointerdown tombol kiri (bukan spasi/tombol tengah).
   * Kembalikan true untuk MENGAMBIL ALIH gestur (drag/resize/kotak seleksi di
   * builder): kanvas tidak akan pan/klik, dan meneruskan move/up ke
   * onPointerMove/onPointerUp sampai pointer dilepas.
   */
  onPointerDown?: (info: InfoPointerKanvas) => boolean | void;
  /** Gerak pointer saat gestur diambil alih, ATAU hover (tanpa tombol ditekan). */
  onPointerMove?: (info: InfoPointerKanvas, gesturAktif: boolean) => void;
  /** Akhir gestur yang diambil alih. batal = pointercancel / kehilangan capture: JANGAN commit. */
  onPointerUp?: (info: InfoPointerKanvas, batal: boolean) => void;
  /** Lapisan SVG tambahan di atas elemen, dalam meter (handle, kotak seleksi, garis bantu, hantu alat). */
  overlay?: (ctx: KonteksOverlay) => ReactNode;
  /** Konten HTML melayang di atas kanvas (toolbar, legenda). */
  children?: ReactNode;
  /** Tombol zoom +/−/pas bawaan di pojok kanan bawah. */
  kontrolZoom?: boolean;
  /** Mawar mata angin (kanan atas) & skala batang (kiri bawah). Bawaan true. */
  penunjukArah?: boolean;
  className?: string;
  ref?: Ref<DenahKanvasHandle>;
  // ---- Tambahan mode edit (builder) ----
  /** Kelas kursor Tailwind untuk svg (mis. "cursor-crosshair"); menimpa bawaan mode. */
  kursor?: string;
  /** Pratinjau drag: elemen ini digeser lewat transform (tanpa render ulang tubuhnya). */
  geserSementara?: GeserSementara | null;
  /** Elemen di bawah kursor (sorotan hover tipis). */
  hoverId?: string | null;
  /** Elemen bertumpuk (bak) — diberi warna peringatan. */
  tumpukIds?: ReadonlySet<string>;
  /** Kolom bermasalah (mis. ditolak server karena berisi es) — ditandai merah. */
  kolomSorotIds?: ReadonlySet<string>;
  /** Dipanggil setiap tampilan (pan/zoom) atau ukuran wadah berubah. */
  onTampilanBerubah?: (tampilan: Tampilan, ukuran: { w: number; h: number }) => void;
  /**
   * Lapisan yang tampil (spec v2 §4, useLapisanTampil). Elemen di lapisan
   * tersembunyi tidak digambar — jadi juga tidak bisa diklik. Bawaan: semua.
   */
  lapisanTampil?: ReadonlySet<Lapisan>;
  /**
   * Overlay status per kolom (ID DenahKolom → warna isi CSS + label tooltip),
   * mis. tahap es di layar admin produksi. Tanpa prop ini tampilan tidak berubah.
   * Gunakan objek yang stabil (useMemo).
   */
  statusKolom?: Readonly<Record<string, StatusKolom>>;
}

export interface StatusKolom {
  /** Nilai CSS untuk `fill` (hex atau var(--…)), bukan kelas Tailwind. */
  warna: string;
  label: string;
}

// ---------- Konstanta ----------

const SKALA_MIN = 1;
const SKALA_MAX = 200;
const AMBANG_GESER_PX = 4;
const MARGIN_PAS = 2; // meter di sekeliling kanvas saat "pas ke layar"
const KOSONG: ReadonlySet<string> = new Set();

function batasi(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

// Tangga √2: elemen hanya dirender ulang saat zoom melewati anak tangga.
function bulatkanSkala(s: number) {
  return Math.pow(2, Math.round(Math.log2(s) * 2) / 2);
}

function hitungPas(lebarPx: number, tinggiPx: number, kanvas: DenahDokumen["kanvas"], kotak?: { x: number; y: number; w: number; h: number }): Tampilan {
  const k = kotak ?? { x: 0, y: 0, w: kanvas.lebar, h: kanvas.tinggi };
  const w = k.w + MARGIN_PAS * 2;
  const h = k.h + MARGIN_PAS * 2;
  const skala = batasi(Math.min(lebarPx / w, tinggiPx / h), SKALA_MIN, SKALA_MAX);
  return { skala, x: k.x + k.w / 2 - lebarPx / skala / 2, y: k.y + k.h / 2 - tinggiPx / skala / 2 };
}

function infoTarget(target: EventTarget | null): { elemenId: string | null; kolomId: string | null } {
  if (!(target instanceof Element)) return { elemenId: null, kolomId: null };
  const kol = target.closest("[data-kolom-id]");
  const el = target.closest("[data-elemen-id]");
  return { elemenId: el?.getAttribute("data-elemen-id") ?? null, kolomId: kol?.getAttribute("data-kolom-id") ?? null };
}

function ketikDiInput(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

// ---------- Kelas warna (berlaku terang & gelap) ----------

const KELAS_VARIAN = {
  kecil: "fill-sky-300/80 dark:fill-sky-700/70",
  besar: "fill-amber-300/85 dark:fill-amber-600/70",
} as const;
const KELAS_ICE_CAN = {
  kecil: "fill-sky-700/70 dark:fill-sky-200/70",
  besar: "fill-amber-800/70 dark:fill-amber-100/70",
} as const;
const KELAS_TEKS = "fill-foreground stroke-background";
const NS = "non-scaling-stroke" as const;

// ---------- Komponen utama ----------

export function DenahKanvas({
  dokumen,
  mode = "lihat",
  terpilihIds = KOSONG,
  kolomTerpilihIds = KOSONG,
  sorotIds = KOSONG,
  peringatanIds = KOSONG,
  onPilihElemen,
  onPilihKolom,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  overlay,
  children,
  kontrolZoom = true,
  penunjukArah = true,
  className,
  ref,
  kursor,
  geserSementara = null,
  hoverId = null,
  tumpukIds = KOSONG,
  kolomSorotIds = KOSONG,
  onTampilanBerubah,
  lapisanTampil,
  statusKolom,
}: DenahKanvasProps) {
  const idDasar = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wadahRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [ukuran, setUkuran] = useState<{ w: number; h: number } | null>(null);
  const [tampilanState, setTampilanState] = useState<Tampilan | null>(null);
  const [sedangGeser, setSedangGeser] = useState(false);
  const { kanvas } = dokumen;
  const elemenDok = dokumen.elemen;
  // Elemen yang lapisannya tersembunyi dibuang SEBELUM digambar (tidak ada hit-test).
  const elemen = useMemo(
    () => (lapisanTampil ? elemenDok.filter((e) => lapisanTampil.has(lapisanDari(e))) : elemenDok),
    [elemenDok, lapisanTampil]
  );

  const pas = useMemo(() => (ukuran ? hitungPas(ukuran.w, ukuran.h, kanvas) : null), [ukuran, kanvas]);
  // Sebelum pengguna pan/zoom, tampilan = "pas ke layar" (diturunkan, tanpa effect).
  const tampilan = tampilanState ?? pas;

  // Nilai terbaru untuk handler yang dipasang sekali (wheel, keyboard, pointer).
  const terbaru = useRef({ tampilan, ukuran, pas, kanvas });
  useLayoutEffect(() => {
    terbaru.current = { tampilan, ukuran, pas, kanvas };
  });

  useLayoutEffect(() => {
    const el = wadahRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entri]) => {
      const { width, height } = entri.contentRect;
      if (width > 0 && height > 0) setUkuran({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Laporkan tampilan ke pemanggil (minimap, persen zoom builder).
  const onTampilanRef = useRef(onTampilanBerubah);
  useLayoutEffect(() => {
    onTampilanRef.current = onTampilanBerubah;
  });
  useEffect(() => {
    if (tampilan && ukuran) onTampilanRef.current?.(tampilan, ukuran);
  }, [tampilan, ukuran]);

  // ---------- Animasi halus (tombol zoom, pas ke layar, fokus) ----------
  // Pusat viewport & log(skala) diinterpolasi; gestur pengguna (pan, wheel,
  // cubit) membatalkan animasi yang sedang berjalan.
  const animasi = useRef<number | null>(null);
  const hentikanAnimasi = useCallback(() => {
    if (animasi.current !== null) cancelAnimationFrame(animasi.current);
    animasi.current = null;
  }, []);
  useEffect(() => hentikanAnimasi, [hentikanAnimasi]);

  const animasiKe = useCallback(
    (target: Tampilan, akhir: Tampilan | null = target) => {
      hentikanAnimasi();
      const { tampilan: awal, ukuran: u } = terbaru.current;
      const reduksi = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      if (!awal || !u || reduksi) {
        setTampilanState(akhir);
        return;
      }
      const pusatA = { x: awal.x + u.w / awal.skala / 2, y: awal.y + u.h / awal.skala / 2 };
      const pusatB = { x: target.x + u.w / target.skala / 2, y: target.y + u.h / target.skala / 2 };
      const la = Math.log(awal.skala);
      const lb = Math.log(target.skala);
      const t0 = performance.now();
      const DURASI = 220;
      const langkah = (now: number) => {
        const p = Math.min(1, (now - t0) / DURASI);
        if (p >= 1) {
          animasi.current = null;
          setTampilanState(akhir);
          return;
        }
        const e = 1 - Math.pow(1 - p, 3);
        const skala = Math.exp(la + (lb - la) * e);
        const cx = pusatA.x + (pusatB.x - pusatA.x) * e;
        const cy = pusatA.y + (pusatB.y - pusatA.y) * e;
        setTampilanState({ skala, x: cx - u.w / skala / 2, y: cy - u.h / skala / 2 });
        animasi.current = requestAnimationFrame(langkah);
      };
      animasi.current = requestAnimationFrame(langkah);
    },
    [hentikanAnimasi]
  );

  const ubahTampilan = useCallback(
    (fn: (t: Tampilan) => Tampilan) => {
      hentikanAnimasi();
      setTampilanState((prev) => {
        const dasar = prev ?? terbaru.current.pas;
        return dasar ? fn(dasar) : prev;
      });
    },
    [hentikanAnimasi]
  );

  const zoomDi = useCallback(
    (px: number, py: number, faktor: number) => {
      ubahTampilan((t) => {
        const skala = batasi(t.skala * faktor, SKALA_MIN, SKALA_MAX);
        const gx = t.x + px / t.skala;
        const gy = t.y + py / t.skala;
        return { skala, x: gx - px / skala, y: gy - py / skala };
      });
    },
    [ubahTampilan]
  );

  // Tombol zoom: animasi halus di sekitar pusat viewport.
  const zoomTengah = useCallback(
    (faktor: number) => {
      const { ukuran: u, tampilan: t } = terbaru.current;
      if (!u || !t) return;
      const skala = batasi(t.skala * faktor, SKALA_MIN, SKALA_MAX);
      const gx = t.x + u.w / 2 / t.skala;
      const gy = t.y + u.h / 2 / t.skala;
      animasiKe({ skala, x: gx - u.w / 2 / skala, y: gy - u.h / 2 / skala });
    },
    [animasiKe]
  );

  const pasKeLayar = useCallback(() => {
    const p = terbaru.current.pas;
    if (p) animasiKe(p, null);
    else setTampilanState(null);
  }, [animasiKe]);

  const keGrid = useCallback((clientX: number, clientY: number): Titik => {
    const svg = svgRef.current;
    const t = terbaru.current.tampilan;
    if (!svg || !t) return { x: 0, y: 0 };
    const r = svg.getBoundingClientRect();
    return { x: t.x + (clientX - r.left) / t.skala, y: t.y + (clientY - r.top) / t.skala };
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      pasKeLayar,
      zoomMasuk: () => zoomTengah(1.4),
      zoomKeluar: () => zoomTengah(1 / 1.4),
      keGrid,
      fokusKe: (kotak) => {
        const { ukuran: u, kanvas: kv } = terbaru.current;
        if (u) animasiKe(hitungPas(u.w, u.h, kv, kotak));
      },
      pusatkanKe: (titik, pakaiAnimasi = false) => {
        const { ukuran: u, tampilan: t } = terbaru.current;
        if (!u || !t) return;
        const target = { skala: t.skala, x: titik.x - u.w / t.skala / 2, y: titik.y - u.h / t.skala / 2 };
        if (pakaiAnimasi) animasiKe(target);
        else {
          hentikanAnimasi();
          setTampilanState(target);
        }
      },
      tampilan: () => terbaru.current.tampilan,
      svg: () => svgRef.current,
    }),
    [zoomTengah, keGrid, pasKeLayar, animasiKe, hentikanAnimasi]
  );

  // Wheel harus non-passive agar halaman tidak ikut tergulir.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (ev: WheelEvent) => {
      ev.preventDefault();
      const r = svg.getBoundingClientRect();
      const laju = ev.ctrlKey ? 0.01 : 0.0015; // ctrlKey = pinch touchpad
      const delta = ev.deltaMode === 1 ? ev.deltaY * 16 : ev.deltaY;
      zoomDi(ev.clientX - r.left, ev.clientY - r.top, Math.exp(-delta * laju));
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomDi]);

  // Spasi + drag = pan (juga di mode edit).
  const spasi = useRef(false);
  const diAtas = useRef(false);
  useEffect(() => {
    const turun = (ev: KeyboardEvent) => {
      if (ev.code !== "Space" || ketikDiInput(ev.target)) return;
      spasi.current = true;
      if (diAtas.current) ev.preventDefault();
    };
    const naik = (ev: KeyboardEvent) => {
      if (ev.code === "Space") spasi.current = false;
    };
    const lepas = () => (spasi.current = false);
    window.addEventListener("keydown", turun);
    window.addEventListener("keyup", naik);
    window.addEventListener("blur", lepas);
    return () => {
      window.removeEventListener("keydown", turun);
      window.removeEventListener("keyup", naik);
      window.removeEventListener("blur", lepas);
    };
  }, []);

  // ---------- Gestur pointer ----------

  type Gestur =
    | { jenis: "tekan" | "pan"; id: number; cx: number; cy: number; t0: Tampilan; info: InfoPointerKanvas }
    | { jenis: "konsumen"; id: number }
    | { jenis: "cubit"; d0: number; mx: number; my: number; t0: Tampilan };
  const gestur = useRef<Gestur | null>(null);
  const penunjuk = useRef(new Map<number, { x: number; y: number }>());

  const buatInfo = (ev: React.PointerEvent<SVGSVGElement>, target: EventTarget | null = ev.target): InfoPointerKanvas => ({
    event: ev,
    titik: keGrid(ev.clientX, ev.clientY),
    ...infoTarget(target),
  });

  const klik = (info: InfoPointerKanvas) => {
    if (info.kolomId && info.elemenId && onPilihKolom) onPilihKolom(info.elemenId, info.kolomId, info);
    else onPilihElemen?.(info.elemenId, info);
  };

  const mulaiCubit = () => {
    const t = terbaru.current.tampilan;
    const svg = svgRef.current;
    if (!t || !svg) return;
    hentikanAnimasi();
    const [a, b] = [...penunjuk.current.values()];
    const r = svg.getBoundingClientRect();
    gestur.current = {
      jenis: "cubit",
      d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      mx: (a.x + b.x) / 2 - r.left,
      my: (a.y + b.y) / 2 - r.top,
      t0: t,
    };
    setSedangGeser(true);
  };

  const handlePointerDown = (ev: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    const t = terbaru.current.tampilan;
    if (!svg || !t) return;
    // Pointer dicatat HANYA bila lolos filter (tombol kiri/tengah/spasi, atau
    // jari kedua untuk cubit) — entri basi (mis. klik kanan yang dilepas di
    // luar svg) tidak boleh membuat sentuhan berikutnya terbaca sebagai cubit.
    if (penunjuk.current.size === 1 && ev.pointerType === "touch" && gestur.current && gestur.current.jenis !== "konsumen") {
      penunjuk.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
      svg.setPointerCapture(ev.pointerId);
      mulaiCubit();
      return;
    }
    if (penunjuk.current.size > 0) return;
    const panPaksa = ev.button === 1 || spasi.current;
    if (!panPaksa && ev.button !== 0) return;
    penunjuk.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const info = buatInfo(ev);
    svg.setPointerCapture(ev.pointerId);
    if (!panPaksa && onPointerDown?.(info) === true) {
      gestur.current = { jenis: "konsumen", id: ev.pointerId };
      return;
    }
    if (panPaksa) ev.preventDefault();
    hentikanAnimasi();
    gestur.current = { jenis: panPaksa ? "pan" : "tekan", id: ev.pointerId, cx: ev.clientX, cy: ev.clientY, t0: t, info };
    if (panPaksa) setSedangGeser(true);
  };

  const handlePointerMove = (ev: React.PointerEvent<SVGSVGElement>) => {
    if (penunjuk.current.has(ev.pointerId)) penunjuk.current.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const g = gestur.current;
    if (!g) {
      if (onPointerMove && ev.buttons === 0) onPointerMove(buatInfo(ev), false);
      return;
    }
    if (g.jenis === "cubit") {
      if (penunjuk.current.size < 2) return;
      const svg = svgRef.current!;
      const [a, b] = [...penunjuk.current.values()];
      const r = svg.getBoundingClientRect();
      const mx = (a.x + b.x) / 2 - r.left;
      const my = (a.y + b.y) / 2 - r.top;
      const skala = batasi((g.t0.skala * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, SKALA_MIN, SKALA_MAX);
      const gx = g.t0.x + g.mx / g.t0.skala;
      const gy = g.t0.y + g.my / g.t0.skala;
      setTampilanState({ skala, x: gx - mx / skala, y: gy - my / skala });
      return;
    }
    if (ev.pointerId !== g.id) return;
    if (g.jenis === "konsumen") {
      onPointerMove?.(buatInfo(ev, document.elementFromPoint(ev.clientX, ev.clientY)), true);
      return;
    }
    const dx = ev.clientX - g.cx;
    const dy = ev.clientY - g.cy;
    if (g.jenis === "tekan") {
      if (Math.hypot(dx, dy) < AMBANG_GESER_PX) return;
      g.jenis = "pan";
      setSedangGeser(true);
    }
    setTampilanState({ skala: g.t0.skala, x: g.t0.x - dx / g.t0.skala, y: g.t0.y - dy / g.t0.skala });
  };

  // pointerup (batal=false), pointercancel / lostpointercapture (batal=true).
  // Status gestur dibereskan DULU, baru capture dilepas — lostpointercapture
  // yang menyusul jadi no-op.
  const akhiri = (ev: React.PointerEvent<SVGSVGElement>, batal: boolean) => {
    const tercatat = penunjuk.current.delete(ev.pointerId);
    const lepasCapture = () => {
      const svg = svgRef.current;
      if (svg?.hasPointerCapture(ev.pointerId)) svg.releasePointerCapture(ev.pointerId);
    };
    const g = gestur.current;
    if (!g || !tercatat) {
      lepasCapture();
      return;
    }
    if (g.jenis === "cubit") {
      // Sisa satu jari setelah cubit tidak dihitung sebagai klik/pan.
      if (penunjuk.current.size < 2) {
        gestur.current = null;
        penunjuk.current.clear();
        setSedangGeser(false);
      }
      lepasCapture();
      return;
    }
    if (ev.pointerId !== g.id) {
      lepasCapture();
      return;
    }
    gestur.current = null;
    if (g.jenis === "konsumen") {
      onPointerUp?.(buatInfo(ev, document.elementFromPoint(ev.clientX, ev.clientY)), batal);
      lepasCapture();
      return;
    }
    setSedangGeser(false);
    lepasCapture();
    if (g.jenis === "tekan" && !batal) klik(g.info);
  };

  // ---------- Lapisan (memo: tidak dirender ulang saat pan) ----------

  const skalaKira = tampilan ? bulatkanSkala(tampilan.skala) : 1;

  const bakDenganKolomTerpilih = useMemo(() => {
    const s = new Set<string>();
    if (kolomTerpilihIds.size === 0) return s;
    for (const e of elemen) if (e.tipe === "bak" && e.kolom.some((k) => kolomTerpilihIds.has(k.id))) s.add(e.id);
    return s;
  }, [elemen, kolomTerpilihIds]);

  const bakDenganKolomSorot = useMemo(() => {
    const s = new Set<string>();
    if (kolomSorotIds.size === 0) return s;
    for (const e of elemen) if (e.tipe === "bak" && e.kolom.some((k) => kolomSorotIds.has(k.id))) s.add(e.id);
    return s;
  }, [elemen, kolomSorotIds]);

  const lapisanTautan = useMemo(
    () => <LapisanTautan elemen={elemen} terpilihIds={terpilihIds} geser={geserSementara} />,
    [elemen, terpilihIds, geserSementara]
  );

  // Setiap elemen dibungkus <g> transform: saat drag hanya atribut transform
  // pembungkus yang berubah; ElemenView (memo) tidak dirender ulang.
  const lapisanElemen = useMemo(
    () =>
      elemen.map((e) => {
        const geser = geserSementara && !e.terkunci && geserSementara.ids.has(e.id) ? geserSementara : null;
        return (
          <g key={e.id} transform={geser ? `translate(${geser.dx} ${geser.dy})` : undefined}>
            <ElemenView
              e={e}
              terpilih={terpilihIds.has(e.id)}
              sorot={sorotIds.has(e.id)}
              peringatan={peringatanIds.has(e.id)}
              hover={hoverId === e.id}
              tumpuk={tumpukIds.has(e.id)}
              kolomTerpilih={bakDenganKolomTerpilih.has(e.id) ? kolomTerpilihIds : KOSONG}
              kolomSorot={bakDenganKolomSorot.has(e.id) ? kolomSorotIds : KOSONG}
              skalaKira={skalaKira}
              ukuranGrid={kanvas.ukuranGrid}
              idPola={idDasar}
              mode={mode}
              tertanam={e.tipe === "jalur" ? maskTertanam(e, dokumen) : undefined}
              statusKolom={e.tipe === "bak" ? statusKolom : undefined}
            />
          </g>
        );
      }),
    [
      dokumen,
      elemen,
      geserSementara,
      terpilihIds,
      sorotIds,
      peringatanIds,
      hoverId,
      tumpukIds,
      bakDenganKolomTerpilih,
      kolomTerpilihIds,
      bakDenganKolomSorot,
      kolomSorotIds,
      skalaKira,
      kanvas.ukuranGrid,
      idDasar,
      mode,
      statusKolom,
    ]
  );

  const lapisanDasar = useMemo(
    () => <LatarKanvas lebar={kanvas.lebar} tinggi={kanvas.tinggi} skalaKira={skalaKira} idPola={idDasar} />,
    [kanvas.lebar, kanvas.tinggi, skalaKira, idDasar]
  );

  const viewBox = tampilan && ukuran ? `${tampilan.x} ${tampilan.y} ${ukuran.w / tampilan.skala} ${ukuran.h / tampilan.skala}` : "0 0 1 1";
  const persenZoom = tampilan ? Math.round((tampilan.skala / kanvas.ukuranGrid) * 100) : 100;

  return (
    <div
      ref={wadahRef}
      className={cn("relative overflow-hidden rounded-lg border bg-muted/50 select-none", className)}
      onPointerEnter={() => (diAtas.current = true)}
      onPointerLeave={() => (diAtas.current = false)}
    >
      <svg
        ref={svgRef}
        className={cn(
          // Mode lihat di layar sempit: satu jari tetap bisa menggulir halaman
          // secara vertikal; pan horizontal & cubit tetap ditangani kanvas.
          "absolute inset-0 size-full",
          mode === "lihat" ? "touch-pan-y" : "touch-none",
          sedangGeser ? "cursor-grabbing" : (kursor ?? (mode === "lihat" ? "cursor-grab" : "cursor-default"))
        )}
        viewBox={viewBox}
        preserveAspectRatio="xMinYMin meet"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(ev) => akhiri(ev, false)}
        onPointerCancel={(ev) => akhiri(ev, true)}
        onLostPointerCapture={(ev) => akhiri(ev, true)}
        onAuxClick={(ev) => ev.preventDefault()}
        role="img"
        aria-label="Denah produksi"
      >
        {tampilan && ukuran && (
          <>
            {lapisanDasar}
            {lapisanTautan}
            {lapisanElemen}
            {overlay?.({ tampilan, unitPerPx: 1 / tampilan.skala, lebarPx: ukuran.w, tinggiPx: ukuran.h })}
          </>
        )}
      </svg>
      {penunjukArah && tampilan && (
        <>
          <MawarAngin utaraDerajat={kanvas.utaraDerajat} ukuran={52} className="absolute top-2 right-2" />
          <SkalaBatang pxPerMeter={tampilan.skala} />
        </>
      )}
      {children}
      {kontrolZoom && (
        <div className="absolute right-2 bottom-2 flex items-center gap-1 rounded-lg border bg-background/90 p-1 shadow-sm backdrop-blur">
          <TombolKanvas label="Perkecil" onClick={() => zoomTengah(1 / 1.4)}>
            <Minus className="size-4" />
          </TombolKanvas>
          <span className="w-12 text-center text-xs tabular-nums text-muted-foreground">{persenZoom}%</span>
          <TombolKanvas label="Perbesar" onClick={() => zoomTengah(1.4)}>
            <Plus className="size-4" />
          </TombolKanvas>
          <TombolKanvas label="Pas ke layar" onClick={pasKeLayar}>
            <Maximize className="size-4" />
          </TombolKanvas>
        </div>
      )}
    </div>
  );
}

function TombolKanvas({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="inline-flex size-7 items-center justify-center rounded-md text-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
    >
      {children}
    </button>
  );
}

// ---------- Skala batang (pojok kiri bawah) ----------

function SkalaBatang({ pxPerMeter }: { pxPerMeter: number }) {
  const m = panjangSkalaBatang(pxPerMeter);
  const px = m * pxPerMeter;
  return (
    <div
      className="pointer-events-none absolute bottom-2 left-2 rounded-md border bg-background/90 px-2 pt-0.5 pb-1 text-[10px] text-muted-foreground tabular-nums shadow-sm backdrop-blur"
      role="img"
      aria-label={`Skala: garis = ${m} meter`}
    >
      <div className="flex justify-between gap-2" style={{ width: Math.max(px, 24) }}>
        <span>0</span>
        <span>{formatAngka(m)} m</span>
      </div>
      <div className="flex h-1.5 border-x border-b border-foreground/70" style={{ width: px }}>
        <div className="h-full w-1/2 bg-foreground/60" />
      </div>
    </div>
  );
}

// ---------- Latar: area kanvas + grid ----------

const LatarKanvas = memo(function LatarKanvas({ lebar, tinggi, skalaKira, idPola }: { lebar: number; tinggi: number; skalaKira: number; idPola: string }) {
  const px = 1 / skalaKira;
  const grid1 = skalaKira >= 8;
  const grid5 = skalaKira * 5 >= 8;
  return (
    <g pointerEvents="none">
      <defs>
        <pattern id={`${idPola}-g1`} width={1} height={1} patternUnits="userSpaceOnUse">
          <path d="M 1 0 L 0 0 0 1" fill="none" className="stroke-border" strokeWidth={px} />
        </pattern>
        <pattern id={`${idPola}-g5`} width={5} height={5} patternUnits="userSpaceOnUse">
          <path d="M 5 0 L 0 0 0 5" fill="none" className="stroke-muted-foreground/30" strokeWidth={px} />
        </pattern>
        <pattern id={`${idPola}-nonaktif`} width={0.15} height={0.15} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.15} height={0.15} className="fill-muted" />
          <line x1={0} y1={0} x2={0} y2={0.15} className="stroke-muted-foreground/60" strokeWidth={0.045} />
        </pattern>
        {/* Arsir beton (pondasi, plinth, saluran). */}
        <pattern id={`${idPola}-beton`} width={0.3} height={0.3} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={0.3} className="stroke-stone-600/60 dark:stroke-stone-300/50" strokeWidth={0.04} />
        </pattern>
        {/* Arsir merah: kolom/ice can yang melebihi ruang dalam bak. */}
        <pattern id={`${idPola}-lebih`} width={0.2} height={0.2} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.2} height={0.2} className="fill-red-500/15" />
          <line x1={0} y1={0} x2={0} y2={0.2} className="stroke-red-600/80 dark:stroke-red-400/80" strokeWidth={0.05} />
        </pattern>
      </defs>
      <rect x={0} y={0} width={lebar} height={tinggi} className="fill-card" />
      {grid1 && <rect x={0} y={0} width={lebar} height={tinggi} fill={`url(#${idPola}-g1)`} />}
      {grid5 && <rect x={0} y={0} width={lebar} height={tinggi} fill={`url(#${idPola}-g5)`} />}
      <rect x={0} y={0} width={lebar} height={tinggi} fill="none" className="stroke-muted-foreground/50" strokeWidth={1.5} vectorEffect={NS} />
    </g>
  );
});

// ---------- Tautan bak → mesin (garis putus-putus) ----------

function pusat(e: DenahElemen): Titik {
  return { x: e.x + e.w / 2, y: e.y + e.h / 2 };
}

const LapisanTautan = memo(function LapisanTautan({
  elemen,
  terpilihIds,
  geser,
}: {
  elemen: DenahElemen[];
  terpilihIds: ReadonlySet<string>;
  geser: GeserSementara | null;
}) {
  const mesin = new Map<string, MesinElemen>();
  for (const e of elemen) if (e.tipe === "mesin") mesin.set(e.id, e);
  const titikPusat = (e: DenahElemen) => {
    const p = pusat(e);
    return geser && !e.terkunci && geser.ids.has(e.id) ? { x: p.x + geser.dx, y: p.y + geser.dy } : p;
  };
  const garis: ReactNode[] = [];
  for (const e of elemen) {
    if (e.tipe !== "bak") continue;
    const a = titikPusat(e);
    for (const mid of e.mesinIds) {
      const m = mesin.get(mid);
      if (!m) continue;
      const b = titikPusat(m);
      const aktif = terpilihIds.has(e.id) || terpilihIds.has(m.id);
      garis.push(
        <line
          key={`${e.id}-${mid}`}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          className={aktif ? "stroke-violet-600 dark:stroke-violet-300" : "stroke-violet-500/45 dark:stroke-violet-300/40"}
          strokeWidth={aktif ? 2.5 : 1.5}
          strokeDasharray="6 4"
          vectorEffect={NS}
        />
      );
    }
  }
  return <g pointerEvents="none">{garis}</g>;
});

// ---------- Elemen ----------

interface ElemenViewProps {
  e: DenahElemen;
  terpilih: boolean;
  sorot: boolean;
  peringatan: boolean;
  hover: boolean;
  tumpuk: boolean;
  kolomTerpilih: ReadonlySet<string>;
  kolomSorot: ReadonlySet<string>;
  skalaKira: number;
  ukuranGrid: number;
  idPola: string;
  mode: ModeKanvas;
  /** Jalur: "1"/"0" per segmen (tertanam di beton) — string agar memo tetap stabil. */
  tertanam?: string;
  /** Bak: overlay status per kolom (lihat DenahKanvasProps.statusKolom). */
  statusKolom?: Readonly<Record<string, StatusKolom>>;
}

// Ukuran teks nama (meter): ±11 px di layar, dibatasi agar tidak raksasa/hilang.
function ukuranNama(skalaKira: number) {
  return batasi(11 / skalaKira, 0.12, 3);
}

function Teks({ x, y, ukuran, children, anchor = "middle", baseline = "central", tebal, className, transform }: {
  x: number;
  y: number;
  ukuran: number;
  children: ReactNode;
  anchor?: "start" | "middle" | "end";
  baseline?: "central" | "auto" | "hanging";
  tebal?: boolean;
  className?: string;
  transform?: string;
}) {
  return (
    <text
      x={x}
      y={y}
      fontSize={ukuran}
      textAnchor={anchor}
      dominantBaseline={baseline}
      fontWeight={tebal ? 600 : 400}
      strokeWidth={ukuran * 0.22}
      paintOrder="stroke"
      strokeLinejoin="round"
      className={cn(KELAS_TEKS, className)}
      transform={transform}
      pointerEvents="none"
    >
      {children}
    </text>
  );
}

const ElemenView = memo(function ElemenView(p: ElemenViewProps) {
  const { e } = p;
  const kotak = kotakElemen(e);
  const tubuhTransform = `translate(${e.x} ${e.y})${e.rotasi ? ` rotate(${e.rotasi} ${e.w / 2} ${e.h / 2})` : ""}`;
  const fs = ukuranNama(p.skalaKira);

  let tubuh: ReactNode;
  let nama: ReactNode = null;
  switch (e.tipe) {
    case "bak":
      tubuh = <BakTubuh bak={e} {...p} />;
      nama = (
        <Teks x={kotak.x} y={kotak.y - fs * 0.35} ukuran={fs} anchor="start" baseline="auto" tebal>
          {e.nama}
        </Teks>
      );
      break;
    case "mesin":
      tubuh = <MesinTubuh m={e} />;
      nama = (
        <Teks x={kotak.x + kotak.w / 2} y={kotak.y + kotak.h + fs * 0.3} ukuran={fs} baseline="hanging" tebal>
          {e.nama}
        </Teks>
      );
      break;
    case "derek":
      // Titik derek dalam koordinat dunia ABSOLUT (meter) (bukan relatif elemen) — tidak ikut rotasi.
      return <DerekView d={e} terpilih={p.terpilih} sorot={p.sorot} peringatan={p.peringatan} hover={p.hover} fs={fs} skalaKira={p.skalaKira} />;
    case "dinding":
      tubuh = <rect width={e.w} height={e.h} className="fill-slate-600 stroke-slate-700 dark:fill-slate-400 dark:stroke-slate-300" strokeWidth={1} vectorEffect={NS} />;
      break;
    case "pintu":
      tubuh = <PintuTubuh w={e.w} h={e.h} />;
      break;
    case "area":
      tubuh = <AreaTubuh a={e} />;
      nama = (
        <Teks x={kotak.x + fs * 0.4} y={kotak.y + fs * 0.4} ukuran={fs} anchor="start" baseline="hanging" tebal className="fill-emerald-800 dark:fill-emerald-200">
          {e.nama}
        </Teks>
      );
      break;
    case "label":
      tubuh = <LabelTubuh l={e} ukuranGrid={p.ukuranGrid} />;
      break;
    case "beton":
      tubuh = <BetonTubuh b={e} idPola={p.idPola} />;
      nama = (
        <Teks x={kotak.x + fs * 0.4} y={kotak.y + fs * 0.4} ukuran={fs} anchor="start" baseline="hanging" className="fill-stone-700 dark:fill-stone-200">
          {e.nama}
        </Teks>
      );
      break;
    case "tangki":
      tubuh = <TangkiTubuh t={e} skalaKira={p.skalaKira} />;
      nama = (
        <Teks x={kotak.x + kotak.w / 2} y={kotak.y + kotak.h + fs * 0.3} ukuran={fs} baseline="hanging" tebal>
          {e.nama}
        </Teks>
      );
      break;
    case "jalur":
      // Titik jalur dalam koordinat dunia ABSOLUT (meter) — tidak ikut transform tubuh.
      return <JalurView j={e} tertanam={p.tertanam ?? ""} terpilih={p.terpilih} sorot={p.sorot} peringatan={p.peringatan} hover={p.hover} fs={fs} skalaKira={p.skalaKira} />;
  }

  return (
    <g data-elemen-id={e.id} data-tipe={e.tipe} className={p.mode === "lihat" && e.tipe === "bak" ? "cursor-pointer" : undefined}>
      <g transform={tubuhTransform}>{tubuh}</g>
      {p.tumpuk && (
        <rect
          x={kotak.x}
          y={kotak.y}
          width={kotak.w}
          height={kotak.h}
          className="fill-red-500/20 stroke-red-500/70"
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect={NS}
          pointerEvents="none"
        />
      )}
      {nama}
      <GarisPilih kotak={kotak} terpilih={p.terpilih} sorot={p.sorot} peringatan={p.peringatan} hover={p.hover} skalaKira={p.skalaKira} />
      {p.mode === "edit" && e.terkunci && <IkonKunci kotak={kotak} skalaKira={p.skalaKira} />}
    </g>
  );
});

function IkonKunci({ kotak, skalaKira }: { kotak: { x: number; y: number; w: number; h: number }; skalaKira: number }) {
  const s = 14 / skalaKira;
  return (
    <g pointerEvents="none">
      <rect x={kotak.x + kotak.w - s * 1.1} y={kotak.y + s * 0.1} width={s} height={s} rx={s * 0.2} className="fill-background/90" />
      <Lock x={kotak.x + kotak.w - s} y={kotak.y + s * 0.2} width={s * 0.8} height={s * 0.8} className="text-muted-foreground" />
    </g>
  );
}

function GarisPilih({
  kotak,
  terpilih,
  sorot,
  peringatan = false,
  hover = false,
  skalaKira,
}: {
  kotak: { x: number; y: number; w: number; h: number };
  terpilih: boolean;
  sorot: boolean;
  peringatan?: boolean;
  hover?: boolean;
  skalaKira: number;
}) {
  if (!terpilih && !sorot && !hover && !peringatan) return null;
  // Jarak garis dari elemen dalam piksel layar (bukan meter) agar konsisten di semua zoom.
  const pad = 4 / skalaKira;
  // Peringatan teknik (amber) = garis luar terpisah, jadi tetap terlihat
  // bersama garis pilih (biru) maupun galat (merah).
  const padP = 8 / skalaKira;
  return (
    <>
      {peringatan && (
        <rect
          x={kotak.x - padP}
          y={kotak.y - padP}
          width={kotak.w + padP * 2}
          height={kotak.h + padP * 2}
          fill="none"
          className="stroke-amber-500 dark:stroke-amber-400"
          strokeWidth={2}
          strokeDasharray="3 2"
          vectorEffect={NS}
          pointerEvents="none"
        />
      )}
      {(terpilih || sorot || hover) && (
        <rect
          x={kotak.x - pad}
          y={kotak.y - pad}
          width={kotak.w + pad * 2}
          height={kotak.h + pad * 2}
          fill="none"
          className={sorot ? "stroke-destructive" : terpilih ? "stroke-primary" : "stroke-primary/50"}
          strokeWidth={terpilih || sorot ? 2 : 1.5}
          strokeDasharray={terpilih ? "6 3" : undefined}
          vectorEffect={NS}
          pointerEvents="none"
        />
      )}
    </>
  );
}

// ---------- Bak ----------

// Semua ukuran nyata (meter) dari tataBakMeter() — sumber yang sama dengan 3D
// dan periksaTeknik. Koordinat lokal bak (a = sumbu deret kolom, b = sumbu
// sepanjang kolom) diubah ke x/y lokal elemen lewat tata.keXY.

const f3 = (v: number) => Math.round(v * 1000) / 1000;

/** Satu <path> per varian berisi semua ice can kolom aktif (ukuran nyata). */
function pathIceCan(tata: TataBak): { kecil: string; besar: string } {
  const bagian = { kecil: [] as string[], besar: [] as string[] };
  for (const k of tata.kolom) {
    if (k.nonaktif || k.jumlah <= 0) continue;
    const out = bagian[k.varian];
    const langkah = k.panjangCan + k.jarakCan;
    for (let j = 0; j < k.jumlah; j++) {
      const r = tata.keXY(k.a0, k.b0 + j * langkah, k.lebar, k.panjangCan);
      out.push(`M${f3(r.x)} ${f3(r.y)}h${f3(r.w)}v${f3(r.h)}h${f3(-r.w)}z`);
    }
  }
  return { kecil: bagian.kecil.join(""), besar: bagian.besar.join("") };
}

/** Sisi terkecil ice can (meter) di antara kolom aktif — untuk ambang tampil 3 px. */
function sisiIceCanTerkecil(tata: TataBak): number {
  let min = Infinity;
  for (const k of tata.kolom) if (!k.nonaktif && k.jumlah > 0) min = Math.min(min, k.lebar, k.panjangCan);
  return min;
}

function BakTubuh({ bak, kolomTerpilih, kolomSorot, skalaKira, idPola, statusKolom }: { bak: BakElemen } & ElemenViewProps) {
  const tata = useMemo(() => tataBakMeter(bak), [bak]);
  // Tebal mentah, SAMA dengan tataBakMeter (2D & 3D harus sepakat).
  const tebal = bak.tebalDindingM;
  const jarakKolom = bak.jarakAntarKolomMm / 1000;
  const tampilIceCan = sisiIceCanTerkecil(tata) * skalaKira >= 3;
  const iceCan = useMemo(() => (tampilIceCan ? pathIceCan(tata) : null), [tata, tampilIceCan]);
  const ruangB = Math.max(0, tata.ruangB);
  const lawanRotasi = bak.rotasi ? (cx: number, cy: number) => `rotate(${-bak.rotasi} ${cx} ${cy})` : () => undefined;

  // Nomor kolom: di pita dinding bila cukup tebal, selain itu di atas pangkal lajur.
  const lebarMin = tata.kolom.reduce((m, k) => Math.min(m, k.lebar), Infinity);
  const fsNomor = Math.min(Number.isFinite(lebarMin) ? lebarMin * 0.7 : 0.25, 0.3);
  const diDinding = tebal >= fsNomor * 1.1;
  const bNomor = diDinding ? tebal / 2 : tebal + fsNomor * 0.7;
  const tampilNomor = fsNomor * skalaKira >= 7;
  // Posisi can "1" (ujung b0 tiap kolom): angka kecil di tengah can pertama, hanya saat cukup besar.
  const fsPosisi = tata.kolom.reduce((m, k) => (!k.nonaktif && k.jumlah > 0 ? Math.min(m, k.lebar * 0.7, k.panjangCan * 0.7) : m), 0.3);
  const tampilPosisi = tampilIceCan && fsPosisi * skalaKira >= 8;

  // Area kebutuhan kolom/ice can yang melebihi ruang dalam → arsir merah.
  const lebih: { x: number; y: number; w: number; h: number }[] = [];
  if (tata.butuhA > tata.ruangA + 1e-9) {
    lebih.push(tata.keXY(tebal + Math.max(0, tata.ruangA), tebal, tata.butuhA - Math.max(0, tata.ruangA), Math.max(ruangB, tata.butuhB)));
  }
  if (tata.butuhB > tata.ruangB + 1e-9) {
    lebih.push(tata.keXY(tebal, tebal + ruangB, Math.max(0, Math.min(tata.butuhA, tata.ruangA)), tata.butuhB - ruangB));
  }

  return (
    <>
      {/* Cangkang beton: bidang luar = dinding, bidang dalam = ruang brine. */}
      <rect width={bak.w} height={bak.h} className="fill-stone-400 stroke-stone-600 dark:fill-stone-600 dark:stroke-stone-400" strokeWidth={1.5} vectorEffect={NS} />
      <rect
        x={tebal}
        y={tebal}
        width={Math.max(0, bak.w - tebal * 2)}
        height={Math.max(0, bak.h - tebal * 2)}
        className="fill-slate-100 stroke-stone-500/70 dark:fill-slate-900 dark:stroke-stone-500/70"
        strokeWidth={1}
        vectorEffect={NS}
      />
      {tata.kolom.map((k) => {
        // Lajur kolom selebar ice can (ukuran nyata), sepanjang ruang dalam bak.
        const r = tata.keXY(k.a0, tebal, k.lebar, ruangB);
        const pilih = kolomTerpilih.has(k.kolomId);
        const salah = kolomSorot.has(k.kolomId);
        return (
          <rect
            key={k.kolomId}
            pointerEvents="none"
            x={r.x}
            y={r.y}
            width={Math.max(r.w, 0.0001)}
            height={Math.max(r.h, 0.0001)}
            fill={k.nonaktif ? `url(#${idPola}-nonaktif)` : undefined}
            className={cn(
              salah ? "fill-red-400/80 dark:fill-red-700/80" : k.nonaktif ? "opacity-80" : KELAS_VARIAN[k.varian],
              salah ? "stroke-destructive" : pilih ? "stroke-primary" : "stroke-none"
            )}
            strokeWidth={pilih || salah ? 2.5 : 0}
            vectorEffect={NS}
          />
        );
      })}
      {/* Area klik tak terlihat per kolom: lajur + jarak antar-kolom (setengah tiap sisi),
          agar kolom tetap mudah diklik walau lajur nyata hanya beberapa piksel. */}
      {tata.kolom.map((k) => {
        const r = tata.keXY(k.a0 - jarakKolom / 2, tebal, k.lebar + jarakKolom, ruangB);
        return (
          <rect
            key={k.kolomId}
            data-kolom-id={k.kolomId}
            x={r.x}
            y={r.y}
            width={Math.max(r.w, 0.0001)}
            height={Math.max(r.h, 0.0001)}
            fill="transparent"
          >
            {statusKolom?.[k.kolomId] && <title>{statusKolom[k.kolomId].label}</title>}
          </rect>
        );
      })}
      {iceCan?.kecil && <path d={iceCan.kecil} className={KELAS_ICE_CAN.kecil} pointerEvents="none" />}
      {iceCan?.besar && <path d={iceCan.besar} className={KELAS_ICE_CAN.besar} pointerEvents="none" />}
      {/* Overlay status (di atas ice can supaya tetap terlihat saat zoom dekat). */}
      {statusKolom &&
        tata.kolom.map((k) => {
          const st = statusKolom[k.kolomId];
          if (!st) return null;
          const r = tata.keXY(k.a0, tebal, k.lebar, ruangB);
          const pilih = kolomTerpilih.has(k.kolomId);
          return (
            <rect
              key={k.kolomId}
              pointerEvents="none"
              x={r.x}
              y={r.y}
              width={Math.max(r.w, 0.0001)}
              height={Math.max(r.h, 0.0001)}
              style={{ fill: st.warna }}
              fillOpacity={0.8}
              className={pilih ? "stroke-primary" : "stroke-none"}
              strokeWidth={pilih ? 2.5 : 0}
              vectorEffect={NS}
            />
          );
        })}
      {lebih.map((r, i) => (
        <rect
          key={i}
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill={`url(#${idPola}-lebih)`}
          className="stroke-red-600 dark:stroke-red-400"
          strokeWidth={1}
          strokeDasharray="3 2"
          vectorEffect={NS}
          pointerEvents="none"
        />
      ))}
      {tampilNomor &&
        tata.kolom.map((k) => {
          const nomor = bak.kolom[k.indeks].nomor;
          const p = tata.keXY(k.a0 + k.lebar / 2, bNomor, 0, 0);
          return (
            <Teks key={k.kolomId} x={p.x} y={p.y} ukuran={fsNomor} transform={lawanRotasi(p.x, p.y)} className={k.nonaktif ? "fill-muted-foreground" : undefined}>
              {nomor}
            </Teks>
          );
        })}
      {tampilPosisi &&
        tata.kolom.map((k) => {
          if (k.nonaktif || k.jumlah <= 0) return null;
          const p = tata.keXY(k.a0 + k.lebar / 2, k.b0 + k.panjangCan / 2, 0, 0);
          return (
            <Teks key={`${k.kolomId}-pos1`} x={p.x} y={p.y} ukuran={fsPosisi} transform={lawanRotasi(p.x, p.y)} className="fill-muted-foreground">
              1
            </Teks>
          );
        })}
    </>
  );
}

// ---------- Beton & tangki ----------

function BetonTubuh({ b, idPola }: { b: BetonElemen; idPola: string }) {
  return (
    <>
      <rect width={b.w} height={b.h} style={{ fill: WARNA_BETON }} fillOpacity={0.55} />
      <rect width={b.w} height={b.h} fill={`url(#${idPola}-beton)`} className="stroke-stone-600 dark:stroke-stone-300" strokeWidth={1.5} vectorEffect={NS} />
    </>
  );
}

const IKON_TANGKI: Record<JenisTangki, LucideIcon> = {
  tandon: Droplets,
  filling: GlassWater,
  thawing: ThermometerSun,
  sumur: CircleDot,
  "cooling-tower": Wind,
  lainnya: Box,
};

function TangkiTubuh({ t, skalaKira }: { t: TangkiElemen; skalaKira: number }) {
  const Ikon = IKON_TANGKI[t.jenis] ?? Box;
  const s = Math.min(t.w, t.h) * (t.bentuk === "silinder" ? 0.45 : 0.5);
  const isi = Math.max(0, Math.min(100, t.levelIsiPersen));
  const fsIsi = s * 0.36;
  const kelasBadan = "stroke-sky-700 dark:stroke-sky-300";
  return (
    <>
      {t.bentuk === "silinder" ? (
        <ellipse cx={t.w / 2} cy={t.h / 2} rx={t.w / 2} ry={t.h / 2} style={{ fill: WARNA_AIR }} fillOpacity={0.12 + 0.25 * (isi / 100)} className={kelasBadan} strokeWidth={1.5} vectorEffect={NS} />
      ) : (
        <rect width={t.w} height={t.h} rx={Math.min(t.w, t.h) * 0.08} style={{ fill: WARNA_AIR }} fillOpacity={0.12 + 0.25 * (isi / 100)} className={kelasBadan} strokeWidth={1.5} vectorEffect={NS} />
      )}
      <Ikon x={(t.w - s) / 2} y={(t.h - s) / 2 - fsIsi * 0.5} width={s} height={s} className="text-sky-700 dark:text-sky-300" pointerEvents="none" />
      {fsIsi * skalaKira >= 7 && (
        <Teks x={t.w / 2} y={(t.h + s) / 2 + fsIsi * 0.2} ukuran={fsIsi} className="fill-sky-800 dark:fill-sky-200">
          {`${formatAngka(isi)}%`}
        </Teks>
      )}
    </>
  );
}

// ---------- Mesin, derek, pintu, area, label ----------

function MesinTubuh({ m }: { m: MesinElemen }) {
  const s = Math.min(m.w, m.h) * 0.62;
  return (
    <>
      <rect
        width={m.w}
        height={m.h}
        rx={Math.min(m.w, m.h) * 0.18}
        className="fill-violet-100 stroke-violet-500 dark:fill-violet-950 dark:stroke-violet-400"
        strokeWidth={1.5}
        vectorEffect={NS}
      />
      <Fan x={(m.w - s) / 2} y={(m.h - s) / 2} width={s} height={s} className="text-violet-600 dark:text-violet-300" pointerEvents="none" />
    </>
  );
}

function DerekView({
  d,
  terpilih,
  sorot,
  peringatan,
  hover,
  fs,
  skalaKira,
}: {
  d: DerekElemen;
  terpilih: boolean;
  sorot: boolean;
  peringatan: boolean;
  hover: boolean;
  fs: number;
  skalaKira: number;
}) {
  let a = d.titikAwal;
  let b = d.titikAkhir;
  if (a.x === b.x && a.y === b.y) {
    // Titik belum diatur: pakai garis tengah sepanjang sisi terpanjang kotak.
    const k = kotakElemen(d);
    if (k.w >= k.h) {
      a = { x: k.x, y: k.y + k.h / 2 };
      b = { x: k.x + k.w, y: k.y + k.h / 2 };
    } else {
      a = { x: k.x + k.w / 2, y: k.y };
      b = { x: k.x + k.w / 2, y: k.y + k.h };
    }
  }
  const r = Math.max(0.12, fs * 0.35);
  return (
    <g data-elemen-id={d.id} data-tipe="derek">
      {/* Area klik lebar tak terlihat */}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} vectorEffect={NS} pointerEvents="stroke" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-orange-500 dark:stroke-orange-400" strokeWidth={4} vectorEffect={NS} strokeLinecap="round" />
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="stroke-orange-100 dark:stroke-orange-950" strokeWidth={1.5} strokeDasharray="4 4" vectorEffect={NS} />
      <circle cx={a.x} cy={a.y} r={r} className="fill-orange-500 stroke-background dark:fill-orange-400" strokeWidth={1.5} vectorEffect={NS} />
      <circle cx={b.x} cy={b.y} r={r} className="fill-orange-500 stroke-background dark:fill-orange-400" strokeWidth={1.5} vectorEffect={NS} />
      <Teks x={(a.x + b.x) / 2} y={(a.y + b.y) / 2 - fs * 0.6} ukuran={fs} baseline="auto" tebal className="fill-orange-700 dark:fill-orange-300">
        {d.nama}
      </Teks>
      <GarisPilih kotak={kotakElemen(d)} terpilih={terpilih} sorot={sorot} peringatan={peringatan} hover={hover} skalaKira={skalaKira} />
    </g>
  );
}

// ---------- Jalur (pipa & kabel) ----------

/** "1"/"0" per segmen jalur: tertanam di beton (segmenTertanam, sama dengan 3D & periksaTeknik). */
function maskTertanam(j: JalurElemen, dok: DenahDokumen): string {
  return segmenJalur(j)
    .map((s) => (segmenTertanam(s, dok) ? "1" : "0"))
    .join("");
}

/** Jarak antar-panah arah aliran (meter, sepanjang denah). */
const JARAK_PANAH_M = 3;

/** Posisi & sudut panah arah aliran: tiap ±3 m (tengah tiap rentang 3 m), minimal satu di tengah jalur. */
function posisiPanah(titik: readonly Titik[]): { x: number; y: number; sudut: number }[] {
  const seg: { a: Titik; b: Titik; awal: number; l: number }[] = [];
  let total = 0;
  for (let i = 1; i < titik.length; i++) {
    const a = titik[i - 1];
    const b = titik[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l < 1e-6) continue; // segmen tegak (naik/turun) tidak terlihat di denah
    seg.push({ a, b, awal: total, l });
    total += l;
  }
  if (total === 0) return [];
  const n = Math.max(1, Math.round(total / JARAK_PANAH_M));
  const hasil: { x: number; y: number; sudut: number }[] = [];
  let k = 0;
  for (let i = 0; i < n; i++) {
    const d = ((i + 0.5) * total) / n;
    while (k < seg.length - 1 && seg[k].awal + seg[k].l < d) k++;
    const s = seg[k];
    const f = Math.min(1, Math.max(0, (d - s.awal) / s.l));
    hasil.push({
      x: s.a.x + (s.b.x - s.a.x) * f,
      y: s.a.y + (s.b.y - s.a.y) * f,
      sudut: (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI,
    });
  }
  return hasil;
}

function JalurView({
  j,
  tertanam,
  terpilih,
  sorot,
  peringatan,
  hover,
  fs,
  skalaKira,
}: {
  j: JalurElemen;
  tertanam: string;
  terpilih: boolean;
  sorot: boolean;
  peringatan: boolean;
  hover: boolean;
  fs: number;
  skalaKira: number;
}) {
  const warna = warnaJalur(j);
  const px = 1 / skalaKira;
  // Tebal = diameter nyata, minimal 2 px di layar.
  const tebal = Math.max(2 * px, j.diameterMm / 1000);
  const putus = `${Math.max(6 * px, tebal * 3)} ${Math.max(4 * px, tebal * 2)}`;
  const poin = j.titik.map((t) => `${t.x},${t.y}`).join(" ");
  const ukPanah = Math.max(5 * px, tebal * 1.6);
  // Nama di tengah segmen terpanjang (di denah).
  let label: { x: number; y: number } | null = null;
  let terpanjang = 0;
  for (let i = 1; i < j.titik.length; i++) {
    const a = j.titik[i - 1];
    const b = j.titik[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > terpanjang) {
      terpanjang = l;
      label = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    }
  }
  return (
    <g data-elemen-id={j.id} data-tipe="jalur">
      {/* Area klik lebar tak terlihat */}
      <polyline points={poin} fill="none" stroke="transparent" strokeWidth={Math.max(14 * px, tebal + 8 * px)} strokeLinejoin="round" pointerEvents="stroke" />
      {j.titik.slice(1).map((b, i) => {
        const a = j.titik[i];
        const tanam = tertanam[i] === "1";
        return (
          <line
            key={i}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke={warna}
            strokeWidth={tebal}
            strokeLinecap={tanam ? "butt" : "round"}
            strokeDasharray={tanam ? putus : undefined}
            pointerEvents="none"
          >
            {tanam && <title>Tertanam di beton</title>}
          </line>
        );
      })}
      {posisiPanah(j.titik).map((p, i) => (
        <path
          key={i}
          d={`M ${ukPanah} 0 L ${-ukPanah * 0.7} ${-ukPanah * 0.75} L ${-ukPanah * 0.7} ${ukPanah * 0.75} Z`}
          transform={`translate(${p.x} ${p.y}) rotate(${p.sudut})`}
          fill={warna}
          className="stroke-background"
          strokeWidth={1}
          vectorEffect={NS}
          pointerEvents="none"
        />
      ))}
      {label && terpanjang * skalaKira > 60 && (
        <Teks x={label.x} y={label.y - tebal / 2 - fs * 0.4} ukuran={fs * 0.9} baseline="auto">
          {j.nama}
        </Teks>
      )}
      <GarisPilih kotak={kotakElemen(j)} terpilih={terpilih} sorot={sorot} peringatan={peringatan} hover={hover} skalaKira={skalaKira} />
    </g>
  );
}

function PintuTubuh({ w, h }: { w: number; h: number }) {
  // Daun pintu + busur ayun dari engsel kiri bawah.
  const r = w;
  return (
    <>
      <rect width={w} height={h} className="fill-amber-100 stroke-amber-600 dark:fill-amber-950 dark:stroke-amber-400" strokeWidth={1.5} vectorEffect={NS} />
      <path d={`M 0 0 L 0 ${-r} A ${r} ${r} 0 0 1 ${r} 0`} fill="none" className="stroke-amber-600/70 dark:stroke-amber-400/70" strokeWidth={1} strokeDasharray="3 3" vectorEffect={NS} pointerEvents="none" />
    </>
  );
}

function AreaTubuh({ a }: { a: AreaElemen }) {
  const warna = a.warna && /^#[0-9a-fA-F]{3,8}$|^[a-z]+$/.test(a.warna) ? a.warna : undefined;
  return (
    <rect
      width={a.w}
      height={a.h}
      rx={0.3}
      style={warna ? { fill: warna, stroke: warna } : undefined}
      fillOpacity={warna ? 0.14 : undefined}
      className={warna ? undefined : "fill-emerald-500/10 stroke-emerald-600/60 dark:fill-emerald-400/10 dark:stroke-emerald-400/50"}
      strokeWidth={1.5}
      strokeDasharray="8 4"
      vectorEffect={NS}
    />
  );
}

function LabelTubuh({ l, ukuranGrid }: { l: LabelElemen; ukuranGrid: number }) {
  // ukuranHuruf = piksel pada zoom 100% (sama seperti ukuranGrid); bawaan menyesuaikan tinggi kotak.
  const fs = l.ukuranHuruf && l.ukuranHuruf > 0 ? l.ukuranHuruf / ukuranGrid : l.h * 0.7;
  return (
    <>
      <rect width={l.w} height={l.h} fill="transparent" />
      <Teks x={l.w / 2} y={l.h / 2} ukuran={fs} tebal>
        {l.teks || l.nama}
      </Teks>
    </>
  );
}
