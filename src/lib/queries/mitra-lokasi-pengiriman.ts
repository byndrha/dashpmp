// Lapisan data alamat mitra & lokasi pengiriman ganda — Es Kristal (MSSQL).
// Spec: docs/superpowers/specs/2026-10-23-mitra-identitas-lokasi-pengiriman-design.md §5, §6.1, §8.
//
// Invarian (§5): kolom ERP BusinessPartner (Address/NPWPName/NPWPAddress/
// MobileNo) + DashboardMitraLocation SELALU berisi lokasi pengiriman utama.
// Tabel DashboardMitraLokasiPengiriman hanya berisi lokasi ke-2 dst.;
// DashboardMitraAlamat hanya ada barisnya bila kotak "lokasi berbeda" dicentang.
import { getPool, sql } from "@/lib/db";
import { AppError } from "@/lib/action-result";
import type { AlamatFields, PinFields, MitraAlamatTernormalisasi } from "@/lib/mitra-lokasi";
import type { Exec } from "@/lib/queries/mitra";
import { setMitraLocation } from "@/lib/queries/mitra-location";

export interface LokasiPengirimanRow extends AlamatFields, PinFields {
  LokasiPengirimanID: number;
  Urutan: number;
  Label: string | null;
  IsDeleted: boolean;
}

/** Trim; string kosong → NULL. Dipakai juga pemanggil untuk kolom ERP dari `n.utama`. */
export function rapikan(s: string | null | undefined): string | null {
  const v = s?.trim();
  return v ? v : null;
}

// Kolom baris lokasi tambahan dengan nama field sesuai AlamatFields/PinFields.
const LOKASI_SELECT = `
  LokasiPengirimanID, BusinessPartnerID, Urutan, Label,
  Wilayah AS wilayah, Kecamatan AS kecamatan, Alamat AS alamat, Kontak AS kontak,
  Latitude AS latitude, Longitude AS longitude, GeoAlamat AS geoAlamat,
  CAST(IsDeleted AS bit) AS IsDeleted`;

type LokasiDbRow = LokasiPengirimanRow & { BusinessPartnerID: string };

const keLokasiRow = ({ BusinessPartnerID: _bp, ...r }: LokasiDbRow): LokasiPengirimanRow => {
  void _bp;
  return { ...r, IsDeleted: Boolean(r.IsDeleted) };
};

/**
 * Muat alamat mitra + lokasi tambahan AKTIF dalam satu batch (dua recordset),
 * lalu dikelompokkan di JS — dipakai getMitraList (semua mitra, tanpa N+1)
 * dan getMitraDetail (satu mitra).
 */
export async function muatAlamatDanLokasiMitra(
  exec: Exec,
  bpId?: string
): Promise<{ alamat: Map<string, AlamatFields>; lokasi: Map<string, LokasiPengirimanRow[]> }> {
  const req = exec.request();
  let filterAlamat = "";
  let filterLokasi = "";
  if (bpId !== undefined) {
    req.input("bpId", sql.VarChar(16), bpId);
    filterAlamat = "WHERE BusinessPartnerID = @bpId";
    filterLokasi = "AND BusinessPartnerID = @bpId";
  }
  const res = await req.query(`
    SELECT BusinessPartnerID, Wilayah AS wilayah, Kecamatan AS kecamatan, Alamat AS alamat, Kontak AS kontak
    FROM DashboardMitraAlamat ${filterAlamat};
    SELECT ${LOKASI_SELECT}
    FROM DashboardMitraLokasiPengiriman
    WHERE IsDeleted = 0 ${filterLokasi}
    ORDER BY BusinessPartnerID, Urutan, LokasiPengirimanID;
  `);
  const recordsets = res.recordsets as unknown as [Array<AlamatFields & { BusinessPartnerID: string }>, LokasiDbRow[]];
  const alamat = new Map<string, AlamatFields>();
  for (const { BusinessPartnerID, ...a } of recordsets[0]) alamat.set(BusinessPartnerID, a);
  const lokasi = new Map<string, LokasiPengirimanRow[]>();
  for (const r of recordsets[1]) {
    const daftar = lokasi.get(r.BusinessPartnerID) ?? [];
    daftar.push(keLokasiRow(r));
    lokasi.set(r.BusinessPartnerID, daftar);
  }
  return { alamat, lokasi };
}

/**
 * Simpan bagian alamat/lokasi tambahan form mitra, semuanya di dalam `tx`
 * milik pemanggil. Kolom ERP + pin utama ditulis pemanggil sendiri lewat
 * updateMitra(…, tx) + setMitraLocation(…, tx) dengan nilai `n.utama`.
 *
 * 1. Upsert/hapus DashboardMitraAlamat sesuai `n.alamatMitra`.
 * 2. Sinkronkan lokasi tambahan: id lama yang hilang dari input → dicek
 *    tidak dipakai Jadwal terbuka, lalu soft-delete; baris ber-id → UPDATE;
 *    baris tanpa id → INSERT. Urutan = posisi array + 2 (utama = 1).
 */
export async function simpanAlamatDanLokasiMitra(
  tx: sql.Transaction,
  bpId: string,
  n: MitraAlamatTernormalisasi,
  userId: string
): Promise<void> {
  // 1. Alamat mitra
  if (n.alamatMitra) {
    await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .input("wilayah", sql.VarChar(128), rapikan(n.alamatMitra.wilayah))
      .input("kecamatan", sql.VarChar(128), rapikan(n.alamatMitra.kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(n.alamatMitra.alamat))
      .input("kontak", sql.VarChar(128), rapikan(n.alamatMitra.kontak))
      .input("userId", sql.VarChar(16), userId).query(`
        MERGE DashboardMitraAlamat WITH (HOLDLOCK) AS t
        USING (SELECT @bpId AS BusinessPartnerID) AS s ON t.BusinessPartnerID = s.BusinessPartnerID
        WHEN MATCHED THEN
          UPDATE SET Wilayah = @wilayah, Kecamatan = @kecamatan, Alamat = @alamat, Kontak = @kontak,
                     UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHEN NOT MATCHED THEN
          INSERT (BusinessPartnerID, Wilayah, Kecamatan, Alamat, Kontak, CreatedByUserID, UpdatedByUserID)
          VALUES (@bpId, @wilayah, @kecamatan, @alamat, @kontak, @userId, @userId);
      `);
  } else {
    await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .query(`DELETE FROM DashboardMitraAlamat WHERE BusinessPartnerID = @bpId`);
  }

  // 2. Lokasi tambahan
  const lama = await tx
    .request()
    .input("bpId", sql.VarChar(16), bpId)
    .query(`SELECT LokasiPengirimanID FROM DashboardMitraLokasiPengiriman WITH (UPDLOCK)
            WHERE BusinessPartnerID = @bpId AND IsDeleted = 0`);
  const idLama = new Set((lama.recordset as { LokasiPengirimanID: number }[]).map((r) => r.LokasiPengirimanID));

  const idInput = new Set<number>();
  for (const l of n.tambahan) {
    if (l.lokasiPengirimanId == null) continue;
    if (!idLama.has(l.lokasiPengirimanId)) {
      throw new AppError("Lokasi pengiriman yang diubah tidak ditemukan atau sudah dihapus. Muat ulang data mitra lalu coba lagi.");
    }
    if (idInput.has(l.lokasiPengirimanId)) {
      throw new AppError("Lokasi pengiriman yang sama muncul dua kali di form.");
    }
    idInput.add(l.lokasiPengirimanId);
  }

  const dihapus = [...idLama].filter((id) => !idInput.has(id));
  if (dihapus.length > 0) {
    await assertLokasiTidakDipakaiJadwalTerbuka(tx, dihapus);
    const req = tx.request().input("bpId", sql.VarChar(16), bpId).input("userId", sql.VarChar(16), userId);
    const params = dihapus.map((id, i) => {
      req.input(`d${i}`, sql.Int, id);
      return `@d${i}`;
    });
    await req.query(`
      UPDATE DashboardMitraLokasiPengiriman
      SET IsDeleted = 1, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
      WHERE BusinessPartnerID = @bpId AND LokasiPengirimanID IN (${params.join(",")})
    `);
  }

  for (let i = 0; i < n.tambahan.length; i++) {
    const l = n.tambahan[i];
    const req = tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .input("urutan", sql.Int, i + 2)
      .input("label", sql.VarChar(64), rapikan(l.label))
      .input("wilayah", sql.VarChar(128), rapikan(l.wilayah))
      .input("kecamatan", sql.VarChar(128), rapikan(l.kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(l.alamat))
      .input("kontak", sql.VarChar(128), rapikan(l.kontak))
      .input("lat", sql.Decimal(10, 7), l.latitude)
      .input("lng", sql.Decimal(10, 7), l.longitude)
      .input("geoAlamat", sql.VarChar(512), rapikan(l.geoAlamat))
      .input("userId", sql.VarChar(16), userId);
    if (l.lokasiPengirimanId != null) {
      await req.input("id", sql.Int, l.lokasiPengirimanId).query(`
        UPDATE DashboardMitraLokasiPengiriman SET
          Urutan = @urutan, Label = @label, Wilayah = @wilayah, Kecamatan = @kecamatan,
          Alamat = @alamat, Kontak = @kontak, Latitude = @lat, Longitude = @lng, GeoAlamat = @geoAlamat,
          UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHERE LokasiPengirimanID = @id AND BusinessPartnerID = @bpId AND IsDeleted = 0
      `);
    } else {
      await req.query(`
        INSERT INTO DashboardMitraLokasiPengiriman
          (BusinessPartnerID, Urutan, Label, Wilayah, Kecamatan, Alamat, Kontak, Latitude, Longitude, GeoAlamat,
           IsDeleted, CreatedByUserID, UpdatedByUserID)
        VALUES
          (@bpId, @urutan, @label, @wilayah, @kecamatan, @alamat, @kontak, @lat, @lng, @geoAlamat,
           0, @userId, @userId)
      `);
    }
  }
}

/**
 * "Jadikan Utama" (spec §8) dalam satu transaksi sendiri:
 * 1. baca utama (bp + ml) dan baris target (harus milik bpId & belum dihapus);
 * 2. INSERT baris tambahan baru berisi utama lama (menempati Urutan target);
 * 3. tulis isi target ke kolom ERP + DashboardMitraLocation (pin dihapus bila
 *    target tak punya koordinat — pin harus selalu = utama);
 * 4. soft-delete baris target (riwayat Jadwal yang menunjuk ID-nya tetap
 *    menampilkan alamat yang sama).
 * Mengembalikan wilayah lama & baru agar UI bisa memperingatkan perpindahan
 * marketing penanggung jawab.
 */
export async function jadikanLokasiUtama(
  bpId: string,
  lokasiPengirimanId: number,
  userId: string
): Promise<{ wilayahLama: string | null; wilayahBaru: string | null }> {
  const pool = await getPool();
  const tx = new sql.Transaction(pool);
  await tx.begin();
  try {
    const utamaRes = await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId).query(`
        SELECT bp.Address, bp.NPWPName, bp.NPWPAddress, bp.MobileNo,
               ml.Latitude, ml.Longitude, ml.Alamat AS GeoAlamat
        FROM BusinessPartner bp WITH (UPDLOCK)
        LEFT JOIN DashboardMitraLocation ml WITH (UPDLOCK) ON ml.BusinessPartnerID = bp.BusinessPartnerID
        WHERE bp.BusinessPartnerID = @bpId AND ISNULL(bp.IsDeleted, 0) = 0
      `);
    const utama = utamaRes.recordset[0] as
      | { Address: string | null; NPWPName: string | null; NPWPAddress: string | null; MobileNo: string | null;
          Latitude: number | null; Longitude: number | null; GeoAlamat: string | null }
      | undefined;
    if (!utama) throw new AppError("Mitra tidak ditemukan.");

    const targetRes = await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .input("id", sql.Int, lokasiPengirimanId).query(`
        SELECT ${LOKASI_SELECT}
        FROM DashboardMitraLokasiPengiriman WITH (UPDLOCK)
        WHERE LokasiPengirimanID = @id AND BusinessPartnerID = @bpId AND IsDeleted = 0
      `);
    const target = targetRes.recordset[0] as LokasiDbRow | undefined;
    if (!target) throw new AppError("Lokasi pengiriman tidak ditemukan atau sudah dihapus.");
    const wilayahBaru = rapikan(target.wilayah);
    if (!wilayahBaru) throw new AppError("Wilayah lokasi ini kosong — isi Wilayah dulu sebelum dijadikan Lokasi Utama.");

    // 2. Utama lama → baris tambahan baru
    await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .input("urutan", sql.Int, target.Urutan)
      .input("wilayah", sql.VarChar(128), rapikan(utama.NPWPName))
      .input("kecamatan", sql.VarChar(128), rapikan(utama.NPWPAddress))
      .input("alamat", sql.VarChar(1024), rapikan(utama.Address))
      .input("kontak", sql.VarChar(128), rapikan(utama.MobileNo))
      .input("lat", sql.Decimal(10, 7), utama.Latitude)
      .input("lng", sql.Decimal(10, 7), utama.Longitude)
      .input("geoAlamat", sql.VarChar(512), rapikan(utama.GeoAlamat))
      .input("userId", sql.VarChar(16), userId).query(`
        INSERT INTO DashboardMitraLokasiPengiriman
          (BusinessPartnerID, Urutan, Label, Wilayah, Kecamatan, Alamat, Kontak, Latitude, Longitude, GeoAlamat,
           IsDeleted, CreatedByUserID, UpdatedByUserID)
        VALUES
          (@bpId, @urutan, NULL, @wilayah, @kecamatan, @alamat, @kontak, @lat, @lng, @geoAlamat,
           0, @userId, @userId)
      `);

    // 3. Target → kolom ERP + pin
    await tx
      .request()
      .input("bpId", sql.VarChar(16), bpId)
      .input("wilayah", sql.VarChar(128), wilayahBaru)
      .input("kecamatan", sql.VarChar(128), rapikan(target.kecamatan))
      .input("alamat", sql.VarChar(1024), rapikan(target.alamat))
      .input("kontak", sql.VarChar(128), rapikan(target.kontak)).query(`
        UPDATE BusinessPartner SET
          Address = @alamat, NPWPName = @wilayah, NPWPAddress = @kecamatan, MobileNo = @kontak,
          ModifiedDate = GETDATE()
        WHERE BusinessPartnerID = @bpId
      `);
    if (target.latitude != null && target.longitude != null) {
      await setMitraLocation(
        { businessPartnerId: bpId, latitude: target.latitude, longitude: target.longitude, alamat: rapikan(target.geoAlamat), userId },
        tx
      );
    } else {
      await tx
        .request()
        .input("bpId", sql.VarChar(16), bpId)
        .query(`DELETE FROM DashboardMitraLocation WHERE BusinessPartnerID = @bpId`);
    }

    // 4. Soft-delete target
    await tx
      .request()
      .input("id", sql.Int, lokasiPengirimanId)
      .input("userId", sql.VarChar(16), userId).query(`
        UPDATE DashboardMitraLokasiPengiriman
        SET IsDeleted = 1, UpdatedByUserID = @userId, UpdatedAt = GETDATE()
        WHERE LokasiPengirimanID = @id
      `);

    await tx.commit();
    return { wilayahLama: rapikan(utama.NPWPName), wilayahBaru };
  } catch (err) {
    await tx.rollback().catch(() => {});
    throw err;
  }
}

function singkat(s: string | null, max = 40): string | null {
  const v = rapikan(s);
  if (!v) return null;
  return v.length > max ? `${v.slice(0, max - 1)}…` : v;
}

/**
 * Pilihan lokasi untuk pemilih stop di Papan Pengiriman. Hanya mitra yang
 * punya ≥1 lokasi tambahan aktif yang masuk Map (mitra 1 lokasi = tanpa
 * pemilih). Elemen pertama selalu Utama (`id: null`).
 */
export async function getLokasiPilihanStop(bpIds: string[]): Promise<Map<string, { id: number | null; label: string }[]>> {
  const hasil = new Map<string, { id: number | null; label: string }[]>();
  const unik = [...new Set(bpIds)];
  if (unik.length === 0) return hasil;
  const pool = await getPool();
  // Batas 2100 parameter per request MSSQL → potong per 1000.
  for (let mulai = 0; mulai < unik.length; mulai += 1000) {
    const potong = unik.slice(mulai, mulai + 1000);
    const req = pool.request();
    const params = potong.map((id, i) => {
      req.input(`b${i}`, sql.VarChar(16), id);
      return `@b${i}`;
    });
    const res = await req.query(`
      SELECT lp.BusinessPartnerID, lp.LokasiPengirimanID, lp.Urutan, lp.Label, lp.Alamat, bp.Address AS AlamatUtama
      FROM DashboardMitraLokasiPengiriman lp
      JOIN BusinessPartner bp ON bp.BusinessPartnerID = lp.BusinessPartnerID
      WHERE lp.IsDeleted = 0 AND lp.BusinessPartnerID IN (${params.join(",")})
      ORDER BY lp.BusinessPartnerID, lp.Urutan, lp.LokasiPengirimanID
    `);
    for (const r of res.recordset as {
      BusinessPartnerID: string; LokasiPengirimanID: number; Urutan: number;
      Label: string | null; Alamat: string | null; AlamatUtama: string | null;
    }[]) {
      let daftar = hasil.get(r.BusinessPartnerID);
      if (!daftar) {
        const a = singkat(r.AlamatUtama);
        daftar = [{ id: null, label: a ? `Utama — ${a}` : "Utama" }];
        hasil.set(r.BusinessPartnerID, daftar);
      }
      const nama = rapikan(r.Label) ?? `Lokasi ${r.Urutan}`;
      const a = singkat(r.Alamat);
      daftar.push({ id: r.LokasiPengirimanID, label: a ? `${nama} — ${a}` : nama });
    }
  }
  return hasil;
}

/**
 * Tolak bila salah satu lokasi masih dipakai stop Jadwal yang belum jadi DO:
 * JadwalDetail aktif (IsDeleted=0) dengan LokasiPengirimanID tsb, header
 * Jadwal tidak dihapus (DashboardPengirimanJadwal tidak punya status batal —
 * Status hanya Draft/Terbit), dan alamatnya belum dibekukan
 * (KirimDibekukanAt IS NULL).
 */
export async function assertLokasiTidakDipakaiJadwalTerbuka(exec: Exec, lokasiIds: number[]): Promise<void> {
  const unik = [...new Set(lokasiIds)];
  if (unik.length === 0) return;
  const req = exec.request();
  const params = unik.map((id, i) => {
    req.input(`l${i}`, sql.Int, id);
    return `@l${i}`;
  });
  const res = await req.query(`
    SELECT TOP 1 lp.LokasiPengirimanID, lp.Urutan, lp.Label, lp.Alamat, jd.JadwalID
    FROM DashboardPengirimanJadwalDetail jd
    JOIN DashboardPengirimanJadwal j ON j.JadwalID = jd.JadwalID
    JOIN DashboardMitraLokasiPengiriman lp ON lp.LokasiPengirimanID = jd.LokasiPengirimanID
    WHERE jd.LokasiPengirimanID IN (${params.join(",")})
      AND jd.IsDeleted = 0 AND j.IsDeleted = 0 AND jd.KirimDibekukanAt IS NULL
  `);
  const r = res.recordset[0] as
    | { LokasiPengirimanID: number; Urutan: number; Label: string | null; Alamat: string | null; JadwalID: number }
    | undefined;
  if (r) {
    const nama = rapikan(r.Label) ?? singkat(r.Alamat) ?? `Lokasi ${r.Urutan}`;
    throw new AppError(`Lokasi "${nama}" masih dipakai Jadwal yang belum jadi DO (Jadwal #${r.JadwalID}). Ganti lokasi stop di Papan Pengiriman atau selesaikan DO-nya dulu.`);
  }
}

/**
 * JOIN untuk resolusi alamat stop. Alias tetap: `ml` (pin utama, dari
 * `${soAlias}.BusinessPartnerID`) dan `lp` (lokasi terpilih). lp TIDAK
 * difilter IsDeleted — lokasi yang sudah dihapus tetap ter-resolve demi riwayat.
 */
export const STOP_LOKASI_JOIN = (jdAlias: string, soAlias: string): string => `
  LEFT JOIN DashboardMitraLocation ml ON ml.BusinessPartnerID = ${soAlias}.BusinessPartnerID
  LEFT JOIN DashboardMitraLokasiPengiriman lp ON lp.LokasiPengirimanID = ${jdAlias}.LokasiPengirimanID`;

/**
 * Kolom alamat stop — cermin persis pilihLokasiStop() (src/lib/mitra-lokasi.ts):
 * 1. `KirimDibekukanAt IS NOT NULL` → snapshot Kirim*;
 * 2. selain itu `LokasiPengirimanID IS NOT NULL` → lp.* APA ADANYA (tanpa
 *    fallback ke ml/bp walau koordinat lp NULL atau barisnya hilang) —
 *    KECUALI kontak: lp.Kontak kosong/NULL → bp.MobileNo (kontak mitra utama;
 *    keputusan pengguna 2026-10-23). Pin TIDAK pernah jatuh ke utama;
 * 3. selain itu → bp.* + ml.*.
 * PEMANGGIL WAJIB sudah JOIN `BusinessPartner bp` dan STOP_LOKASI_JOIN.
 */
export const STOP_LOKASI_COLUMNS = (jdAlias: string): string => {
  // `dipilih` berupa ekspresi SQL utuh (bukan nama kolom) supaya kontak bisa
  // memakai fallback ke kontak utama.
  const kolom = (snapshot: string, dipilih: string, utama: string, alias: string) => `
    CASE WHEN ${jdAlias}.KirimDibekukanAt IS NOT NULL THEN ${jdAlias}.${snapshot}
         WHEN ${jdAlias}.LokasiPengirimanID IS NOT NULL THEN ${dipilih}
         ELSE ${utama} END AS ${alias}`;
  return [
    kolom("KirimAlamat", "lp.Alamat", "bp.Address", "StopAlamat"),
    kolom("KirimWilayah", "lp.Wilayah", "bp.NPWPName", "StopWilayah"),
    kolom("KirimKecamatan", "lp.Kecamatan", "bp.NPWPAddress", "StopKecamatan"),
    kolom("KirimKontak", "COALESCE(NULLIF(LTRIM(RTRIM(lp.Kontak)), ''), bp.MobileNo)", "bp.MobileNo", "StopKontak"),
    kolom("KirimLatitude", "lp.Latitude", "ml.Latitude", "StopLatitude"),
    kolom("KirimLongitude", "lp.Longitude", "ml.Longitude", "StopLongitude"),
    `
    CASE WHEN ${jdAlias}.KirimDibekukanAt IS NOT NULL THEN 'snapshot'
         WHEN ${jdAlias}.LokasiPengirimanID IS NOT NULL THEN 'dipilih'
         ELSE 'utama' END AS StopLokasiSumber`,
  ].join(",");
};
