// src/lib/queries/inventaris-vendor.ts
import { getPgPool } from "@/lib/pg";

export interface VendorInput {
  nama: string;
  npwp: string | null;
  npwpAlamat: string | null;
  catatan: string | null;
}

export interface VendorRow {
  id: number;
  nama: string;
  npwp: string | null;
  npwpAlamat: string | null;
  catatan: string | null;
  isAktif: boolean;
}

export interface VendorLokasiInput {
  namaLokasi: string;
  alamat: string | null;
  kota: string | null;
  kontak: string | null;
}

export interface VendorLokasiRow extends VendorLokasiInput {
  id: number;
  vendorId: number;
}

export interface VendorPicInput {
  nama: string;
  jabatan: string | null;
  telepon: string | null;
  email: string | null;
}

export interface VendorPicRow extends VendorPicInput {
  id: number;
  vendorId: number;
  urutan: number;
}

export interface VendorPicInternalRow {
  id: number;
  vendorId: number;
  perusahaanId: number;
  akunId: number;
  akunNama: string;
  perusahaanNama: string;
}

export async function listVendor(): Promise<VendorRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, nama, npwp, npwp_alamat, catatan, is_aktif FROM vendor ORDER BY nama`
  );
  return result.rows.map((r) => ({
    id: r.id,
    nama: r.nama,
    npwp: r.npwp,
    npwpAlamat: r.npwp_alamat,
    catatan: r.catatan,
    isAktif: r.is_aktif,
  }));
}

export async function getVendor(id: number): Promise<VendorRow | null> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, nama, npwp, npwp_alamat, catatan, is_aktif FROM vendor WHERE id = $1`,
    [id]
  );
  if (result.rows.length === 0) return null;
  const r = result.rows[0];
  return { id: r.id, nama: r.nama, npwp: r.npwp, npwpAlamat: r.npwp_alamat, catatan: r.catatan, isAktif: r.is_aktif };
}

export async function createVendor(input: VendorInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor (nama, npwp, npwp_alamat, catatan) VALUES ($1, $2, $3, $4) RETURNING id`,
    [input.nama, input.npwp, input.npwpAlamat, input.catatan]
  );
  return result.rows[0].id as number;
}

export async function updateVendor(id: number, input: VendorInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor SET nama = $1, npwp = $2, npwp_alamat = $3, catatan = $4, updated_at = now() WHERE id = $5`,
    [input.nama, input.npwp, input.npwpAlamat, input.catatan, id]
  );
}

export async function listVendorLokasi(vendorId: number): Promise<VendorLokasiRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, vendor_id, nama_lokasi, alamat, kota, kontak FROM vendor_lokasi WHERE vendor_id = $1 ORDER BY id`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    namaLokasi: r.nama_lokasi,
    alamat: r.alamat,
    kota: r.kota,
    kontak: r.kontak,
  }));
}

export async function addVendorLokasi(vendorId: number, input: VendorLokasiInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_lokasi (vendor_id, nama_lokasi, alamat, kota, kontak) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vendorId, input.namaLokasi, input.alamat, input.kota, input.kontak]
  );
  return result.rows[0].id as number;
}

export async function updateVendorLokasi(id: number, input: VendorLokasiInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_lokasi SET nama_lokasi = $1, alamat = $2, kota = $3, kontak = $4 WHERE id = $5`,
    [input.namaLokasi, input.alamat, input.kota, input.kontak, id]
  );
}

export async function deleteVendorLokasi(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_lokasi WHERE id = $1`, [id]);
}

// urutan=0 is reserved for the "PIC utama" whose nama/telepon feed
// BusinessPartner.ContactPerson/MobileNo on sync (see Task 5).
export async function listVendorPic(vendorId: number): Promise<VendorPicRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT id, vendor_id, nama, jabatan, telepon, email, urutan FROM vendor_pic WHERE vendor_id = $1 ORDER BY urutan`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    nama: r.nama,
    jabatan: r.jabatan,
    telepon: r.telepon,
    email: r.email,
    urutan: r.urutan,
  }));
}

// Always assigns the next available urutan (current max + 1, starting at 0)
// — callers can never set urutan directly (VendorPicInput has no such
// field), so a fresh PIC only ever becomes urutan=0 when it's the vendor's
// first one.
export async function addVendorPic(vendorId: number, input: VendorPicInput): Promise<number> {
  const pool = getPgPool();
  const maxRes = await pool.query(`SELECT COALESCE(MAX(urutan), -1) AS max_urutan FROM vendor_pic WHERE vendor_id = $1`, [vendorId]);
  const nextUrutan = (maxRes.rows[0].max_urutan as number) + 1;
  const result = await pool.query(
    `INSERT INTO vendor_pic (vendor_id, nama, jabatan, telepon, email, urutan) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
    [vendorId, input.nama, input.jabatan, input.telepon, input.email, nextUrutan]
  );
  return result.rows[0].id as number;
}

export async function updateVendorPic(id: number, input: VendorPicInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_pic SET nama = $1, jabatan = $2, telepon = $3, email = $4 WHERE id = $5`,
    [input.nama, input.jabatan, input.telepon, input.email, id]
  );
}

// KNOWN LIMITATION (currently unenforced by design — not a Task 3 concern):
// this is an unconditional delete with no protection for urutan=0. Deleting
// the "PIC utama" row is possible and will leave the vendor with no primary
// PIC until a new one happens to get created (which becomes urutan=0 again
// only if it's the sole remaining PIC). Task 5's MSSQL sync and Task 8's
// Server Actions already null-check `picList.find(p => p.urutan === 0)` and
// handle "no primary PIC found" gracefully, so this degrades acceptably —
// but any UI (Task 10) or business logic that wants to *prevent* deleting
// the last/only primary PIC must implement that guard itself; it does not
// exist at this query layer.
export async function deleteVendorPic(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pic WHERE id = $1`, [id]);
}

export async function listVendorPicInternal(vendorId: number): Promise<VendorPicInternalRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vpi.id, vpi.vendor_id, vpi.perusahaan_id, vpi.akun_id, a.nama AS akun_nama, p.nama AS perusahaan_nama
     FROM vendor_pic_internal vpi
     JOIN akun a ON a.id = vpi.akun_id
     JOIN perusahaan p ON p.id = vpi.perusahaan_id
     WHERE vpi.vendor_id = $1
     ORDER BY p.nama, a.nama`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    perusahaanId: r.perusahaan_id,
    akunId: r.akun_id,
    akunNama: r.akun_nama,
    perusahaanNama: r.perusahaan_nama,
  }));
}

export async function addVendorPicInternal(vendorId: number, perusahaanId: number, akunId: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `INSERT INTO vendor_pic_internal (vendor_id, perusahaan_id, akun_id) VALUES ($1, $2, $3)
     ON CONFLICT (vendor_id, perusahaan_id, akun_id) DO NOTHING`,
    [vendorId, perusahaanId, akunId]
  );
}

export async function removeVendorPicInternal(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_pic_internal WHERE id = $1`, [id]);
}
