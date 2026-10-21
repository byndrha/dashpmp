// Satu deployment melayani satu holding utama, ditambah tenant Es Kristal
// tambahan yang diizinkan lewat env. Deployment produksi PMP:
//   (kosong)                               -> hanya holding "pmp"
//   TENANT_TAMBAHAN=demo:demokristal       -> juga melayani holding "demo",
//                                             yang akunnya ber-scope "demokristal"
// Deployment khusus satu holding (mis. demo di VPS sendiri):
//   DEPLOYMENT_HOLDING_KODE=demo
//   ESKRISTAL_PERUSAHAAN_KODE=demokristal
// Database yang dipakai route tree /mkesindo dipilih PER SESI (lihat
// src/lib/tenant-request.ts); file ini hanya konfigurasi, tanpa import apa
// pun, karena dipakai juga oleh middleware.ts (Edge runtime).

// Scope akun yang merupakan PT/holding milik PMP Group. Hanya scope ini yang
// boleh membuka halaman lintas PT (/grup, inventaris, PT Es Balok).
export const PMP_SCOPES: readonly string[] = ["mkesindo", "direktur", "pmputra", "pmpersada", "pmpakis"];

// Holding utama deployment ini (holding.kode).
export function deploymentHoldingKode(): string {
  return process.env.DEPLOYMENT_HOLDING_KODE || "pmp";
}

// Perusahaan Es Kristal bawaan route tree /mkesindo: dipakai untuk akun
// holding utama, dan untuk semua proses tanpa sesi login (pemindai latar,
// webhook, halaman publik invoice/kartu).
export function eskristalKode(): string {
  return process.env.ESKRISTAL_PERUSAHAAN_KODE || "mkesindo";
}

function tenantTambahan(): { holding: string; eskristal: string }[] {
  return (process.env.TENANT_TAMBAHAN || "")
    .split(",")
    .map((s) => s.trim().split(":"))
    .filter((p) => p.length === 2 && p[0] && p[1])
    .map(([holding, eskristal]) => ({ holding: holding.trim(), eskristal: eskristal.trim() }));
}

// Semua holding yang akunnya boleh login di deployment ini.
export function allowedHoldingKodes(): string[] {
  return [deploymentHoldingKode(), ...tenantTambahan().map((t) => t.holding)];
}

// Semua accountScope yang dilayani route tree /mkesindo di deployment ini.
export function tenantEskristalKodes(): string[] {
  return [eskristalKode(), ...tenantTambahan().map((t) => t.eskristal)];
}

// Deployment produksi PMP Group: satu-satunya yang punya halaman lintas PT
// (/grup, inventaris, PT Es Balok, PT switcher), karena halaman itu membaca
// semua PT milik PMP sekaligus.
export function isPmpDeployment(): boolean {
  return deploymentHoldingKode() === "pmp";
}

// Akses lintas PT untuk satu akun: deployment PMP DAN akun itu sendiri milik
// PMP. Superadmin perusahaan tenant tambahan tidak pernah lolos.
export function isPmpScope(accountScope: string | undefined | null): boolean {
  return !!accountScope && PMP_SCOPES.includes(accountScope);
}
