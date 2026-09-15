// src/lib/queries/inventaris-produk.ts
import { getPgPool } from "@/lib/pg";
import { AppError } from "@/lib/action-result";

export interface VendorKategoriRow {
  id: number;
  nama: string;
}

export async function listVendorKategori(): Promise<VendorKategoriRow[]> {
  const pool = getPgPool();
  const result = await pool.query(`SELECT id, nama FROM vendor_kategori ORDER BY nama`);
  return result.rows;
}

export async function createVendorKategori(nama: string): Promise<number> {
  const pool = getPgPool();
  try {
    const result = await pool.query(`INSERT INTO vendor_kategori (nama) VALUES ($1) RETURNING id`, [nama]);
    return result.rows[0].id as number;
  } catch (err) {
    if (err instanceof Error && "code" in err && (err as { code?: string }).code === "23505") {
      throw new AppError(`Kategori "${nama}" sudah ada.`);
    }
    throw err;
  }
}

export async function renameVendorKategori(id: number, nama: string): Promise<void> {
  const pool = getPgPool();
  await pool.query(`UPDATE vendor_kategori SET nama = $1 WHERE id = $2`, [nama, id]);
}

export async function deleteVendorKategori(id: number): Promise<void> {
  const pool = getPgPool();
  const inUse = await pool.query(`SELECT 1 FROM vendor_produk WHERE kategori_id = $1 LIMIT 1`, [id]);
  if ((inUse.rowCount ?? 0) > 0) {
    throw new AppError("Kategori ini masih dipakai oleh produk vendor — hapus/pindahkan produknya dulu.");
  }
  await pool.query(`DELETE FROM vendor_kategori WHERE id = $1`, [id]);
}

export interface VendorProdukInput {
  kategoriId: number;
  brand: string | null;
  model: string | null;
  spesifikasi: string | null;
}

export interface VendorProdukRow extends VendorProdukInput {
  id: number;
  vendorId: number;
  kategoriNama: string;
}

export async function listVendorProduk(vendorId: number): Promise<VendorProdukRow[]> {
  const pool = getPgPool();
  const result = await pool.query(
    `SELECT vp.id, vp.vendor_id, vp.kategori_id, vk.nama AS kategori_nama, vp.brand, vp.model, vp.spesifikasi
     FROM vendor_produk vp JOIN vendor_kategori vk ON vk.id = vp.kategori_id
     WHERE vp.vendor_id = $1 ORDER BY vk.nama, vp.brand, vp.model`,
    [vendorId]
  );
  return result.rows.map((r) => ({
    id: r.id,
    vendorId: r.vendor_id,
    kategoriId: r.kategori_id,
    kategoriNama: r.kategori_nama,
    brand: r.brand,
    model: r.model,
    spesifikasi: r.spesifikasi,
  }));
}

export async function addVendorProduk(vendorId: number, input: VendorProdukInput): Promise<number> {
  const pool = getPgPool();
  const result = await pool.query(
    `INSERT INTO vendor_produk (vendor_id, kategori_id, brand, model, spesifikasi) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [vendorId, input.kategoriId, input.brand, input.model, input.spesifikasi]
  );
  return result.rows[0].id as number;
}

export async function updateVendorProduk(id: number, input: VendorProdukInput): Promise<void> {
  const pool = getPgPool();
  await pool.query(
    `UPDATE vendor_produk SET kategori_id = $1, brand = $2, model = $3, spesifikasi = $4 WHERE id = $5`,
    [input.kategoriId, input.brand, input.model, input.spesifikasi, id]
  );
}

export async function deleteVendorProduk(id: number): Promise<void> {
  const pool = getPgPool();
  await pool.query(`DELETE FROM vendor_produk WHERE id = $1`, [id]);
}
