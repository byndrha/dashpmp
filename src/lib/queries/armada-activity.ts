import { getPool, sql } from "@/lib/db";
import type { ArmadaActivityType, ArmadaActivity } from "@/lib/armada-activity-types";
import { AppError } from "@/lib/action-result";

// Constants/types moved to lib/armada-activity-types.ts (DB-free) so
// pengiriman-board.tsx, a client component, can import them without
// bundling this file's mssql-dependent query functions into the browser.
export type { ArmadaActivityType, ArmadaActivity } from "@/lib/armada-activity-types";
export { ARMADA_ACTIVITY_TYPES, ARMADA_ACTIVITY_LABEL } from "@/lib/armada-activity-types";

// Same 14:00 WIB rollover window as getPengirimanBoard's businessDate —
// see the comment there. Overlap (not fully-contained) so an activity that
// straddles the window boundary still shows up, clipped visually by the
// board itself rather than hidden entirely.
export async function getArmadaActivities(businessDate: string): Promise<ArmadaActivity[]> {
  const pool = await getPool();
  const result = await pool
    .request()
    .input("businessDate", sql.Date, businessDate).query(`
      SELECT ActivityID, ArmadaID, ActivityType, StartTime, EndTime, Notes
      FROM DashboardArmadaActivity
      WHERE IsDeleted = 0
        AND StartTime < DATEADD(HOUR, 7, CAST(@businessDate AS DATETIME))
        AND EndTime > DATEADD(HOUR, 7, DATEADD(DAY, -1, CAST(@businessDate AS DATETIME)))
      ORDER BY StartTime
    `);
  return result.recordset;
}

export interface CreateArmadaActivityInput {
  armadaId: number;
  activityType: ArmadaActivityType;
  startTime: Date;
  endTime: Date;
  notes: string | null;
  createdByUserId: string;
}

export async function createArmadaActivity(input: CreateArmadaActivityInput): Promise<number> {
  if (input.endTime <= input.startTime) {
    throw new AppError("Jam selesai harus setelah jam mulai.");
  }
  const pool = await getPool();
  const result = await pool
    .request()
    .input("armadaId", sql.Int, input.armadaId)
    .input("activityType", sql.VarChar(20), input.activityType)
    .input("startTime", sql.DateTime, input.startTime)
    .input("endTime", sql.DateTime, input.endTime)
    .input("notes", sql.VarChar(255), input.notes)
    .input("createdByUserId", sql.VarChar(16), input.createdByUserId).query(`
      INSERT INTO DashboardArmadaActivity (ArmadaID, ActivityType, StartTime, EndTime, Notes, IsDeleted, CreatedByUserID, ModifiedDate)
      OUTPUT inserted.ActivityID
      VALUES (@armadaId, @activityType, @startTime, @endTime, @notes, 0, @createdByUserId, GETDATE())
    `);
  return (result.recordset[0] as { ActivityID: number }).ActivityID;
}

export interface UpdateArmadaActivityInput {
  activityType: ArmadaActivityType;
  startTime: Date;
  endTime: Date;
  notes: string | null;
}

export async function updateArmadaActivity(activityId: number, input: UpdateArmadaActivityInput): Promise<void> {
  if (input.endTime <= input.startTime) {
    throw new AppError("Jam selesai harus setelah jam mulai.");
  }
  const pool = await getPool();
  await pool
    .request()
    .input("activityId", sql.Int, activityId)
    .input("activityType", sql.VarChar(20), input.activityType)
    .input("startTime", sql.DateTime, input.startTime)
    .input("endTime", sql.DateTime, input.endTime)
    .input("notes", sql.VarChar(255), input.notes).query(`
      UPDATE DashboardArmadaActivity
      SET ActivityType = @activityType, StartTime = @startTime, EndTime = @endTime, Notes = @notes, ModifiedDate = GETDATE()
      WHERE ActivityID = @activityId AND IsDeleted = 0
    `);
}

export async function deleteArmadaActivity(activityId: number): Promise<void> {
  const pool = await getPool();
  await pool
    .request()
    .input("activityId", sql.Int, activityId)
    .query(`UPDATE DashboardArmadaActivity SET IsDeleted = 1, ModifiedDate = GETDATE() WHERE ActivityID = @activityId`);
}
