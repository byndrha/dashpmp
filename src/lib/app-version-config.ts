// Manually bumped alongside every APK release. APP_MIN_VERSION_CODE is
// raised once an old APK build is no longer safe to run (e.g. it lacks a
// native permission or plugin the current web bundle assumes exists).
// APP_LATEST_VERSION_CODE/_NAME track the newest available build so
// slightly-behind-but-still-supported devices get a non-blocking nudge.
// Because the web bundle is always loaded fresh from server.url, editing
// these constants and deploying is the entire "publish a new version
// rule" workflow — no DB, no admin UI, no API call.
export const APP_MIN_VERSION_CODE = 1;
export const APP_LATEST_VERSION_CODE = 1;
export const APP_LATEST_VERSION_NAME = "1.0";

export type AppVersionStatus = "blocked" | "update-available" | "current";

export function classifyAppVersion(
  currentVersionCode: number,
  minVersionCode: number,
  latestVersionCode: number
): AppVersionStatus {
  if (currentVersionCode < minVersionCode) return "blocked";
  if (currentVersionCode < latestVersionCode) return "update-available";
  return "current";
}
