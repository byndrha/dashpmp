"use server";

import { requireMarketing } from "@/lib/require-access";
import { getVisitLogStatusForMarketing, type VisitLogStatusRow } from "@/lib/queries/marketing-visit-log-status";
import { getSalesDayComparisonForMarketing } from "@/lib/queries/sales-overview-marketing";
import { getMarketingVisitLogForDate, saveMarketingVisitLog, type MarketingVisitLogEntry } from "@/lib/queries/marketing-visit-log";
import { getMarketingPerformance, type MarketingPerformanceData } from "@/lib/queries/marketing-performance";
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
import { setMitraLocation } from "@/lib/queries/mitra-location";
import { setMitraCompetitor } from "@/lib/queries/mitra-competitor";
import { getTopMitraPiutang, type TopMitraPiutangRow } from "@/lib/queries/top-mitra-piutang";
import { setMitraNote } from "@/lib/queries/collection-priority";
import type { SalesDayComparisonResult } from "@/lib/queries/sales-overview";
import { AppError, runAction, type ActionResult } from "@/lib/action-result";

function ownMitra(all: MitraRow[], marketingName: string): MitraRow[] {
  return all.filter((m) => m.MarketingNama === marketingName);
}

export async function getBerandaDataAction(): Promise<
  ActionResult<{ sales: SalesDayComparisonResult; topPiutang: TopMitraPiutangRow[] }>
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
    return { sales, topPiutang: allPiutang.filter((r) => ownIds.has(r.BusinessPartnerID)) };
  });
}

export async function getKinerjaMarketingAction(): Promise<ActionResult<MarketingPerformanceData>> {
  return runAction(async () => {
    const session = await requireMarketing();
    const data = await getMarketingPerformance();
    return {
      ...data,
      cells: data.cells.filter((c) => c.MarketingUserID === session.user.id),
    };
  });
}

export async function getVisitLogStatusAction(dateISO: string): Promise<ActionResult<VisitLogStatusRow[]>> {
  return runAction(async () => {
    const session = await requireMarketing();
    return getVisitLogStatusForMarketing(session.user.id, dateISO);
  });
}

export async function getVisitLogDetailAction(
  businessPartnerId: string,
  dateISO: string
): Promise<ActionResult<MarketingVisitLogEntry | null>> {
  return runAction(async () => {
    await requireMarketing();
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
