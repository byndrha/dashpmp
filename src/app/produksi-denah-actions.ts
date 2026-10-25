"use server";

// Server action Builder Denah Produksi Es Balok (PMPersada & PMPakis).
// File "use server": HANYA mengekspor fungsi async (lihat
// src/lib/__tests__/use-server-exports.test.ts). Tipe diimpor langsung dari
// src/lib/produksi-denah.ts / src/lib/queries/produksi-denah.ts.
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { bolehEditDenah } from "@/lib/permissions";
import { canAccessGrup } from "@/lib/require-access";
import { isPmpDeployment } from "@/lib/tenant";
import { validasiBentukDenah, type DenahDokumen } from "@/lib/produksi-denah";
import { simpanDenah, type KodeProduksi } from "@/lib/queries/produksi-denah";

const KODE_SAH: readonly string[] = ["pmpersada", "pmpakis"];

export async function simpanDenahAction(
  kode: KodeProduksi,
  data: DenahDokumen,
  versiDasar: number | null
): Promise<ActionResult<{ versi: number }>> {
  return runAction(async () => {
    const session = await auth();
    if (!session?.user) throw new AppError("Sesi berakhir. Silakan masuk kembali.");
    const user = session.user;

    // Input client tidak dipercaya: kode harus persis salah satu pabrik.
    if (typeof kode !== "string" || !KODE_SAH.includes(kode)) throw new AppError("Perusahaan tidak dikenal.");
    if (!isPmpDeployment() || (user.accountScope !== kode && !canAccessGrup(user))) {
      throw new AppError("Anda tidak punya akses ke perusahaan ini.");
    }
    if (!bolehEditDenah(user)) throw new AppError("Anda tidak punya izin mengubah denah produksi.");

    if (versiDasar !== null && !(typeof versiDasar === "number" && Number.isInteger(versiDasar) && versiDasar >= 1)) {
      throw new AppError("Versi denah tidak sah. Muat ulang halaman.");
    }
    const galatBentuk = validasiBentukDenah(data);
    if (galatBentuk) throw new AppError(galatBentuk);

    const hasil = await simpanDenah(kode, data, versiDasar, user.id);
    revalidatePath(`/${kode}/produksi`);
    revalidatePath(`/${kode}/produksi/denah`);
    return hasil;
  });
}
