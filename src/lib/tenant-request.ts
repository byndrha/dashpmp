import { cache } from "react";
import { unstable_rethrow } from "next/navigation";
import { eskristalKode, tenantEskristalKodes } from "@/lib/tenant";

// Perusahaan Es Kristal untuk request ini: scope akun yang login bila ia
// tenant yang dilayani deployment ini (mis. "demokristal"), selain itu
// eskristalKode() bawaan. Akun PMP (mkesindo, direktur, superadmin lintas PT)
// selalu mendapat bawaan.
//
// Di luar request (pemindai latar instrumentation.ts, skrip tsx) tidak ada
// sesi -> bawaan. cache() menghindari auth() berulang dalam satu render.
export const currentEskristalKode = cache(async (): Promise<string> => {
  if (!process.env.NEXT_RUNTIME) return eskristalKode();
  try {
    const { auth } = await import("@/lib/auth");
    const scope = (await auth())?.user?.accountScope;
    if (scope && tenantEskristalKodes().includes(scope)) return scope;
  } catch (err) {
    // WAJIB diteruskan: headers() saat prerender melempar sinyal "halaman
    // ini dinamis". Bila ditelan, halaman dirender statis dengan data
    // tenant bawaan lalu disajikan ke semua pengguna.
    unstable_rethrow(err);
  }
  return eskristalKode();
});
