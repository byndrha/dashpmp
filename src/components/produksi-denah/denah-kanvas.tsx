"use client";

// Kanvas SVG bersama Denah Produksi Es Balok — SATU-SATUNYA mesin gambar
// denah. Dipakai penampil (mode "lihat", Task 2) dan builder (mode "edit",
// Task 3). Builder menambah perilaku edit lewat prop (onPointerDown/Move/Up,
// overlay, terpilihIds, sorotIds), BUKAN dengan menyalin kode gambar.
//
// Sistem koordinat: semua gambar dalam UNIT GRID (lihat src/lib/produksi-denah.ts).
// Pan/zoom = viewBox SVG: tampilan.x/y = titik grid di pojok kiri atas
// viewport, tampilan.skala = piksel layar per unit grid.
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
import { Fan, Lock, Maximize, Minus, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  kotakElemen,
  type AreaElemen,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type LabelElemen,
  type MesinElemen,
  type Titik,
} from "@/lib/produksi-denah";

// ---------- API publik ----------

export type ModeKanvas = "lihat" | "edit";

export interface Tampilan {
  x: number; // unit grid di tepi kiri viewport
  y: number; // unit grid di tepi atas viewport
  skala: number; // piksel layar per unit grid
}

export interface InfoPointerKanvas {
  event: React.PointerEvent<SVGSVGElement>;
  titik: Titik; // posisi kursor dalam unit grid (belum di-snap)
  elemenId: string | null; // elemen di bawah kursor saat pointerdown/move
  kolomId: string | null; // kolom bak di bawah kursor (elemenId = bak induknya)
}

export interface KonteksOverlay {
  tampilan: Tampilan;
  unitPerPx: number; // 1 piksel layar dalam unit grid (untuk handle berukuran tetap)
  lebarPx: number;
  tinggiPx: number;
}

export interface DenahKanvasHandle {
  pasKeLayar(): void;
  zoomMasuk(): void;
  zoomKeluar(): void;
  /** Konversi koordinat layar (clientX/Y) ke unit grid. */
  keGrid(clientX: number, clientY: number): Titik;
  /** Pusatkan viewport ke kotak (unit grid), zoom secukupnya. */
  fokusKe(kotak: { x: number; y: number; w: number; h: number }): void;
  /** Geser viewport agar titik grid ini di tengah (zoom tetap). */
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
  /** Lapisan SVG tambahan di atas elemen, dalam unit grid (handle, kotak seleksi, garis bantu, hantu alat). */
  overlay?: (ctx: KonteksOverlay) => ReactNode;
  /** Konten HTML melayang di atas kanvas (toolbar, legenda). */
  children?: ReactNode;
  /** Tombol zoom +/−/pas bawaan di pojok kanan bawah. */
  kontrolZoom?: boolean;
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
}

// ---------- Konstanta ----------

const SKALA_MIN = 1;
const SKALA_MAX = 200;
const AMBANG_GESER_PX = 4;
const MARGIN_PAS = 2; // unit grid di sekeliling kanvas saat "pas ke layar"
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
  onPilihElemen,
  onPilihKolom,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  overlay,
  children,
  kontrolZoom = true,
  className,
  ref,
  kursor,
  geserSementara = null,
  hoverId = null,
  tumpukIds = KOSONG,
  kolomSorotIds = KOSONG,
  onTampilanBerubah,
}: DenahKanvasProps) {
  const idDasar = useId().replace(/[^a-zA-Z0-9]/g, "");
  const wadahRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [ukuran, setUkuran] = useState<{ w: number; h: number } | null>(null);
  const [tampilanState, setTampilanState] = useState<Tampilan | null>(null);
  const [sedangGeser, setSedangGeser] = useState(false);
  const { kanvas, elemen } = dokumen;

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
              hover={hoverId === e.id}
              tumpuk={tumpukIds.has(e.id)}
              kolomTerpilih={bakDenganKolomTerpilih.has(e.id) ? kolomTerpilihIds : KOSONG}
              kolomSorot={bakDenganKolomSorot.has(e.id) ? kolomSorotIds : KOSONG}
              skalaKira={skalaKira}
              ukuranGrid={kanvas.ukuranGrid}
              idPola={idDasar}
              mode={mode}
            />
          </g>
        );
      }),
    [
      elemen,
      geserSementara,
      terpilihIds,
      sorotIds,
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
        <pattern id={`${idPola}-nonaktif`} width={0.6} height={0.6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width={0.6} height={0.6} className="fill-muted" />
          <line x1={0} y1={0} x2={0} y2={0.6} className="stroke-muted-foreground/60" strokeWidth={0.18} />
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
  hover: boolean;
  tumpuk: boolean;
  kolomTerpilih: ReadonlySet<string>;
  kolomSorot: ReadonlySet<string>;
  skalaKira: number;
  ukuranGrid: number;
  idPola: string;
  mode: ModeKanvas;
}

// Ukuran teks nama (unit grid): ±11 px di layar, dibatasi agar tidak raksasa/hilang.
function ukuranNama(skalaKira: number) {
  return batasi(11 / skalaKira, 0.6, 3);
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
      // Titik derek dalam koordinat grid ABSOLUT (bukan relatif elemen) — tidak ikut rotasi.
      return <DerekView d={e} terpilih={p.terpilih} sorot={p.sorot} hover={p.hover} fs={fs} />;
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
      <GarisPilih kotak={kotak} terpilih={p.terpilih} sorot={p.sorot} hover={p.hover} />
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
  hover = false,
}: {
  kotak: { x: number; y: number; w: number; h: number };
  terpilih: boolean;
  sorot: boolean;
  hover?: boolean;
}) {
  if (!terpilih && !sorot && !hover) return null;
  const pad = 0.25;
  return (
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
  );
}

// ---------- Bak ----------

// Tata letak kolom dalam ruang (a, b): a = sumbu deret kolom, b = sumbu
// sepanjang satu kolom. horizontal: kolom berjajar ke samping (a = x, setiap
// kolom berupa lajur tegak); vertikal: kolom bertumpuk ke bawah (a = y).
function tataBak(bak: BakElemen) {
  const horizontal = bak.orientasiKolom === "horizontal";
  const pad = Math.min(0.4, Math.min(bak.w, bak.h) * 0.06);
  const panjangA = (horizontal ? bak.w : bak.h) - pad * 2;
  const panjangB = (horizontal ? bak.h : bak.w) - pad * 2;
  const n = Math.max(1, bak.kolom.length);
  const lebarKolom = panjangA / n;
  const pita = Math.min(panjangB * 0.2, 1.4); // pita nomor kolom di pangkal lajur
  const ke = (a: number, b: number, da: number, db: number) =>
    horizontal ? { x: pad + a, y: pad + b, w: da, h: db } : { x: pad + b, y: pad + a, w: db, h: da };
  return { horizontal, pad, panjangA, panjangB, lebarKolom, pita, ke };
}

function posisiKolom(bak: BakElemen, i: number) {
  return bak.arahNomor === "mundur" ? bak.kolom.length - 1 - i : i;
}

function pathIceCan(bak: BakElemen, tata: ReturnType<typeof tataBak>): { kecil: string; besar: string } {
  const bagian = { kecil: [] as string[], besar: [] as string[] };
  const { lebarKolom, panjangB, pita, ke } = tata;
  const lajurB = panjangB - pita;
  const f = (v: number) => Math.round(v * 1000) / 1000;
  bak.kolom.forEach((k, i) => {
    if (k.nonaktif || k.jumlahIceCan <= 0) return;
    const n = k.jumlahIceCan;
    const lintang = Math.max(1, Math.round(Math.sqrt((n * lebarKolom) / Math.max(lajurB, 0.001))));
    const bujur = Math.ceil(n / lintang);
    const sel = Math.min(lebarKolom / lintang, lajurB / bujur);
    const sisi = sel * 0.72;
    const a0 = posisiKolom(bak, i) * lebarKolom + (lebarKolom - sel * lintang) / 2;
    const b0 = pita + (lajurB - sel * bujur) / 2;
    const out = bagian[k.varian];
    for (let j = 0; j < n; j++) {
      const r = ke(a0 + (j % lintang) * sel + (sel - sisi) / 2, b0 + Math.floor(j / lintang) * sel + (sel - sisi) / 2, sisi, sisi);
      out.push(`M${f(r.x)} ${f(r.y)}h${f(r.w)}v${f(r.h)}h${f(-r.w)}z`);
    }
  });
  return { kecil: bagian.kecil.join(""), besar: bagian.besar.join("") };
}

function ukuranSelIceCan(bak: BakElemen, tata: ReturnType<typeof tataBak>) {
  const lajurB = tata.panjangB - tata.pita;
  const n = bak.kolom.reduce((m, k) => Math.max(m, k.jumlahIceCan), 1);
  const lintang = Math.max(1, Math.round(Math.sqrt((n * tata.lebarKolom) / Math.max(lajurB, 0.001))));
  return Math.min(tata.lebarKolom / lintang, lajurB / Math.ceil(n / lintang));
}

function BakTubuh({ bak, kolomTerpilih, kolomSorot, skalaKira, idPola }: { bak: BakElemen } & ElemenViewProps) {
  const tata = useMemo(() => tataBak(bak), [bak]);
  const { lebarKolom, panjangB, pita, ke } = tata;
  const tampilIceCan = ukuranSelIceCan(bak, tata) * skalaKira >= 3;
  const iceCan = useMemo(() => (tampilIceCan ? pathIceCan(bak, tata) : null), [bak, tata, tampilIceCan]);
  const celah = lebarKolom * skalaKira >= 5 ? lebarKolom * 0.08 : 0;
  const fsNomor = Math.min(lebarKolom * 0.55, pita * 0.75, 1.1);
  const tampilNomor = fsNomor * skalaKira >= 7;
  const radius = Math.min(bak.w, bak.h) * 0.08;
  const lawanRotasi = bak.rotasi ? (cx: number, cy: number) => `rotate(${-bak.rotasi} ${cx} ${cy})` : () => undefined;

  return (
    <>
      <rect
        width={bak.w}
        height={bak.h}
        rx={radius}
        className="fill-slate-200 stroke-slate-500 dark:fill-slate-800 dark:stroke-slate-400"
        strokeWidth={1.5}
        vectorEffect={NS}
      />
      {bak.kolom.map((k, i) => {
        const r = ke(posisiKolom(bak, i) * lebarKolom + celah / 2, 0, Math.max(lebarKolom - celah, 0.0001), panjangB);
        const pilih = kolomTerpilih.has(k.id);
        const salah = kolomSorot.has(k.id);
        return (
          <rect
            key={k.id}
            data-kolom-id={k.id}
            x={r.x}
            y={r.y}
            width={r.w}
            height={r.h}
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
      {iceCan?.kecil && <path d={iceCan.kecil} className={KELAS_ICE_CAN.kecil} pointerEvents="none" />}
      {iceCan?.besar && <path d={iceCan.besar} className={KELAS_ICE_CAN.besar} pointerEvents="none" />}
      {tampilNomor &&
        bak.kolom.map((k, i) => {
          const r = ke(posisiKolom(bak, i) * lebarKolom, 0, lebarKolom, pita);
          const cx = r.x + r.w / 2;
          const cy = r.y + r.h / 2;
          return (
            <Teks key={k.id} x={cx} y={cy} ukuran={fsNomor} transform={lawanRotasi(cx, cy)} className={k.nonaktif ? "fill-muted-foreground" : undefined}>
              {k.nomor}
            </Teks>
          );
        })}
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

function DerekView({ d, terpilih, sorot, hover, fs }: { d: DerekElemen; terpilih: boolean; sorot: boolean; hover: boolean; fs: number }) {
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
  const r = Math.max(0.35, fs * 0.35);
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
      <GarisPilih kotak={kotakElemen(d)} terpilih={terpilih} sorot={sorot} hover={hover} />
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
