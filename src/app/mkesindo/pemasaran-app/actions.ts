"use server";

import { requireMarketing } from "@/lib/require-access";
import { getVisitLogStatusForMarketing } from "@/lib/queries/marketing-visit-log-status";
import { getSalesDayComparisonForMarketing } from "@/lib/queries/sales-overview-marketing";
import { getMarketingVisitLogForDate, saveMarketingVisitLog, type MarketingVisitLogEntry } from "@/lib/queries/marketing-visit-log";
import {
  getMarketingPerformance,
  type MarketingPerformanceData,
  type MarketingScopeAllMitra,
} from "@/lib/queries/marketing-performance";
import { getPemasaranWilayahDelivery, type PemasaranWilayahDeliveryRow } from "@/lib/queries/pemasaran-wilayah-delivery";
import { getPengajuanList, createPengajuan, type PengajuanRow, type PengajuanInput } from "@/lib/queries/mitra-pengajuan";
import {
  getMitraList,
  getMitraDetail,
  createMitra,
  updateMitra,
  getPriceLevelOptions,
  type MitraRow,
  type MitraInput,
  type PriceLevelOption,
} from "@/lib/queries/mitra";
import { setMitraLocation, getMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";
import { getTopMitraPiutang, type TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import { setMitraNote } from "@/lib/queries/collection-priority";
import type { SalesDayComparisonResult } from "@/lib/queries/sales-overview";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";
import { getMarketingPerformanceTrend, type MarketingPerformanceTrendData } from "@/lib/queries/marketing-performance-trend";
import { getPangsaPasarTrend, type PangsaPasarTrendData } from "@/lib/queries/pangsa-pasar-trend";
import { saveVerifiedKunjungan, getVisitLogHistoryForMitra, getLatestVisitLogSnippets } from "@/lib/queries/marketing-visit-log";
import { getAkunNamaMap } from "@/lib/queries/akun";
import { haversineKm } from "@/lib/route-estimate";
import { getBusinessDateISO } from "@/lib/business-date";
import { revalidatePath } from "next/cache";

function ownMitra(all: MitraRow[], marketingName: string): MitraRow[] {
  return all.filter((m) => m.MarketingNama === marketingName);
}

export type TopMitraPiutangRowWithKunjungan = TopMitraPiutangRow & {
  LatestKunjunganText: string | null;
  LatestKunjunganDate: string | null;
};

export async function getBerandaDataAction(): Promise<
  ActionResult<{ sales: SalesDayComparisonResult; topPiutang: TopMitraPiutangRowWithKunjungan[] }>
> {
  return runAction(async () => {
    const session = await requireMarketing();
    const marketingName = session.user.name ?? session.user.username;
    const [sales, allPiutang, ownMitraList] = await Promise.all([
      getSalesDayComparisonForMarketing(session.user.id),
      getTopMitraPiutang(),
      getMitraList(),
    ]);
    const ownIds = new Set(ownMitra(ownMitraList, marketingName).map((m) => m.BusinessPartnerID));
    const ownPiutang = allPiutang.filter((r) => ownIds.has(r.BusinessPartnerID));
    const snippets = await getLatestVisitLogSnippets(ownPiutang.map((r) => r.BusinessPartnerID));
    const topPiutang: TopMitraPiutangRowWithKunjungan[] = ownPiutang.map((r) => {
      const snippet = snippets.get(r.BusinessPartnerID);
      return { ...r, LatestKunjunganText: snippet?.hasilKunjungan ?? null, LatestKunjunganDate: snippet?.logDate ?? null };
    });
    return { sales, topPiutang };
  });
}

// Adds Harga (Rupiah, resolved from PriceLevel) onto each roster row —
// resolved server-side here (one hargaByLevel lookup) rather than threading
// PriceLevelOption[] through every RosterCard on the client.
export type MarketingScopeAllMitraWithHarga = MarketingScopeAllMitra & { Harga: number | null };

export type KinerjaMarketingData = Omit<MarketingPerformanceData, "allMitraByMarketing"> & {
  allMitraByMarketing: Record<string, MarketingScopeAllMitraWithHarga[]>;
};

export async function getKinerjaMarketingAction(): Promise<ActionResult<KinerjaMarketingData>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const [data, priceLevels] = await Promise.all([getMarketingPerformance(), getPriceLevelOptions()]);
    const priceByLevel = new Map(priceLevels.map((p) => [p.Level, p.Price]));
    // data.mitraDailyQty and data.allMitraByMarketing cover every marketing's
    // resolved mitra, not just the caller's — must be narrowed to the
    // caller's own roster before leaving this action, same as cells below.
    const ownMitraRoster: MarketingScopeAllMitraWithHarga[] = (data.allMitraByMarketing[session.user.id] ?? []).map((m) => ({
      ...m,
      Harga: m.PriceLevel != null ? (priceByLevel.get(m.PriceLevel) ?? null) : null,
    }));
    const mitraDailyQty: Record<string, number[]> = {};
    const mitraTerverifikasiByDay: Record<string, boolean[]> = {};
    for (const m of ownMitraRoster) {
      const qty = data.mitraDailyQty[m.BusinessPartnerID];
      if (qty) mitraDailyQty[m.BusinessPartnerID] = qty;
      const terverifikasi = data.mitraTerverifikasiByDay[m.BusinessPartnerID];
      if (terverifikasi) mitraTerverifikasiByDay[m.BusinessPartnerID] = terverifikasi;
    }
    return {
      ...data,
      cells: data.cells.filter((c) => c.MarketingUserID === session.user.id),
      allMitraByMarketing: { [session.user.id]: ownMitraRoster },
      mitraDailyQty,
      mitraTerverifikasiByDay,
    };
  });
}

export async function getKinerjaMarketingTrendAction(
  monthsBack: 3 | 12
): Promise<ActionResult<{ performance: MarketingPerformanceTrendData; pangsaPasar: PangsaPasarTrendData }>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const performanceFull = await getMarketingPerformanceTrend(monthsBack);
    const pangsaPasarFull = await getPangsaPasarTrend(monthsBack, performanceFull);
    // Mobile never shows the combined/company-wide view — only the caller's
    // own row, same cross-marketing isolation rule as getKinerjaMarketingAction.
    return {
      performance: { ...performanceFull, rows: performanceFull.rows.filter((r) => r.MarketingUserID === session.user.id) },
      pangsaPasar: { ...pangsaPasarFull, rows: pangsaPasarFull.rows.filter((r) => r.MarketingUserID === session.user.id) },
    };
  });
}

export async function getVisitLogDetailAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<MarketingVisitLogEntry | null>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // Same roster resolution getVisitLogStatusAction already uses — reused
    // here so a marketing rep can't read a colleague's visit-log note by
    // passing a businessPartnerId outside their own resolved coverage.
    const roster = await getVisitLogStatusForMarketing(session.user.id, dateISO);
    if (!roster.some((r) => r.BusinessPartnerID === businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }
    return getMarketingVisitLogForDate(businessPartnerId, dateISO);
  });
}

export async function saveVisitLogAction(input: {
  businessPartnerId: string;
  dateISO: string;
  hasilKunjungan: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // Same ownership check as getVisitLogDetailAction above — without it,
    // one marketing rep could overwrite a colleague's visit-log note by
    // calling this action with a businessPartnerId outside their own scope.
    const roster = await getVisitLogStatusForMarketing(session.user.id, input.dateISO);
    if (!roster.some((r) => r.BusinessPartnerID === input.businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }
    await saveMarketingVisitLog({ ...input, userId: session.user.id });
  });
}

export async function getWilayahDeliveryAction(): Promise<ActionResult<PemasaranWilayahDeliveryRow[]>> {
  return runAction(async () => {
    await requireMarketing();
    return getPemasaranWilayahDelivery();
  });
}

export async function getPengajuanListAction(): Promise<ActionResult<PengajuanRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getPengajuanList();
    return all.filter((r) => r.MarketingUserID === session.user.id);
  });
}

export async function createPengajuanAction(input: PengajuanInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await createPengajuan(input, session.user.id);
  });
}

export async function getPriceLevelOptionsAction(): Promise<ActionResult<PriceLevelOption[]>> {
  return runAction(async () => {
    await requireMarketing();
    return getPriceLevelOptions();
  });
}

export async function getMitraListAction(): Promise<ActionResult<MitraRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getMitraList();
    return ownMitra(all, session.user.name ?? session.user.username);
  });
}

export async function getMitraDetailAction(businessPartnerId: string): Promise<ActionResult<MitraRow | null>> {
  return runAction(async () => {
    await requireMarketing();
    return getMitraDetail(businessPartnerId);
  });
}

export async function createMitraAction(input: MitraInput): Promise<ActionResult<string>> {
  return runAction(async () => {
    await requireMarketing();
    return createMitra(input);
  });
}

export async function updateMitraAction(id: string, input: MitraInput): Promise<ActionResult<void>> {
  return runAction(async () => {
    await requireMarketing();
    await updateMitra(id, input);
  });
}

export async function setMitraLocationAction(input: {
  businessPartnerId: string;
  latitude: number;
  longitude: number;
  alamat: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraLocation({ ...input, userId: session.user.id });
  });
}

export async function setMitraCompetitorAction(input: {
  businessPartnerId: string;
  kompetitor: string | null;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraCompetitor({ ...input, userId: session.user.id });
  });
}

export async function setMitraNoteAction(input: { businessPartnerId: string; note: string | null }): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    await setMitraNote(input.businessPartnerId, input.note, session.user.id);
  });
}

// Sumber dropdown "Tambah Kunjungan" — mitra milik marketing yang login,
// apa adanya (termasuk Latitude/Longitude/GeoAlamat kalau sudah pernah
// dipin) — reuse getMitraList() yang sudah JOIN DashboardMitraLocation,
// tidak perlu query baru.
export async function getKunjunganMitraOptionsAction(): Promise<ActionResult<MitraRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const all = await getMitraList();
    return ownMitra(all, session.user.name ?? session.user.username);
  });
}

const KUNJUNGAN_RADIUS_METERS = 100;

export async function confirmKunjunganAction(input: {
  businessPartnerId: string;
  hasilKunjungan: string;
  fotoTampakDepanPath: string;
  fotoPenagihanPath: string;
  latitude: number;
  longitude: number;
}): Promise<ActionResult<void>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // "Hari ini" (LogDate) dihitung SERVER-SIDE via getBusinessDateISO (WIB,
    // rollover 14:00 — konvensi "today" yang sama persis dipakai
    // getMarketingPerformance()'s todayISO), bukan dari input client seperti
    // sebelumnya. dateISO dulu diterima dari client, dihitung lewat
    // `new Date().toISOString().slice(0,10)` di tambah-kunjungan-sheet.tsx —
    // itu tanggal kalender UTC, salah untuk WIB 00:00-06:59 (kembalikan
    // tanggal KEMARIN), reinkarnasi bug WIB/UTC yang sudah diperbaiki di 8
    // jalur tulis SO/DO/SI/SR lain (lihat getNaiveWibTransDate) tapi belum
    // dibawa ke kunjungan ini (final review Finding 3). Menghitungnya di
    // server juga menutup celah manipulasi jam device lewat DevTools, sama
    // alasannya dengan validasi jarak di bawah.
    const dateISO = getBusinessDateISO();
    // Ownership check sama seperti saveVisitLogAction — mencegah konfirmasi
    // kunjungan ke mitra di luar cakupan marketing yang login.
    const roster = await getVisitLogStatusForMarketing(session.user.id, dateISO);
    if (!roster.some((r) => r.BusinessPartnerID === input.businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }

    const mitraLocation = await getMitraLocation(input.businessPartnerId);
    if (!mitraLocation) {
      throw new AppError("Lokasi mitra belum tersimpan. Silakan pin lokasi mitra terlebih dahulu.");
    }

    // Validasi jarak DIULANG di server — tidak boleh hanya percaya validasi
    // sisi client, mencegah manipulasi koordinat lewat DevTools (Review
    // Focus plan ini).
    const distanceKm = haversineKm(
      { lat: mitraLocation.Latitude, lng: mitraLocation.Longitude },
      { lat: input.latitude, lng: input.longitude }
    );
    if (distanceKm * 1000 > KUNJUNGAN_RADIUS_METERS) {
      throw new AppError(
        `Anda berada ${Math.round(distanceKm * 1000)}m dari lokasi mitra — kunjungan hanya bisa dikonfirmasi dalam radius ${KUNJUNGAN_RADIUS_METERS}m.`
      );
    }

    await saveVerifiedKunjungan({
      businessPartnerId: input.businessPartnerId,
      dateISO,
      hasilKunjungan: input.hasilKunjungan,
      fotoTampakDepanPath: input.fotoTampakDepanPath,
      fotoPenagihanPath: input.fotoPenagihanPath,
      latitude: input.latitude,
      longitude: input.longitude,
      userId: session.user.id,
    });

    // Task shell (pemasaran-app-tab-shell.tsx) keeps Beranda/Kinerja
    // Marketing mounted client-side after first visit and they fetch their
    // data via Server Actions straight from useEffect on mount — not via
    // page-level RSC props — so revalidatePath alone does NOT reach their
    // already-rendered state (it only invalidates the Router Cache for a
    // path; nothing here re-triggers those effects). Kept anyway for the
    // codebase-wide convention (every sibling mutating action in this file's
    // family calls it — see produksi/actions.ts) and in case a full
    // reload/direct navigation to these paths happens. The actual fix for
    // the keep-alive staleness (final review Finding 2) is
    // notifyKunjunganConfirmed() below, a small in-page pub/sub that Beranda
    // and Kinerja Marketing subscribe to and refetch on.
    revalidatePath("/mkesindo/pemasaran-app");
    revalidatePath("/mkesindo/pemasaran-app/pemasaran");
  });
}

export type VisitLogHistoryEntry = MarketingVisitLogEntry & { dicatatOlehNama: string };

export async function getVisitLogHistoryForMitraAction(businessPartnerId: string): Promise<ActionResult<VisitLogHistoryEntry[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    // Ownership check sama seperti getVisitLogDetailAction — hanya boleh
    // lihat riwayat mitra milik sendiri. dateISO di sini dipakai
    // getVisitLogStatusForMarketing hanya untuk resolusi roster (bukan
    // filter riwayat itu sendiri), tapi tetap harus WIB-aware — bukan
    // `new Date().toISOString().slice(0,10)` (tanggal kalender UTC, salah
    // untuk WIB 00:00-06:59, final review Finding 3) — biar konsisten
    // dengan getBusinessDateISO's "today" di seluruh permukaan pemasaran-app
    // ini (lihat todayISO field di getMarketingPerformance()).
    const roster = await getVisitLogStatusForMarketing(session.user.id, getBusinessDateISO());
    if (!roster.some((r) => r.BusinessPartnerID === businessPartnerId)) {
      throw new AppError("Anda tidak memiliki akses ke mitra ini.");
    }
    const history = await getVisitLogHistoryForMitra(businessPartnerId);
    // CreatedByUserID -> nama akun, resolusi lintas-DB (Postgres akun,
    // bukan MSSQL) — pola identik produksi-riwayat-detail.ts.
    const akunIds = [...new Set(history.map((h) => Number(h.CreatedByUserID)))].filter((id) => !Number.isNaN(id));
    const namaMap = await getAkunNamaMap(akunIds);
    return history.map((h) => ({ ...h, dicatatOlehNama: namaMap.get(Number(h.CreatedByUserID)) ?? "Tidak diketahui" }));
  });
}
