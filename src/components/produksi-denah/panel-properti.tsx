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
  BringToFront,
  Copy,
  ListOrdered,
  Lock,
  LockOpen,
  RotateCw,
  SendToBack,
  Trash2,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  kotakElemen,
  ringkasDenah,
  type AreaElemen,
  type BakElemen,
  type DenahDokumen,
  type DenahElemen,
  type DerekElemen,
  type LabelElemen,
  type MesinElemen,
} from "@/lib/produksi-denah";
import { NAMA_TIPE, type AksiBuilder, type SisiRata } from "@/components/produksi-denah/builder-state";
import { Bidang, Centang, InputAngka, InputTeks, Judul, Segmen, TombolKecil } from "@/components/produksi-denah/bidang";

const angka = new Intl.NumberFormat("id-ID");

interface Props {
  dok: DenahDokumen;
  terpilih: DenahElemen[];
  dispatch: Dispatch<AksiBuilder>;
  onKeKolom: () => void;
}

export const PanelProperti = memo(function PanelProperti({ dok, terpilih, dispatch, onKeKolom }: Props) {
  if (terpilih.length === 0) return <PropertiKanvas dok={dok} dispatch={dispatch} />;
  if (terpilih.length > 1) return <PropertiBanyak elemen={terpilih} dispatch={dispatch} />;
  const e = terpilih[0];
  return (
    <div className="flex flex-col gap-3">
      <KepalaElemen e={e} dispatch={dispatch} />
      <IsianKhusus e={e} dok={dok} dispatch={dispatch} onKeKolom={onKeKolom} />
      <Geometri e={e} dispatch={dispatch} />
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
  if (e.tipe === "derek") return null; // derek diatur lewat titiknya
  return (
    <div className="flex flex-col gap-2">
      <Judul>Posisi & ukuran (grid)</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="X">
          <InputAngka nilai={k.x} bulat={false} disabled={kunci} onUbah={(x) => dispatch({ type: "pindah", ids: [e.id], dx: x - k.x, dy: 0 })} />
        </Bidang>
        <Bidang label="Y">
          <InputAngka nilai={k.y} bulat={false} disabled={kunci} onUbah={(y) => dispatch({ type: "pindah", ids: [e.id], dx: 0, dy: y - k.y })} />
        </Bidang>
        <Bidang label="Lebar">
          <InputAngka nilai={k.w} bulat={false} min={0.5} disabled={kunci} onUbah={(w) => dispatch({ type: "aturKotak", id: e.id, kotak: { ...k, w } })} />
        </Bidang>
        <Bidang label="Tinggi">
          <InputAngka nilai={k.h} bulat={false} min={0.5} disabled={kunci} onUbah={(h) => dispatch({ type: "aturKotak", id: e.id, kotak: { ...k, h } })} />
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
  return (
    <div className="flex flex-col gap-2">
      <Judul>Rel (grid) · panjang {angka.format(Math.round(panjang * 10) / 10)}</Judul>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Titik A — X">
          <InputAngka nilai={d.titikAwal.x} bulat={false} disabled={kunci} onUbah={(x) => atur({ ...d.titikAwal, x }, d.titikAkhir)} />
        </Bidang>
        <Bidang label="Titik A — Y">
          <InputAngka nilai={d.titikAwal.y} bulat={false} disabled={kunci} onUbah={(y) => atur({ ...d.titikAwal, y }, d.titikAkhir)} />
        </Bidang>
        <Bidang label="Titik B — X">
          <InputAngka nilai={d.titikAkhir.x} bulat={false} disabled={kunci} onUbah={(x) => atur(d.titikAwal, { ...d.titikAkhir, x })} />
        </Bidang>
        <Bidang label="Titik B — Y">
          <InputAngka nilai={d.titikAkhir.y} bulat={false} disabled={kunci} onUbah={(y) => atur(d.titikAwal, { ...d.titikAkhir, y })} />
        </Bidang>
      </div>
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

function PropertiKanvas({ dok, dispatch }: { dok: DenahDokumen; dispatch: Dispatch<AksiBuilder> }) {
  const r = ringkasDenah(dok);
  const kv = dok.kanvas;
  return (
    <div className="flex flex-col gap-3">
      <div>
        <div className="text-sm font-medium">Kanvas denah</div>
        <div className="text-xs text-muted-foreground">Tidak ada elemen terpilih. Pilih alat di kiri lalu klik atau tarik di kanvas.</div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Bidang label="Lebar (grid)">
          <InputAngka nilai={kv.lebar} min={10} max={5000} onUbah={(lebar) => dispatch({ type: "ubahKanvas", kanvas: { lebar } })} />
        </Bidang>
        <Bidang label="Tinggi (grid)">
          <InputAngka nilai={kv.tinggi} min={10} max={5000} onUbah={(tinggi) => dispatch({ type: "ubahKanvas", kanvas: { tinggi } })} />
        </Bidang>
      </div>
      <Bidang label="Ukuran grid" petunjuk="Lebar satu kotak grid dalam piksel pada zoom 100%.">
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
