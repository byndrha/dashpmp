"use client";

// Panel properti Builder Denah: isian per tipe elemen, aksi seleksi
// (putar/kunci/lapisan/duplikat/hapus/ratakan), dan pengaturan kanvas bila
// tidak ada yang dipilih.

import { memo, useState, type Dispatch } from "react";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  ArrowLeftRight,
  BringToFront,
  Copy,
  ListOrdered,
  Lock,
  LockOpen,
  Plus,
  RotateCcw,
  RotateCw,
  SendToBack,
  Trash2,
  TriangleAlert,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  kotakElemen,
  ringkasDenah,
  BATAS_KANVAS,
  BATAS_TITIK_JALUR,
  FLUIDA_BAWAAN,
  PRESET_ICE_CAN,
  type AreaElemen,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type DimensiIceCan,
  type Fluida,
  type JalurElemen,
  type JenisTangki,
  type KategoriMesin,
  type LabelElemen,
  type MesinElemen,
  type TangkiElemen,
  type Varian,
} from "@/lib/produksi-denah";
import { segmenJalur, segmenTertanam, tataBakMeter } from "@/lib/produksi-denah-geometri";
import {
  NAMA_TIPE,
  PILIHAN_LANGKAH_SNAP,
  kapasitasSiklusKg,
  normalisasiUtara,
  panjangJalur,
  type AksiBuilder,
  type SisiRata,
} from "@/components/produksi-denah/builder-state";
import { Bidang, Centang, InputAngka, InputTeks, Judul, Pilihan, Segmen, TombolKecil } from "@/components/produksi-denah/bidang";
import { formatAngka, formatMeter } from "@/components/produksi-denah/format";
import { MawarAngin } from "@/components/produksi-denah/mawar-angin";

const angka = new Intl.NumberFormat("id-ID");

interface Props {
  dok: DenahDokumen;
  terpilih: DenahElemen[];
  dispatch: Dispatch<AksiBuilder>;
  onKeKolom: () => void;
  /** Elevasi kerja (m) — state builder, bukan dokumen; z bawaan alat Jalur. */
  elevasiKerja: number;
  onUbahElevasiKerja: (m: number) => void;
}

export const PanelProperti = memo(function PanelProperti({ dok, terpilih, dispatch, onKeKolom, elevasiKerja, onUbahElevasiKerja }: Props) {
  if (terpilih.length === 0) return <PropertiKanvas dok={dok} dispatch={dispatch} elevasiKerja={elevasiKerja} onUbahElevasiKerja={onUbahElevasiKerja} />;
  if (terpilih.length > 1) return <PropertiBanyak elemen={terpilih} dispatch={dispatch} />;
  const e = terpilih[0];
  return (
    <div className="flex flex-col gap-3">
      <KepalaElemen e={e} dispatch={dispatch} />
      <IsianKhusus e={e} dok={dok} dispatch={dispatch} onKeKolom={onKeKolom} />
      <Geometri e={e} dispatch={dispatch} />
      <ElevasiTinggi e={e} dispatch={dispatch} />
    </div>
  );
});

// ---------- Kepala + aksi ----------

function KepalaElemen({ e, dispatch }: { e: DenahElemen; dispatch: Dispatch<AksiBuilder> }) {
  const ids = [e.id];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase">{NAMA_TIPE[e.tipe]}</span>
        {e.terkunci && (
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Lock className="size-3" /> Terkunci
          </span>
        )}
      </div>
      <Bidang label="Nama">
        <InputTeks
          nilai={e.nama}
          invalid={!e.nama.trim()}
          onUbah={(nama) => dispatch({ type: "ubahElemen", id: e.id, patch: { nama }, gabung: `${e.id}:nama` })}
          onSelesai={() => dispatch({ type: "putusGabung" })}
        />
      </Bidang>
      <AksiSeleksi ids={ids} terkunci={!!e.terkunci} dispatch={dispatch} />
    </div>
  );
}

function AksiSeleksi({ ids, terkunci, dispatch }: { ids: string[]; terkunci: boolean; dispatch: Dispatch<AksiBuilder> }) {
  return (
    <div className="flex flex-wrap gap-1">
      <TombolKecil title="Putar 90° (R)" disabled={terkunci} onClick={() => dispatch({ type: "putar", ids })}>
        <RotateCw />
      </TombolKecil>
      <TombolKecil title={terkunci ? "Buka kunci (L)" : "Kunci (L)"} aktif={terkunci} onClick={() => dispatch({ type: "kunci", ids, terkunci: !terkunci })}>
        {terkunci ? <Lock /> : <LockOpen />}
      </TombolKecil>
      <TombolKecil title="Ke depan (])" onClick={() => dispatch({ type: "urutan", ids, ke: "depan" })}>
        <BringToFront />
      </TombolKecil>
      <TombolKecil title="Ke belakang ([)" onClick={() => dispatch({ type: "urutan", ids, ke: "belakang" })}>
        <SendToBack />
      </TombolKecil>
      <TombolKecil title="Duplikat (Ctrl+D)" onClick={() => dispatch({ type: "duplikat", ids })}>
        <Copy />
      </TombolKecil>
      <TombolKecil title="Hapus (Delete)" bahaya onClick={() => dispatch({ type: "hapus", ids })}>
        <Trash2 />
      </TombolKecil>
    </div>
  );
}

// ---------- Geometri ----------

function Geometri({ e, dispatch }: { e: DenahElemen; dispatch: Dispatch<AksiBuilder> }) {
  const k = kotakElemen(e);
  const kunci = !!e.terkunci;
  if (e.tipe === "derek" || e.tipe === "jalur") return null; // derek & jalur diatur lewat titiknya
  return (
    <div className="flex flex-col gap-2">
      <Judul>Posisi & ukuran denah</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="X">
          <InputAngka nilai={k.x} bulat={false} satuan="m" disabled={kunci} onUbah={(x) => dispatch({ type: "pindah", ids: [e.id], dx: x - k.x, dy: 0 })} />
        </Bidang>
        <Bidang label="Y">
          <InputAngka nilai={k.y} bulat={false} satuan="m" disabled={kunci} onUbah={(y) => dispatch({ type: "pindah", ids: [e.id], dx: 0, dy: y - k.y })} />
        </Bidang>
        <Bidang label="Panjang (X)">
          <InputAngka nilai={k.w} bulat={false} min={0.05} satuan="m" disabled={kunci} onUbah={(w) => dispatch({ type: "aturKotak", id: e.id, kotak: { ...k, w } })} />
        </Bidang>
        <Bidang label="Lebar (Y)">
          <InputAngka nilai={k.h} bulat={false} min={0.05} satuan="m" disabled={kunci} onUbah={(h) => dispatch({ type: "aturKotak", id: e.id, kotak: { ...k, h } })} />
        </Bidang>
      </div>
      <Bidang label="Rotasi">
        <Segmen
          nilai={String(e.rotasi) as "0" | "90" | "180" | "270"}
          pilihan={[
            { nilai: "0", label: "0°" },
            { nilai: "90", label: "90°" },
            { nilai: "180", label: "180°" },
            { nilai: "270", label: "270°" },
          ]}
          onUbah={(v) => {
            if (!kunci) dispatch({ type: "ubahElemen", id: e.id, patch: { rotasi: Number(v) as DenahElemen["rotasi"] } });
          }}
        />
      </Bidang>
    </div>
  );
}

// ---------- Elevasi & tinggi (meter, 0 = muka lantai jadi) ----------

const LABEL_VERTIKAL: Partial<Record<DenahElemen["tipe"], { elevasi: string; tinggi: string | null; petunjuk?: string }>> = {
  bak: { elevasi: "Elevasi dasar bak", tinggi: "Kedalaman total", petunjuk: "Negatif = tertanam di bawah lantai. Bibir bak = elevasi + kedalaman." },
  mesin: { elevasi: "Elevasi dasar", tinggi: "Tinggi" },
  dinding: { elevasi: "Elevasi dasar", tinggi: "Tinggi dinding" },
  pintu: { elevasi: "Elevasi dasar", tinggi: "Tinggi pintu" },
  area: { elevasi: "Elevasi lantai", tinggi: null, petunjuk: "Lantai turun/naik, mis. lubang pit (negatif)." },
  beton: { elevasi: "Elevasi dasar", tinggi: "Tebal / tinggi beton" },
  tangki: { elevasi: "Elevasi dasar", tinggi: "Tinggi tangki" },
};

function ElevasiTinggi({ e, dispatch }: { e: DenahElemen; dispatch: Dispatch<AksiBuilder> }) {
  // Derek diatur di isiannya sendiri (tinggi rel/kait); jalur memakai z per titik; label tanpa ketinggian.
  const lbl = LABEL_VERTIKAL[e.tipe];
  if (!lbl) return null;
  const ubah = (patch: Partial<DenahElemen>, kunci: string) => dispatch({ type: "ubahElemen", id: e.id, patch, gabung: `${e.id}:${kunci}` });
  const bibir = e.tipe === "bak" ? e.elevasiM + e.tinggiM : null;
  return (
    <div className="flex flex-col gap-2">
      <Judul>Ketinggian (±0,00 = muka lantai)</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label={lbl.elevasi}>
          <InputAngka nilai={e.elevasiM} bulat={false} min={-50} max={100} satuan="m" onUbah={(elevasiM) => ubah({ elevasiM }, "elevasi")} />
        </Bidang>
        {lbl.tinggi && (
          <Bidang label={lbl.tinggi}>
            <InputAngka nilai={e.tinggiM} bulat={false} min={0.01} max={100} satuan="m" onUbah={(tinggiM) => ubah({ tinggiM }, "tinggi")} />
          </Bidang>
        )}
      </div>
      {(lbl.petunjuk || bibir !== null) && (
        <p className="text-[10px] leading-tight text-muted-foreground">
          {lbl.petunjuk}
          {bibir !== null && <> Bibir saat ini: <b className="font-medium text-foreground">{formatMeter(bibir)}</b>.</>}
        </p>
      )}
    </div>
  );
}

// ---------- Isian per tipe ----------

function IsianKhusus({ e, dok, dispatch, onKeKolom }: { e: DenahElemen; dok: DenahDokumen; dispatch: Dispatch<AksiBuilder>; onKeKolom: () => void }) {
  switch (e.tipe) {
    case "bak":
      return <IsianBak bak={e} dok={dok} dispatch={dispatch} onKeKolom={onKeKolom} />;
    case "mesin":
      return <IsianMesin m={e} dok={dok} dispatch={dispatch} />;
    case "derek":
      return <IsianDerek d={e} dok={dok} dispatch={dispatch} />;
    case "area":
      return <IsianArea a={e} dispatch={dispatch} />;
    case "label":
      return <IsianLabel l={e} dispatch={dispatch} />;
    case "tangki":
      return <IsianTangki t={e} dispatch={dispatch} />;
    case "jalur":
      return <IsianJalur j={e} dok={dok} dispatch={dispatch} />;
    default:
      return null;
  }
}

function IsianBak({ bak, dok, dispatch, onKeKolom }: { bak: BakElemen; dok: DenahDokumen; dispatch: Dispatch<AksiBuilder>; onKeKolom: () => void }) {
  const [konfirmasi, setKonfirmasi] = useState(false);
  const ubah = (patch: Partial<BakElemen>) => dispatch({ type: "ubahElemen", id: bak.id, patch });
  const mesin = dok.elemen.filter((x): x is MesinElemen => x.tipe === "mesin");
  const r = ringkasDenah({ ...dok, elemen: [bak] });
  const beda = bak.kolom.filter((k) => k.varian !== bak.varianBawaan || k.jumlahIceCan !== bak.iceCanPerKolomBawaan).length;

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-1 rounded-md border bg-muted/40 p-2 text-center">
        <Statistik label="Kolom" nilai={bak.kolom.length} />
        <Statistik label="Ice can K" nilai={r.iceCanKecil} />
        <Statistik label="Ice can B" nilai={r.iceCanBesar} />
      </div>

      <Judul aksi={<TombolKecil onClick={onKeKolom} title="Atur kolom satu per satu">Atur kolom →</TombolKecil>}>Kolom</Judul>
      <Bidang label="Jumlah kolom" petunjuk="Ditambah/dikurangi dari ujung; ID kolom yang tetap ada tidak berubah.">
        <InputAngka nilai={bak.kolom.length} min={1} max={1000} stepper onUbah={(n) => dispatch({ type: "ubahJumlahKolom", bakId: bak.id, n })} />
      </Bidang>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Orientasi kolom">
          <Segmen
            nilai={bak.orientasiKolom}
            pilihan={[
              { nilai: "horizontal", label: "Mendatar" },
              { nilai: "vertikal", label: "Tegak" },
            ]}
            onUbah={(orientasiKolom) => ubah({ orientasiKolom })}
          />
        </Bidang>
        <Bidang label="Arah nomor">
          <Segmen
            nilai={bak.arahNomor}
            pilihan={[
              { nilai: "maju", label: "1 → n" },
              { nilai: "mundur", label: "n ← 1" },
            ]}
            onUbah={(arahNomor) => ubah({ arahNomor })}
          />
        </Bidang>
      </div>

      <Judul>Bawaan kolom</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Varian bawaan">
          <Segmen
            nilai={bak.varianBawaan}
            pilihan={[
              { nilai: "kecil", label: "Kecil" },
              { nilai: "besar", label: "Besar" },
            ]}
            onUbah={(varianBawaan) => ubah({ varianBawaan })}
          />
        </Bidang>
        <Bidang label="Ice can / kolom">
          <InputAngka nilai={bak.iceCanPerKolomBawaan} min={1} max={200} onUbah={(iceCanPerKolomBawaan) => ubah({ iceCanPerKolomBawaan })} />
        </Bidang>
      </div>
      <Button variant="outline" size="sm" className="h-auto min-h-8 w-full whitespace-normal" disabled={beda === 0} onClick={() => setKonfirmasi(true)}>
        <WandSparkles /> Terapkan ke semua kolom{beda > 0 ? ` (${beda} beda)` : ""}
      </Button>
      <TombolKecil onClick={() => dispatch({ type: "nomoriUlang", bakId: bak.id })} title="Nomori ulang kolom 1..n mengikuti urutan">
        <ListOrdered /> Nomori ulang kolom
      </TombolKecil>

      <IsianBakFisik bak={bak} dispatch={dispatch} />

      <Judul>Produksi</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Durasi beku Kecil">
          <InputAngka nilai={bak.durasiBekuJam.kecil} min={0} bulat={false} satuan="jam" onUbah={(kecil) => ubah({ durasiBekuJam: { ...bak.durasiBekuJam, kecil } })} />
        </Bidang>
        <Bidang label="Durasi beku Besar">
          <InputAngka nilai={bak.durasiBekuJam.besar} min={0} bulat={false} satuan="jam" onUbah={(besar) => ubah({ durasiBekuJam: { ...bak.durasiBekuJam, besar } })} />
        </Bidang>
      </div>
      <Bidang label="Kolom per panen">
        <InputAngka nilai={bak.kolomPerPanen} min={0} max={1000} onUbah={(kolomPerPanen) => ubah({ kolomPerPanen })} />
      </Bidang>
      <Bidang label="Mesin yang melayani">
        {mesin.length === 0 ? (
          <span className="text-xs text-muted-foreground">Belum ada mesin di denah. Taruh dengan alat Mesin (M).</span>
        ) : (
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {mesin.map((m) => (
              <Centang
                key={m.id}
                nilai={bak.mesinIds.includes(m.id)}
                label={m.nama || "(tanpa nama)"}
                onUbah={(v) => ubah({ mesinIds: v ? [...bak.mesinIds, m.id] : bak.mesinIds.filter((x) => x !== m.id) })}
              />
            ))}
          </div>
        )}
      </Bidang>
      <Bidang label="Catatan">
        <InputTeks
          multiBaris
          nilai={bak.catatan}
          onUbah={(catatan) => dispatch({ type: "ubahElemen", id: bak.id, patch: { catatan }, gabung: `${bak.id}:catatan` })}
          onSelesai={() => dispatch({ type: "putusGabung" })}
        />
      </Bidang>

      <Dialog open={konfirmasi} onOpenChange={setKonfirmasi}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Terapkan bawaan ke semua kolom?</DialogTitle>
            <DialogDescription>
              Semua {bak.kolom.length} kolom &quot;{bak.nama}&quot; akan diatur ke varian {bak.varianBawaan === "kecil" ? "Kecil" : "Besar"} dengan{" "}
              {bak.iceCanPerKolomBawaan} ice can. {beda} kolom saat ini berbeda. Bisa dibatalkan dengan Ctrl+Z. Kolom yang masih berisi es akan
              ditolak saat menyimpan.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setKonfirmasi(false)}>
              Batal
            </Button>
            <Button
              onClick={() => {
                dispatch({ type: "terapkanBawaan", bakId: bak.id });
                setKonfirmasi(false);
              }}
            >
              Terapkan
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------- Bak: dinding, brine, jarak, ice can ----------

function dimensiSama(a: Omit<DimensiIceCan, "presetId">, b: Omit<DimensiIceCan, "presetId">) {
  return a.panjangMm === b.panjangMm && a.lebarMm === b.lebarMm && a.tinggiMm === b.tinggiMm && a.beratKg === b.beratKg;
}

/** ID preset yang tampil di select: presetId bila masih cocok dengan dimensinya, selain itu "kustom". */
function presetAktif(d: DimensiIceCan): string {
  const p = PRESET_ICE_CAN.find((x) => x.id === d.presetId);
  return p && p.id !== "kustom" && dimensiSama(p, d) ? p.id : "kustom";
}

const PILIHAN_PRESET = PRESET_ICE_CAN.map((p) => ({
  nilai: p.id,
  label: p.id === "kustom" ? p.label : `${p.label} · ${p.panjangMm}×${p.lebarMm}×${p.tinggiMm}`,
}));

function IsianBakFisik({ bak, dispatch }: { bak: BakElemen; dispatch: Dispatch<AksiBuilder> }) {
  const ubah = (patch: Partial<BakElemen>, kunci: string) => dispatch({ type: "ubahElemen", id: bak.id, patch, gabung: `${bak.id}:${kunci}` });
  const tata = tataBakMeter(bak);
  const lebihA = tata.butuhA > tata.ruangA + 1e-9;
  const lebihB = tata.butuhB > tata.ruangB + 1e-9;
  const ubahIceCan = (varian: Varian, d: DimensiIceCan) => dispatch({ type: "ubahElemen", id: bak.id, patch: { iceCan: { ...bak.iceCan, [varian]: d } } });

  return (
    <div className="flex flex-col gap-2">
      <Judul>Dinding & brine</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Tebal dinding">
          <InputAngka nilai={bak.tebalDindingM} bulat={false} min={0} max={5} satuan="m" onUbah={(tebalDindingM) => ubah({ tebalDindingM }, "tebal")} />
        </Bidang>
        <Bidang label="Level brine">
          <InputAngka nilai={bak.levelBrineM} bulat={false} min={0} max={bak.tinggiM} satuan="m" onUbah={(levelBrineM) => ubah({ levelBrineM }, "brine")} />
        </Bidang>
        <Bidang label="Jarak antar-kolom">
          <InputAngka nilai={bak.jarakAntarKolomMm} min={0} max={2000} satuan="mm" onUbah={(jarakAntarKolomMm) => ubah({ jarakAntarKolomMm }, "jarakKolom")} />
        </Bidang>
        <Bidang label="Jarak antar-can">
          <InputAngka nilai={bak.jarakAntarCanMm} min={0} max={2000} satuan="mm" onUbah={(jarakAntarCanMm) => ubah({ jarakAntarCanMm }, "jarakCan")} />
        </Bidang>
      </div>
      <p className="text-[10px] leading-tight text-muted-foreground">Level brine diukur dari dasar bak.</p>

      <Judul>Ukuran ice can</Judul>
      {(["kecil", "besar"] as const).map((v) => (
        <IsianIceCan key={v} varian={v} d={bak.iceCan[v]} onUbah={(d) => ubahIceCan(v, d)} />
      ))}
      <p className="flex items-start gap-1.5 rounded-md border border-amber-500/40 bg-amber-500/10 p-2 text-[11px] leading-snug text-amber-800 dark:text-amber-300">
        <TriangleAlert className="mt-0.5 size-3.5 shrink-0" />
        <span>Ukur cetakan nyata di lapangan; variasi ±5 cm. Ukuran preset = bibir atas cetakan (tirus).</span>
      </p>

      <div className="flex flex-col gap-1 rounded-md border bg-muted/40 p-2 text-xs tabular-nums">
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Kapasitas per siklus</span>
          <b className="font-semibold">{formatAngka(kapasitasSiklusKg(bak))} kg</b>
        </div>
        <div className="flex justify-between gap-2">
          <span className="text-muted-foreground">Ruang terpakai</span>
          <span className={cn("text-right", (lebihA || lebihB) && "font-medium text-destructive")}>
            <span className={lebihA ? "text-destructive" : undefined}>
              {formatAngka(tata.butuhA)}/{formatAngka(tata.ruangA)}
            </span>
            {" × "}
            <span className={lebihB ? "text-destructive" : undefined}>
              {formatAngka(tata.butuhB)}/{formatAngka(tata.ruangB)}
            </span>{" "}
            m
          </span>
        </div>
        {(lebihA || lebihB) && <div className="text-[10px] text-destructive">Kolom/ice can melebihi ruang dalam bak (diarsir merah di kanvas).</div>}
      </div>
    </div>
  );
}

function IsianIceCan({ varian, d, onUbah }: { varian: Varian; d: DimensiIceCan; onUbah: (d: DimensiIceCan) => void }) {
  const preset = presetAktif(d);
  // Mengubah angka secara manual = ukuran kustom.
  const angkaUbah = (patch: Partial<DimensiIceCan>) => onUbah({ ...d, ...patch, presetId: "kustom" });
  return (
    <div className="flex flex-col gap-1.5 rounded-md border p-2">
      <div className="flex items-center gap-2">
        <span className="w-12 shrink-0 text-[11px] font-medium">{varian === "kecil" ? "Kecil" : "Besar"}</span>
        <Pilihan
          ariaLabel={`Preset ice can ${varian}`}
          nilai={preset}
          pilihan={PILIHAN_PRESET}
          onUbah={(id) => {
            const p = PRESET_ICE_CAN.find((x) => x.id === id);
            if (!p) return;
            if (p.id === "kustom") onUbah({ ...d, presetId: "kustom" });
            else onUbah({ panjangMm: p.panjangMm, lebarMm: p.lebarMm, tinggiMm: p.tinggiMm, beratKg: p.beratKg, presetId: p.id });
          }}
        />
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        <Bidang label="P">
          <InputAngka nilai={d.panjangMm} min={1} max={5000} satuan="mm" onUbah={(panjangMm) => angkaUbah({ panjangMm })} />
        </Bidang>
        <Bidang label="L">
          <InputAngka nilai={d.lebarMm} min={1} max={5000} satuan="mm" onUbah={(lebarMm) => angkaUbah({ lebarMm })} />
        </Bidang>
        <Bidang label="T">
          <InputAngka nilai={d.tinggiMm} min={1} max={5000} satuan="mm" onUbah={(tinggiMm) => angkaUbah({ tinggiMm })} />
        </Bidang>
        <Bidang label="Berat">
          <InputAngka nilai={d.beratKg} min={0.1} max={10000} bulat={false} satuan="kg" onUbah={(beratKg) => angkaUbah({ beratKg })} />
        </Bidang>
      </div>
    </div>
  );
}

function Statistik({ label, nilai }: { label: string; nilai: number }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums">{angka.format(nilai)}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function IsianMesin({ m, dok, dispatch }: { m: MesinElemen; dok: DenahDokumen; dispatch: Dispatch<AksiBuilder> }) {
  const teks = (field: "jenis" | "kapasitas" | "catatan", label: string, multiBaris = false) => (
    <Bidang label={label}>
      <InputTeks
        multiBaris={multiBaris}
        nilai={m[field] ?? ""}
        onUbah={(v) => dispatch({ type: "ubahElemen", id: m.id, patch: { [field]: v }, gabung: `${m.id}:${field}` })}
        onSelesai={() => dispatch({ type: "putusGabung" })}
      />
    </Bidang>
  );
  const dilayani = dok.elemen.filter((e): e is BakElemen => e.tipe === "bak" && e.mesinIds.includes(m.id));
  return (
    <div className="flex flex-col gap-2">
      <Bidang label="Kategori" petunjuk="Menentukan lapisan & warna di mode 3D.">
        <Pilihan<KategoriMesin>
          nilai={m.kategori}
          pilihan={[
            { nilai: "refrigerasi", label: "Refrigerasi" },
            { nilai: "pompa", label: "Pompa" },
            { nilai: "listrik", label: "Listrik" },
            { nilai: "lainnya", label: "Lainnya" },
          ]}
          onUbah={(kategori) => dispatch({ type: "ubahElemen", id: m.id, patch: { kategori } })}
        />
      </Bidang>
      {teks("jenis", "Jenis")}
      {teks("kapasitas", "Kapasitas")}
      {teks("catatan", "Catatan", true)}
      <Bidang label="Melayani bak">
        <span className="text-xs">{dilayani.length ? dilayani.map((b) => b.nama).join(", ") : <span className="text-muted-foreground">Belum ada — atur dari panel bak.</span>}</span>
      </Bidang>
    </div>
  );
}

function IsianDerek({ d, dok, dispatch }: { d: DerekElemen; dok: DenahDokumen; dispatch: Dispatch<AksiBuilder> }) {
  const bak = dok.elemen.filter((x): x is BakElemen => x.tipe === "bak");
  const kunci = !!d.terkunci;
  const atur = (titikAwal: DerekElemen["titikAwal"], titikAkhir: DerekElemen["titikAkhir"]) => dispatch({ type: "aturTitikDerek", id: d.id, titikAwal, titikAkhir });
  const panjang = Math.hypot(d.titikAkhir.x - d.titikAwal.x, d.titikAkhir.y - d.titikAwal.y);
  const ubah = (patch: Partial<DerekElemen>, k: string) => dispatch({ type: "ubahElemen", id: d.id, patch, gabung: `${d.id}:${k}` });
  return (
    <div className="flex flex-col gap-2">
      <Judul>Rel · panjang {formatMeter(panjang)}</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Titik A — X">
          <InputAngka nilai={d.titikAwal.x} bulat={false} satuan="m" disabled={kunci} onUbah={(x) => atur({ ...d.titikAwal, x }, d.titikAkhir)} />
        </Bidang>
        <Bidang label="Titik A — Y">
          <InputAngka nilai={d.titikAwal.y} bulat={false} satuan="m" disabled={kunci} onUbah={(y) => atur({ ...d.titikAwal, y }, d.titikAkhir)} />
        </Bidang>
        <Bidang label="Titik B — X">
          <InputAngka nilai={d.titikAkhir.x} bulat={false} satuan="m" disabled={kunci} onUbah={(x) => atur(d.titikAwal, { ...d.titikAkhir, x })} />
        </Bidang>
        <Bidang label="Titik B — Y">
          <InputAngka nilai={d.titikAkhir.y} bulat={false} satuan="m" disabled={kunci} onUbah={(y) => atur(d.titikAwal, { ...d.titikAkhir, y })} />
        </Bidang>
      </div>
      <Judul>Ketinggian (±0,00 = muka lantai)</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Tinggi rel">
          <InputAngka nilai={d.elevasiM} bulat={false} min={0} max={100} satuan="m" onUbah={(elevasiM) => ubah({ elevasiM }, "elevasi")} />
        </Bidang>
        <Bidang label="Tinggi kait">
          <InputAngka nilai={d.tinggiKaitM} bulat={false} min={0} max={100} satuan="m" onUbah={(tinggiKaitM) => ubah({ tinggiKaitM }, "kait")} />
        </Bidang>
        <Bidang label="Tinggi balok rel">
          <InputAngka nilai={d.tinggiM} bulat={false} min={0.01} max={10} satuan="m" onUbah={(tinggiM) => ubah({ tinggiM }, "tinggi")} />
        </Bidang>
      </div>
      <p className="text-[10px] leading-tight text-muted-foreground">
        Tinggi kait = jarak rel → dasar kait saat terangkat penuh. Dasar kait: <b className="font-medium text-foreground">{formatMeter(d.elevasiM - d.tinggiKaitM)}</b>.
      </p>
      <Bidang label="Bak yang dilayani">
        {bak.length === 0 ? (
          <span className="text-xs text-muted-foreground">Belum ada bak di denah.</span>
        ) : (
          <div className="flex max-h-32 flex-col gap-1 overflow-y-auto rounded-md border p-2">
            {bak.map((b) => (
              <Centang
                key={b.id}
                nilai={d.bakIds.includes(b.id)}
                label={b.nama || "(tanpa nama)"}
                onUbah={(v) => dispatch({ type: "ubahElemen", id: d.id, patch: { bakIds: v ? [...d.bakIds, b.id] : d.bakIds.filter((x) => x !== b.id) } })}
              />
            ))}
          </div>
        )}
      </Bidang>
    </div>
  );
}

const WARNA_AREA = ["#10b981", "#0ea5e9", "#f59e0b", "#ef4444", "#8b5cf6", "#64748b"];

function IsianArea({ a, dispatch }: { a: AreaElemen; dispatch: Dispatch<AksiBuilder> }) {
  return (
    <Bidang label="Warna">
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          title="Bawaan"
          onClick={() => dispatch({ type: "ubahElemen", id: a.id, patch: { warna: undefined } })}
          className={`size-6 rounded-full border bg-emerald-500/20 text-[9px] ${!a.warna ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
        >
          ∅
        </button>
        {WARNA_AREA.map((w) => (
          <button
            key={w}
            type="button"
            title={w}
            aria-label={`Warna ${w}`}
            onClick={() => dispatch({ type: "ubahElemen", id: a.id, patch: { warna: w } })}
            style={{ background: w }}
            className={`size-6 rounded-full border ${a.warna === w ? "ring-2 ring-primary ring-offset-1 ring-offset-background" : ""}`}
          />
        ))}
        <input
          type="color"
          value={a.warna && /^#[0-9a-f]{6}$/i.test(a.warna) ? a.warna : "#10b981"}
          onChange={(e) => dispatch({ type: "ubahElemen", id: a.id, patch: { warna: e.target.value }, gabung: `${a.id}:warna` })}
          className="h-6 w-8 cursor-pointer rounded border bg-transparent"
          title="Warna lain"
        />
      </div>
    </Bidang>
  );
}

function IsianLabel({ l, dispatch }: { l: LabelElemen; dispatch: Dispatch<AksiBuilder> }) {
  return (
    <div className="flex flex-col gap-2">
      <Bidang label="Teks">
        <InputTeks
          nilai={l.teks}
          onUbah={(teks) => dispatch({ type: "ubahElemen", id: l.id, patch: { teks }, gabung: `${l.id}:teks` })}
          onSelesai={() => dispatch({ type: "putusGabung" })}
        />
      </Bidang>
      <Bidang label="Ukuran huruf" petunjuk="Piksel pada zoom 100%. Kosong = mengikuti tinggi kotak.">
        <InputAngka nilai={l.ukuranHuruf ?? null} min={4} max={400} satuan="px" placeholder="otomatis" onUbah={(ukuranHuruf) => dispatch({ type: "ubahElemen", id: l.id, patch: { ukuranHuruf } })}
          onKosong={() => dispatch({ type: "ubahElemen", id: l.id, patch: { ukuranHuruf: undefined } })}
        />
      </Bidang>
    </div>
  );
}

const PILIHAN_JENIS_TANGKI: { nilai: JenisTangki; label: string }[] = [
  { nilai: "tandon", label: "Tandon air" },
  { nilai: "filling", label: "Bak filling (isi ice can)" },
  { nilai: "thawing", label: "Bak thawing (lepas es)" },
  { nilai: "sumur", label: "Sumur" },
  { nilai: "cooling-tower", label: "Cooling tower" },
  { nilai: "lainnya", label: "Lainnya" },
];

function IsianTangki({ t, dispatch }: { t: TangkiElemen; dispatch: Dispatch<AksiBuilder> }) {
  const ubah = (patch: Partial<TangkiElemen>, kunci?: string) => dispatch({ type: "ubahElemen", id: t.id, patch, gabung: kunci ? `${t.id}:${kunci}` : undefined });
  // Volume geometris dari ukuran denah (silinder = elips w × h) — sekadar acuan.
  const volume = (t.bentuk === "silinder" ? (Math.PI * t.w * t.h) / 4 : t.w * t.h) * t.tinggiM;
  return (
    <div className="flex flex-col gap-2">
      <Bidang label="Jenis" petunjuk="Filling & thawing masuk lapisan Proses; lainnya lapisan Air.">
        <Pilihan<JenisTangki> nilai={t.jenis} pilihan={PILIHAN_JENIS_TANGKI} ariaLabel="Jenis tangki" onUbah={(jenis) => ubah({ jenis })} />
      </Bidang>
      <Bidang label="Bentuk">
        <Segmen<TangkiElemen["bentuk"]>
          nilai={t.bentuk}
          pilihan={[
            { nilai: "kotak", label: "Kotak" },
            { nilai: "silinder", label: "Silinder" },
          ]}
          onUbah={(bentuk) => ubah({ bentuk })}
        />
      </Bidang>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Kapasitas">
          <InputAngka
            nilai={t.kapasitasM3 ?? null}
            bulat={false}
            min={0}
            max={100000}
            satuan="m³"
            placeholder="—"
            onUbah={(kapasitasM3) => ubah({ kapasitasM3 }, "kapasitas")}
            onKosong={() => ubah({ kapasitasM3: undefined })}
          />
        </Bidang>
        <Bidang label="Level isi">
          <InputAngka nilai={t.levelIsiPersen} min={0} max={100} satuan="%" onUbah={(levelIsiPersen) => ubah({ levelIsiPersen }, "level")} />
        </Bidang>
      </div>
      <p className="text-[10px] leading-tight text-muted-foreground">
        Volume dari ukuran denah ≈ <b className="font-medium text-foreground">{formatAngka(volume)} m³</b>. Level isi hanya untuk tampilan.
      </p>
    </div>
  );
}

// ---------- Jalur (pipa & kabel) ----------

export const PILIHAN_FLUIDA: { nilai: Fluida; label: string }[] = [
  { nilai: "air-baku", label: "Air baku" },
  { nilai: "air-pendingin", label: "Air pendingin" },
  { nilai: "air-thawing", label: "Air thawing" },
  { nilai: "drain", label: "Drain / buangan" },
  { nilai: "brine", label: "Brine" },
  { nilai: "nh3-cair", label: "NH3 cair" },
  { nilai: "nh3-gas", label: "NH3 gas" },
  { nilai: "udara", label: "Udara" },
];

export const PILIHAN_SISTEM_KABEL: { nilai: "daya" | "kontrol"; label: string }[] = [
  { nilai: "daya", label: "Kabel daya" },
  { nilai: "kontrol", label: "Kabel kontrol" },
];

function IsianJalur({ j, dok, dispatch }: { j: JalurElemen; dok: DenahDokumen; dispatch: Dispatch<AksiBuilder> }) {
  const kunci = !!j.terkunci;
  const ubah = (patch: Partial<JalurElemen>, k?: string) => dispatch({ type: "ubahElemen", id: j.id, patch, gabung: k ? `${j.id}:${k}` : undefined });
  const aturTitik = (titik: JalurElemen["titik"]) => ubah({ titik });
  const ubahTitik = (i: number, sumbu: "x" | "y" | "z", v: number) => aturTitik(j.titik.map((t, n) => (n === i ? { ...t, [sumbu]: v } : t)));
  const tambahTitik = () => {
    const akhir = j.titik[j.titik.length - 1] ?? { x: 0, y: 0, z: 0 };
    aturTitik([...j.titik, { x: akhir.x + 1, y: akhir.y, z: akhir.z }]);
  };
  const hapusTitik = (i: number) => aturTitik(j.titik.filter((_, n) => n !== i));
  const lain = dok.elemen.filter((e) => e.id !== j.id);
  const pilihanUjung = [{ nilai: "", label: "— tidak tersambung —" }, ...lain.map((e) => ({ nilai: e.id, label: `${e.nama || "(tanpa nama)"} · ${NAMA_TIPE[e.tipe]}` }))];
  const tertanam = segmenJalur(j).map((s) => segmenTertanam(s, dok));
  return (
    <div className="flex flex-col gap-2">
      <Bidang label="Jenis">
        <Segmen<JalurElemen["jenis"]>
          nilai={j.jenis}
          pilihan={[
            { nilai: "pipa", label: "Pipa" },
            { nilai: "kabel", label: "Kabel" },
          ]}
          onUbah={(jenis) => {
            if (jenis === j.jenis) return;
            ubah(jenis === "kabel" ? { jenis, sistem: j.sistem ?? "daya", fluida: undefined } : { jenis, fluida: j.fluida ?? FLUIDA_BAWAAN, sistem: undefined });
          }}
        />
      </Bidang>
      <div className="grid grid-cols-2 gap-2">
        {j.jenis === "pipa" ? (
          <Bidang label="Fluida">
            <Pilihan<Fluida> nilai={j.fluida ?? FLUIDA_BAWAAN} pilihan={PILIHAN_FLUIDA} ariaLabel="Fluida" onUbah={(fluida) => ubah({ fluida })} />
          </Bidang>
        ) : (
          <Bidang label="Sistem">
            <Pilihan<"daya" | "kontrol"> nilai={j.sistem ?? "daya"} pilihan={PILIHAN_SISTEM_KABEL} ariaLabel="Sistem kabel" onUbah={(sistem) => ubah({ sistem })} />
          </Bidang>
        )}
        <Bidang label="Diameter">
          <InputAngka nilai={j.diameterMm} min={1} max={2000} satuan="mm" onUbah={(diameterMm) => ubah({ diameterMm }, "diameter")} />
        </Bidang>
      </div>
      <Bidang label="Dari (ujung awal)">
        <Pilihan<string> nilai={j.dariId ?? ""} pilihan={pilihanUjung} ariaLabel="Elemen ujung awal" onUbah={(v) => ubah({ dariId: v || undefined })} />
      </Bidang>
      <Bidang label="Ke (ujung akhir)">
        <Pilihan<string> nilai={j.keId ?? ""} pilihan={pilihanUjung} ariaLabel="Elemen ujung akhir" onUbah={(v) => ubah({ keId: v || undefined })} />
      </Bidang>
      <Button variant="outline" size="sm" disabled={kunci || j.titik.length < 2} onClick={() => dispatch({ type: "balikJalur", id: j.id })}>
        <ArrowLeftRight /> Balik arah aliran
      </Button>
      <Judul aksi={<span className="text-[10px] text-muted-foreground tabular-nums">{formatMeter(panjangJalur(j))}</span>}>Titik (urutan = arah aliran)</Judul>
      <div className="flex flex-col gap-1">
        <div className="grid grid-cols-[1.25rem_1fr_1fr_1fr_1.75rem] items-center gap-1 text-[10px] text-muted-foreground">
          <span>#</span>
          <span>X (m)</span>
          <span>Y (m)</span>
          <span>Z (m)</span>
          <span />
        </div>
        {j.titik.map((t, i) => (
          <div key={i} className="flex flex-col gap-1">
            {i > 0 && tertanam[i - 1] && (
              <div className="ml-5 inline-flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-400">
                <span className="inline-block h-0 w-4 border-t-2 border-dashed border-current" /> Tertanam di beton
              </div>
            )}
            <div className="grid grid-cols-[1.25rem_1fr_1fr_1fr_1.75rem] items-center gap-1">
              <span className="text-[10px] text-muted-foreground tabular-nums">{i + 1}</span>
              <InputAngka nilai={t.x} bulat={false} disabled={kunci} onUbah={(v) => ubahTitik(i, "x", v)} />
              <InputAngka nilai={t.y} bulat={false} disabled={kunci} onUbah={(v) => ubahTitik(i, "y", v)} />
              <InputAngka nilai={t.z} bulat={false} min={-50} max={100} disabled={kunci} onUbah={(v) => ubahTitik(i, "z", v)} />
              <TombolKecil title={j.titik.length <= 2 ? "Jalur minimal 2 titik" : `Hapus titik ${i + 1}`} bahaya disabled={kunci || j.titik.length <= 2} onClick={() => hapusTitik(i)}>
                <Trash2 />
              </TombolKecil>
            </div>
          </div>
        ))}
        <Button variant="ghost" size="sm" disabled={kunci || j.titik.length >= BATAS_TITIK_JALUR} onClick={tambahTitik}>
          <Plus /> Tambah titik
        </Button>
      </div>
      <p className="text-[10px] leading-tight text-muted-foreground">
        Z = ketinggian sumbu jalur dari ±0,00. Segmen di pelat lantai (z −{formatAngka(dok.kanvas.pelatLantai.tebalM)} m s/d 0) atau di dalam beton ditandai tertanam.
      </p>
    </div>
  );
}

// ---------- Banyak elemen ----------

const RATA: { sisi: SisiRata; label: string; Ikon: typeof AlignStartVertical }[] = [
  { sisi: "kiri", label: "Rata kiri", Ikon: AlignStartVertical },
  { sisi: "tengahH", label: "Rata tengah (mendatar)", Ikon: AlignCenterVertical },
  { sisi: "kanan", label: "Rata kanan", Ikon: AlignEndVertical },
  { sisi: "atas", label: "Rata atas", Ikon: AlignStartHorizontal },
  { sisi: "tengahV", label: "Rata tengah (tegak)", Ikon: AlignCenterHorizontal },
  { sisi: "bawah", label: "Rata bawah", Ikon: AlignEndHorizontal },
];

function PropertiBanyak({ elemen, dispatch }: { elemen: DenahElemen[]; dispatch: Dispatch<AksiBuilder> }) {
  const ids = elemen.map((e) => e.id);
  const perTipe = new Map<string, number>();
  for (const e of elemen) perTipe.set(NAMA_TIPE[e.tipe], (perTipe.get(NAMA_TIPE[e.tipe]) ?? 0) + 1);
  const semuaKunci = elemen.every((e) => e.terkunci);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">{elemen.length} elemen terpilih</div>
        <div className="text-xs text-muted-foreground">{[...perTipe].map(([t, n]) => `${n} ${t}`).join(" · ")}</div>
      </div>
      <AksiSeleksi ids={ids} terkunci={semuaKunci} dispatch={dispatch} />
      <Judul>Ratakan</Judul>
      <div className="flex flex-wrap gap-1">
        {RATA.map(({ sisi, label, Ikon }) => (
          <TombolKecil key={sisi} title={label} onClick={() => dispatch({ type: "ratakan", ids, sisi })}>
            <Ikon />
          </TombolKecil>
        ))}
      </div>
      <p className="text-[11px] text-muted-foreground">Elemen terkunci tidak ikut digeser, diputar, atau diratakan.</p>
    </div>
  );
}

// ---------- Kanvas ----------

function PropertiKanvas({
  dok,
  dispatch,
  elevasiKerja,
  onUbahElevasiKerja,
}: {
  dok: DenahDokumen;
  dispatch: Dispatch<AksiBuilder>;
  elevasiKerja: number;
  onUbahElevasiKerja: (m: number) => void;
}) {
  const r = ringkasDenah(dok);
  const kv = dok.kanvas;
  const aturUtara = (derajat: number) => dispatch({ type: "ubahKanvas", kanvas: { utaraDerajat: normalisasiUtara(derajat) } });
  const langkahSah = PILIHAN_LANGKAH_SNAP.some((l) => l === kv.langkahSnapM);
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">Pengaturan denah</div>
        <div className="text-xs text-muted-foreground">Tidak ada elemen terpilih. Pilih alat di kiri lalu klik atau tarik di kanvas.</div>
      </div>
      <Judul>Lahan</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Panjang lahan (X)">
          <InputAngka nilai={kv.lebar} bulat={false} min={10} max={BATAS_KANVAS} satuan="m" onUbah={(lebar) => dispatch({ type: "ubahKanvas", kanvas: { lebar } })} />
        </Bidang>
        <Bidang label="Lebar lahan (Y)">
          <InputAngka nilai={kv.tinggi} bulat={false} min={10} max={BATAS_KANVAS} satuan="m" onUbah={(tinggi) => dispatch({ type: "ubahKanvas", kanvas: { tinggi } })} />
        </Bidang>
      </div>
      <Bidang label="Arah utara" petunjuk="Derajat searah jarum jam dari atas kanvas (0 = utara ke atas).">
        <div className="flex items-center gap-1.5">
          <TombolKecil title="Putar utara −15°" onClick={() => aturUtara(kv.utaraDerajat - 15)}>
            <RotateCcw />
          </TombolKecil>
          <div className="min-w-0 flex-1">
            <InputAngka nilai={kv.utaraDerajat} satuan="°" onUbah={aturUtara} />
          </div>
          <TombolKecil title="Putar utara +15°" onClick={() => aturUtara(kv.utaraDerajat + 15)}>
            <RotateCw />
          </TombolKecil>
          <MawarAngin utaraDerajat={kv.utaraDerajat} ukuran={36} className="shrink-0" />
        </div>
      </Bidang>
      <Judul>Konstruksi & snap</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Tebal pelat lantai">
          <InputAngka
            nilai={kv.pelatLantai.tebalM}
            bulat={false}
            min={0}
            max={5}
            satuan="m"
            onUbah={(tebalM) => dispatch({ type: "ubahKanvas", kanvas: { pelatLantai: { ...kv.pelatLantai, tebalM } } })}
          />
        </Bidang>
        <Bidang label="Langkah snap">
          <Pilihan
            ariaLabel="Langkah snap"
            nilai={String(kv.langkahSnapM)}
            pilihan={[
              ...PILIHAN_LANGKAH_SNAP.map((l) => ({ nilai: String(l), label: formatMeter(l) })),
              ...(langkahSah ? [] : [{ nilai: String(kv.langkahSnapM), label: formatMeter(kv.langkahSnapM) }]),
            ]}
            onUbah={(v) => dispatch({ type: "ubahKanvas", kanvas: { langkahSnapM: Number(v) } })}
          />
        </Bidang>
      </div>
      <Bidang label="Elevasi kerja" petunjuk="Ketinggian z bawaan untuk titik alat Jalur. Hanya di builder ini, tidak disimpan di denah.">
        <InputAngka nilai={elevasiKerja} bulat={false} min={-50} max={100} satuan="m" onUbah={onUbahElevasiKerja} />
      </Bidang>
      <Bidang label="Ukuran grid" petunjuk="Piksel per meter pada zoom 100% (tampilan saja).">
        <InputAngka nilai={kv.ukuranGrid} min={4} max={200} satuan="px" onUbah={(ukuranGrid) => dispatch({ type: "ubahKanvas", kanvas: { ukuranGrid } })} />
      </Bidang>
      <Judul>Ringkasan</Judul>
      <div className="grid grid-cols-2 gap-1 rounded-md border bg-muted/40 p-2 text-center">
        <Statistik label="Bak" nilai={r.jumlahBak} />
        <Statistik label="Kolom" nilai={r.jumlahKolom} />
        <Statistik label="Ice can Kecil" nilai={r.iceCanKecil} />
        <Statistik label="Ice can Besar" nilai={r.iceCanBesar} />
        <Statistik label="Mesin" nilai={r.jumlahMesin} />
        <Statistik label="Elemen" nilai={dok.elemen.length} />
      </div>
      <p className="text-[11px] text-muted-foreground">
        Tekan <kbd className="rounded border px-1 font-mono">?</kbd> untuk daftar pintasan keyboard.
      </p>
    </div>
  );
}
