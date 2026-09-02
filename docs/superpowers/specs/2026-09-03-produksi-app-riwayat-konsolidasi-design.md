# Konsolidasi Tab Pengiriman & Riwayat ke Layar Riwayat Baru — Design Spec

## Latar belakang

`/mkesindo/produksi-app` saat ini punya 6 tab: Pengiriman, Riwayat, Stok Es, Kualitas, Bahan Baku, Aktivitas. Sejak merge Peta Gudang/Mulai Muat (2026-09-01), alur "Mulai Muat" (pilih pallet, alokasi kuantitas) sepenuhnya pindah ke peta gudang pada tab Stok Es — tab Pengiriman & Riwayat kini hanya menampilkan kartu-kartu itu secara read-only, plus tombol "Selesai Muat" cepat (tanpa alokasi pallet) dan riwayat yang sudah selesai. Kedua tab jadi berlebihan: Stok Es sudah punya panel "Keberangkatan Mendekat" sendiri untuk kartu yang jam berangkatnya mendekat, sementara tab Pengiriman/Riwayat menampilkan SEMUA kartu (tanpa syarat mendekat) tapi terpisah ke tab lain dan hanya membedakan dua kelompok kasar: "periode sekarang-atau-mendatang" (Pengiriman) vs "sebelumnya" (Riwayat) berdasarkan rollover 14:00.

Sub-proyek ini menghapus kedua tab tersebut dan menggantinya dengan satu tombol "Riwayat" di tab Stok Es (sebelah panel "Keberangkatan Mendekat") yang membuka layar penuh-layar baru: seluruh kartu pengiriman pada satu periode kerja (tanggal usaha + shift) yang dipilih lewat filter, dipisah dua bagian (Belum Selesai / Sudah Selesai Muat) — menggantikan pemisahan tab dengan pemisahan filter eksplisit yang bisa menjangkau periode mana pun, bukan cuma "sekarang" vs "semua yang lampau".

## Tujuan

1. Tab-shell produksi-app berkurang dari 6 jadi 4 tab: Stok Es (jadi tab default/root), Kualitas, Bahan Baku, Aktivitas.
2. Tombol "Riwayat" baru di panel "Keberangkatan Mendekat" pada tab Stok Es, navigasi sungguhan ke route penuh-layar baru `/mkesindo/produksi-app/riwayat`.
3. Layar Riwayat baru: filter tanggal usaha + shift (memakai sistem shift kerja yang sudah ada — `report-shift.ts`, Shift 1/07:00, Shift 2/15:00, Shift 3/23:00 WIB, kind `"work"`), default ke periode+shift saat ini. Menampilkan dua bagian: "Belum Selesai" dan "Sudah Selesai Muat", keduanya dikelompokkan berdasarkan `JamJadwal` kartu (jadwal keberangkatannya) yang jatuh di jendela shift terpilih — bukan berdasarkan kapan `JamSelesaiMuat` benar-benar terjadi, supaya satu kartu selalu berada di bagian/periode yang sama konsisten baik sebelum maupun sesudah selesai dimuat.
4. Kartu pada bagian "Belum Selesai" tetap bisa ditekan "Selesai Muat" (aksi cepat tanpa alokasi pallet) untuk periode manapun yang sedang difilter — kartu backlog tidak dibekukan, sama seperti perilaku tab Riwayat lama.
5. `KartuPengirimanList` (komponen yang sudah ada, menampilkan dua bagian ini) dipakai ulang langsung tanpa diubah — hanya diberi data dari sumber baru.

## Non-tujuan

- **Tidak** mengubah `getDraftJadwalForProduksi`/`getDraftJadwalForProduksiAction` (fungsi yang dipakai panel "Keberangkatan Mendekat" + dermaga di Stok Es) — tetap memakai definisi periode 14:00-rollover yang sudah ada (`isCurrentOrFuturePeriod`/`getBusinessDateISO`), sepenuhnya independen dari sistem filter shift-kerja yang baru ini. Kedua sistem periode (rollover 14:00 harian untuk "mendekat", shift kerja 07/15/23 untuk layar Riwayat) sengaja berbeda dan hidup berdampingan.
- **Tidak** mengaudit atau memperbaiki konvensi penyimpanan waktu (WIB naive vs UTC sungguhan) pada `DashboardPengirimanJadwal.JamJadwal`/`JamSelesaiMuat` di luar kebutuhan fungsi baru ini sendiri — di luar cakupan, catatan lebih lanjut di Global Constraints rencana implementasi.
- **Tidak** membangun UI/CRUD shift baru — `report-shift.ts` (`ShiftNumber`, `getReportShift`, `getShiftWindow`, `getShiftLabel`) dipakai apa adanya, tanpa perubahan.
- **Tidak** mengubah alur "Mulai Muat" (pilih pallet + alokasi) di peta gudang Stok Es — itu sudah selesai di sub-proyek sebelumnya, di luar cakupan ini.
- **Tidak** menambah aksi baru selain "Selesai Muat" cepat yang sudah ada — layar Riwayat baru murni konsolidasi tampilan + filter, bukan fitur baru.

## Perubahan Navigasi & Tab-Shell

```
src/app/mkesindo/produksi-app/(tabs)/page.tsx        -- ISI DIGANTI: sekarang jadi halaman Stok Es (root path), bukan Pengiriman
src/app/mkesindo/produksi-app/(tabs)/warehouse/       -- DIHAPUS: seluruh direktori (isinya pindah ke root di atas)
src/app/mkesindo/produksi-app/(tabs)/riwayat/         -- DIHAPUS: seluruh direktori (tab Riwayat lama)
src/app/mkesindo/produksi-app/riwayat/page.tsx        -- BARU: route penuh-layar, DI LUAR (tabs)/, sibling seperti pola satpam-app
```

`ProduksiTabKey` (di `produksi-tab-shell.tsx`) berkurang jadi `"warehouse" | "kualitas" | "bahan-baku" | "aktivitas-produksi"`. `TAB_PATHS.warehouse` berubah jadi `"/mkesindo/produksi-app"` (root — menggantikan posisi Pengiriman sebagai tab home). Seluruh state/effect terkait `kartu-pengiriman`/`riwayat` (state `kartuPengiriman`/`riwayat`, fungsi `refreshKartuPengiriman`, blok render kedua tab itu) dihapus dari `ProduksiTabShell`. `WarehouseView`'s `onAfterMuat` tetap memanggil `refreshWarehouse()` — panggilan `refreshKartuPengiriman()` di dalamnya dihapus karena tidak ada lagi state itu untuk di-refresh (tab Stok Es sendiri sudah refresh `warehouseJadwal` lewat `refreshWarehouse()`).

`ProduksiBottomNav`'s `TABS` array berkurang jadi 4 entri (Stok Es/Snowflake, Kualitas/ShieldCheck, Bahan Baku/Package, Aktivitas/Users) — entri Pengiriman (ClipboardList) dan Riwayat (History) dihapus.

## Tombol "Riwayat" di Stok Es

Di `warehouse-view.tsx`'s `KartuPengirimanMendekatPanel`, baris judul "Keberangkatan Mendekat" ditambahi tombol kecil "Riwayat" (ikon `History` dari lucide-react) di kanannya, memanggil `useRouter().push("/mkesindo/produksi-app/riwayat")` — navigasi sungguhan, keluar dari tab-shell (mirip cara `patroli-panel.tsx` navigasi ke layar foto penuh-layar di satpam-app).

## Model Data & Query Baru

Dua fungsi baru di `src/lib/queries/produksi-muatan.ts`, memakai `getShiftWindow(tanggalUsaha, shift, "work")` (dari `@/lib/report-shift`) untuk menghitung jendela `{start, end}` — keduanya berbagi struktur SQL yang sama persis dengan `fetchAllDraftJadwalForProduksi`/`fetchRecentSelesaiMuatJadwalForProduksi` yang sudah ada, hanya menambah `WHERE j.JamJadwal BETWEEN @start AND @end` (menggantikan filter `isCurrentOrFuturePeriod` di sisi JS, dan menggantikan `TOP (100)` tanpa jendela tanggal):

```ts
export async function getKartuPengirimanBelumSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<DraftJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamMulaiMuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KGDibutuhkan,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KGDibutuhkan
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.Status = 'Draft' AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamMulaiMuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}

export async function getKartuPengirimanSelesaiUntukPeriode(
  tanggalUsaha: Date,
  shift: ShiftNumber
): Promise<SelesaiMuatJadwalForProduksi[]> {
  const { start, end } = getShiftWindow(tanggalUsaha, shift, "work");
  const pool = await getPool();
  const result = await pool
    .request()
    .input("start", sql.DateTime, start)
    .input("end", sql.DateTime, end).query(`
      SELECT j.JadwalID, a.Nama AS ArmadaNama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat,
             ISNULL(${JADWAL_KANTONG_10KG_EXPR}, 0) AS Qty10KG,
             ISNULL(${JADWAL_KANTONG_5KG_EXPR}, 0) AS Qty5KG
      FROM DashboardPengirimanJadwal j
      LEFT JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID
      LEFT JOIN DashboardPengirimanJadwalDetail jd ON jd.JadwalID = j.JadwalID AND jd.IsDeleted = 0
      LEFT JOIN SalesOrderDetail sod ON sod.SalesOrderID = jd.SalesOrderID
      WHERE j.IsDeleted = 0 AND j.JamSelesaiMuat IS NOT NULL AND j.JamJadwal BETWEEN @start AND @end
      GROUP BY j.JadwalID, a.Nama, j.JamJadwal, j.JamSelesaiMuat, j.Qty5KGDimuat
      ORDER BY j.JamJadwal DESC
    `);
  return result.recordset;
}
```

Catatan penting soal zona waktu (harus dibawa ke rencana implementasi sebagai Global Constraint): `getShiftWindow` mengembalikan `Date` ber-representasi "naive-WIB" (komponen UTC-nya SAMA dengan jam dinding WIB, bukan instant UTC sungguhan) — dikonfirmasi lewat investigasi bug armada Truk 52 di sesi ini yang membuktikan `DashboardPengirimanJadwal.JamJadwal` disimpan dengan representasi yang identik (komponen UTC == jam dinding WIB), meski ada komentar LAMA di `produksi-muatan.ts` (`isCurrentOrFuturePeriod`) yang mengklaim kolom ini "true UTC, not naive-WIB". Perbandingan `WHERE JamJadwal BETWEEN @start AND @end` di atas AMAN karena kedua sisi (kolom & `getShiftWindow`) memakai representasi yang sama, terlepas dari klaim komentar lama itu — jangan "perbaiki" kode baru ini supaya cocok dengan komentar lama tersebut, dan jangan mengubah `isCurrentOrFuturePeriod` sama sekali (di luar cakupan sub-proyek ini).

Dua fungsi lama yang sepenuhnya digantikan (dihapus, tidak dipakai lagi): `getDraftJadwalRiwayatForProduksi`, `getSelesaiMuatJadwalForProduksi`, `getSelesaiMuatJadwalRiwayatForProduksi`, beserta helper privat `fetchRecentSelesaiMuatJadwalForProduksi`. `getDraftJadwalForProduksi`/`fetchAllDraftJadwalForProduksi`/`getAllDraftJadwalForProduksi` **tidak berubah** (masih dipakai "Keberangkatan Mendekat" + `produksiStartMuatAction`/`produksiSelesaiMuatAction`).

## Server Actions

Di `src/app/mkesindo/produksi/actions.ts`: hapus `getDraftJadwalRiwayatForProduksiAction`, `getSelesaiMuatJadwalForProduksiAction`, `getSelesaiMuatJadwalRiwayatForProduksiAction`. Tambah dua action baru, digate `requireProduksiView()` sama seperti action baca lain di file ini, menerima tanggal sebagai ISO string (pola yang sama seperti `getMesinEventsForShiftAction`) lalu di-parse jadi `Date` sebelum diteruskan ke query:

```ts
export async function getKartuPengirimanBelumSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<DraftJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanBelumSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}

export async function getKartuPengirimanSelesaiAction(
  tanggalUsahaISO: string,
  shift: ShiftNumber
): Promise<ActionResult<SelesaiMuatJadwalForProduksi[]>> {
  return runAction(async () => {
    await requireProduksiView();
    return getKartuPengirimanSelesaiUntukPeriode(new Date(tanggalUsahaISO), shift);
  });
}
```

## UI Layar Riwayat

```
src/app/mkesindo/produksi-app/riwayat/page.tsx                -- BARU
src/components/produksi-app/riwayat-kartu-pengiriman-view.tsx -- BARU
```

`page.tsx`: `await requireProduksi()` (gate halaman, sama seperti `(tabs)/layout.tsx` — route ini di luar layout itu jadi harus gate sendiri), hitung periode+shift default lewat `getReportShift("work")`, fetch kedua daftar awal (`getKartuPengirimanBelumSelesaiUntukPeriode`/`getKartuPengirimanSelesaiUntukPeriode` dipanggil langsung, bukan lewat action, karena ini server component), lalu render `<RiwayatKartuPengirimanView initialTanggalUsaha={...} initialShift={...} initialBelumSelesai={...} initialSelesai={...} />`.

`riwayat-kartu-pengiriman-view.tsx` (client component):
- Header: tombol kembali (`router.push("/mkesindo/produksi-app")`) + judul "Riwayat Kartu Pengiriman".
- Baris filter: `<Input type="date">` untuk tanggal usaha (format `getBusinessDateISO`-style `YYYY-MM-DD`) + 3 tombol segmented untuk Shift 1/2/3 (pola persis seperti `kualitas-view.tsx`'s `SHIFT_OPTIONS.map`, label lewat `getShiftLabel(s, "work")`).
- State: `tanggalUsaha`/`shift` (diinisialisasi dari props `initial*`), `belumSelesai`/`selesai` (diinisialisasi dari props `initial*`), `loading`.
- Mengubah tanggal ATAU shift memicu `useEffect` yang memanggil kedua action baru secara paralel (`Promise.all`) dan mengganti kedua state daftar — pola sederhana yang sama seperti tab-tab produksi-app lain (loading indicator saat fetch, pesan error kalau gagal).
- Konten: `<KartuPengirimanList key={\`${tanggalISO}-${shift}\`} initialJadwal={belumSelesai} fetchSelesaiList={async () => ({success: true, data: selesai})} emptyMessage="Tidak ada Kartu Pengiriman pada periode ini." onAfterMuat={() => { /* refetch kedua daftar untuk periode aktif */ }} />` — `key` di-set supaya `KartuPengirimanList` remount penuh setiap filter berubah, memakai ulang komponen itu APA ADANYA (state internalnya sendiri diinisialisasi ulang dari `initialJadwal`/`fetchSelesaiList` yang baru lewat remount, bukan lewat prop-sync — sesuai catatan implementasi komponen itu sendiri bahwa `initialJadwal` hanya dibaca sekali saat mount).

## Testing

Tidak ada test suite otomatis di repo ini. Verifikasi: `npx tsc --noEmit`, `npm run lint`, **`npm run build`** (wajib — riwayat-kartu-pengiriman-view.tsx adalah client component baru yang mengimpor dari `@/lib/queries/produksi-muatan`/`@/lib/report-shift`; pastikan hanya impor tipe, tidak ada impor nilai dari modul server-only manapun, mengikuti pelajaran dari insiden deploy sebelumnya di sesi ini), lalu klik-tayang manual (atau penelusuran kode teliti kalau kredensial `requireProduksi` tidak tersedia): buka Stok Es, tekan "Riwayat", ubah tanggal/shift ke periode sebelumnya, konfirmasi kedua bagian menampilkan data yang benar, tekan "Selesai Muat" pada satu kartu Belum Selesai dan konfirmasi ia pindah bagian.

## Struktur File

- Modifikasi (isi diganti total): `src/app/mkesindo/produksi-app/(tabs)/page.tsx` (jadi halaman Stok Es)
- Hapus: `src/app/mkesindo/produksi-app/(tabs)/warehouse/page.tsx` (direktori `warehouse/` ikut terhapus)
- Hapus: `src/app/mkesindo/produksi-app/(tabs)/riwayat/page.tsx` (direktori `riwayat/` di dalam `(tabs)/` ikut terhapus)
- Buat: `src/app/mkesindo/produksi-app/riwayat/page.tsx` (route baru, di luar `(tabs)/`)
- Buat: `src/components/produksi-app/riwayat-kartu-pengiriman-view.tsx`
- Modifikasi: `src/components/produksi-app/produksi-tab-shell.tsx` (hapus `ProduksiTabKey` "kartu-pengiriman"/"riwayat", state, effect, blok render terkait; ubah `TAB_PATHS.warehouse`)
- Modifikasi: `src/components/produksi-app/bottom-nav.tsx` (hapus 2 entri tab)
- Modifikasi: `src/components/produksi-app/warehouse-view.tsx` (tombol "Riwayat" baru di `KartuPengirimanMendekatPanel`)
- Modifikasi: `src/lib/queries/produksi-muatan.ts` (tambah 2 fungsi baru, hapus 3 fungsi + 1 helper privat lama)
- Modifikasi: `src/app/mkesindo/produksi/actions.ts` (tambah 2 action baru, hapus 3 action lama)
- Tidak berubah: `src/components/produksi-app/kartu-pengiriman-list.tsx` (dipakai ulang apa adanya), `getDraftJadwalForProduksi`/`getAllDraftJadwalForProduksi`/`getDraftJadwalForProduksiAction`, seluruh alur Mulai Muat/alokasi pallet di peta gudang, `report-shift.ts`
