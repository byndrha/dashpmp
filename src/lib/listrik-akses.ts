import { auth } from "@/lib/auth";
import { AppError } from "@/lib/action-result";
import { canAccessAllPT, canAccessGrup } from "@/lib/require-access";
import { bolehKelolaProduksi, canView } from "@/lib/permissions";
import { currentEskristalKode } from "@/lib/tenant-request";

// Gerbang akses modul Kelistrikan (aksi + rute unggah foto).

export const KODE_ES_BALOK = ["pmputra", "pmpersada", "pmpakis"];

type Hak = "catat" | "kelola";

/**
 * Catat meter: operator produksi PT itu, akun PT itu dengan akses modul,
 * atau Direktur/superadmin. Kelola (pengaturan tarif, batalkan pembacaan):
 * bukan operator biasa.
 */
export async function sesiListrik(kode: string, hak: Hak) {
  const session = await auth();
  if (!session?.user) throw new AppError("Sesi berakhir — silakan masuk lagi.");
  const u = session.user;
  const esBalok = KODE_ES_BALOK.includes(kode);
  if (!esBalok && kode !== (await currentEskristalKode()))
    throw new AppError("Perusahaan tidak dikenal.");

  let boleh: boolean;
  if (esBalok) {
    boleh =
      canAccessGrup(u) ||
      (u.accountScope === kode &&
        (hak === "catat" || bolehKelolaProduksi(u) || !u.isProduksi));
  } else {
    boleh =
      canAccessAllPT(u) ||
      (u.accountScope === kode &&
        (canView(u.permissions, "electricity") ||
          (hak === "catat" && u.isProduksi === true)));
  }
  if (!boleh) throw new AppError("Anda tidak punya akses untuk tindakan ini.");
  return { akunId: String(u.id), nama: u.name ?? u.username };
}
