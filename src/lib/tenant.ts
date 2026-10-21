// Satu deployment = satu holding (tenant), lihat scripts/saas-migrate-holding.ts.
// Deployment produksi PMP memakai bawaan di bawah; deployment demo (VPS/
// subdomain terpisah) men-set:
//   DEPLOYMENT_HOLDING_KODE=demo
//   ESKRISTAL_PERUSAHAAN_KODE=demokristal
// Tanpa import apa pun -- dipakai juga oleh middleware.ts (Edge runtime).

// Holding yang akunnya boleh login di deployment ini (holding.kode).
export function deploymentHoldingKode(): string {
  return process.env.DEPLOYMENT_HOLDING_KODE || "pmp";
}

// Perusahaan Es Kristal yang dilayani route tree /mkesindo di deployment
// ini (Postgres perusahaan.kode, sekaligus accountScope akun-akunnya).
// Menentukan database MSSQL getPool(), id perusahaan untuk data Postgres
// per-perusahaan, dan folder Google Drive upload.
export function eskristalKode(): string {
  return process.env.ESKRISTAL_PERUSAHAAN_KODE || "mkesindo";
}

// Deployment produksi PMP Group: satu-satunya yang punya halaman lintas PT
// (/grup, inventaris, PT Es Balok, PT switcher), karena halaman itu membaca
// semua PT milik PMP sekaligus.
export function isPmpDeployment(): boolean {
  return deploymentHoldingKode() === "pmp";
}
