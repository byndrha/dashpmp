import { getPool, sql } from "@/lib/db";

export interface SiteSettings {
  title: string;
  description: string | null;
  faviconPath: string | null;
  ogImagePath: string | null;
}

// Only used if the seeded row is ever somehow missing (should never happen —
// the migration that created DashboardSiteSettings always inserts exactly
// one row) — same defensive-fallback shape as pabrik-location.ts.
const SITE_SETTINGS_FALLBACK: SiteSettings = {
  title: "Dashboard PMP Group",
  description: "Dashboard operasional PT Mitra Kelola Esindo (Ponorogo)",
  faviconPath: null,
  ogImagePath: null,
};

export async function getSiteSettings(): Promise<SiteSettings> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT TOP 1 Title, Description, FaviconPath, OgImagePath FROM DashboardSiteSettings ORDER BY ID
  `);
  const row = result.recordset[0] as
    | { Title: string; Description: string | null; FaviconPath: string | null; OgImagePath: string | null }
    | undefined;
  if (!row) return SITE_SETTINGS_FALLBACK;
  return {
    title: row.Title,
    description: row.Description,
    faviconPath: row.FaviconPath,
    ogImagePath: row.OgImagePath,
  };
}

export async function setSiteSettings(input: SiteSettings): Promise<void> {
  const pool = await getPool();
  const existing = await pool.request().query(`SELECT TOP 1 ID FROM DashboardSiteSettings ORDER BY ID`);
  const id = (existing.recordset[0] as { ID: number } | undefined)?.ID;

  const request = pool
    .request()
    .input("title", sql.VarChar(128), input.title)
    .input("description", sql.VarChar(512), input.description)
    .input("faviconPath", sql.VarChar(256), input.faviconPath)
    .input("ogImagePath", sql.VarChar(256), input.ogImagePath);

  if (id != null) {
    await request.input("id", sql.Int, id).query(`
      UPDATE DashboardSiteSettings
      SET Title = @title, Description = @description, FaviconPath = @faviconPath,
          OgImagePath = @ogImagePath, UpdatedAt = GETDATE()
      WHERE ID = @id
    `);
  } else {
    // Defensive only — the migration always seeds one row, so this branch
    // shouldn't run in practice.
    await request.query(`
      INSERT INTO DashboardSiteSettings (Title, Description, FaviconPath, OgImagePath)
      VALUES (@title, @description, @faviconPath, @ogImagePath)
    `);
  }
}
