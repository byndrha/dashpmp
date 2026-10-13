// Pembatas laju sederhana (jendela geser, dalam memori) untuk tautan publik
// /kartu. Cukup untuk satu instance dashpmp; bila diskalakan >1 instance,
// batasnya per-instance (tetap melindungi dari tebakan token).

export interface Pembatas {
  coba(kunci: string, sekarang?: number): boolean; // true = diizinkan
}

export function buatPembatas(maks: number, jendelaMs: number): Pembatas {
  const peta = new Map<string, number[]>();
  return {
    coba(kunci, sekarang = Date.now()) {
      const batas = sekarang - jendelaMs;
      const arr = (peta.get(kunci) ?? []).filter((t) => t > batas);
      if (arr.length >= maks) {
        peta.set(kunci, arr);
        return false;
      }
      arr.push(sekarang);
      peta.set(kunci, arr);
      if (peta.size > 5000) {
        for (const [k, v] of peta) if (v.every((t) => t <= batas)) peta.delete(k);
      }
      return true;
    },
  };
}

// Semua permintaan /kartu: 120 per 10 menit per IP; percobaan token TIDAK
// valid: 10 per 10 menit per IP (menghalangi enumerasi).
export const batasUmum = buatPembatas(120, 10 * 60 * 1000);
export const batasTokenGagal = buatPembatas(10, 10 * 60 * 1000);

export function ipDari(h: { get(n: string): string | null }): string {
  const xf = h.get("x-forwarded-for");
  return (xf ? xf.split(",")[0] : h.get("x-real-ip") ?? "tak-dikenal").trim().slice(0, 64);
}
