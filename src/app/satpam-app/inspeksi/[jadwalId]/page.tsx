import { notFound } from "next/navigation";
import { requireSatpam } from "@/lib/require-access";
import { getJadwalDetail } from "@/lib/queries/pengiriman-jadwal";
import { getPool, sql } from "@/lib/db";
import { LiveInspeksiClient } from "@/components/satpam-app/live-inspeksi-client";
import type { VehicleCheckTipe } from "@/lib/vehicle-check-types";

export default async function LiveInspeksiPage({
  params,
  searchParams,
}: {
  params: Promise<{ jadwalId: string }>;
  searchParams: Promise<{ tipe?: string }>;
}) {
  await requireSatpam();
  const { jadwalId: jadwalIdParam } = await params;
  const { tipe: tipeParam } = await searchParams;
  const jadwalId = Number(jadwalIdParam);
  const tipe: VehicleCheckTipe = tipeParam === "DATANG" ? "DATANG" : "BERANGKAT";
  if (!Number.isInteger(jadwalId)) notFound();

  const pool = await getPool();
  const headerResult = await pool
    .request()
    .input("jadwalId", sql.Int, jadwalId).query(`
      SELECT j.ArmadaID, a.Nama AS ArmadaNama, ISNULL(ed.VehicleNo, a.Nama) AS VehicleNo, sm.Name AS DriverName
      FROM DashboardPengirimanJadwal j
      JOIN DashboardArmada a ON a.ArmadaID = j.ArmadaID AND a.IsDeleted = 0
      LEFT JOIN ExpeditionDetail ed ON ed.ExpeditionDetailID = a.ExpeditionDetailID AND ed.IsDeleted = 0
      LEFT JOIN Salesman sm ON sm.SalesmanID = j.SalesmanID
      WHERE j.JadwalID = @jadwalId AND j.IsDeleted = 0
    `);
  const header = headerResult.recordset[0] as
    | { ArmadaID: number; ArmadaNama: string; VehicleNo: string | null; DriverName: string | null }
    | undefined;
  if (!header) notFound();

  const stops = await getJadwalDetail(jadwalId);
  const expectedMuatanQty = stops.reduce((sum, s) => sum + s.Qty, 0);

  return (
    <div className="dark">
      <LiveInspeksiClient
        jadwalId={jadwalId}
        armadaId={header.ArmadaID}
        tipe={tipe}
        armadaNama={header.ArmadaNama}
        vehicleNo={header.VehicleNo}
        driverName={header.DriverName}
        expectedMuatanQty={expectedMuatanQty}
      />
    </div>
  );
}
