import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/** The database file's name unless a deployment says otherwise. */
export const DEFAULT_DATABASE_FILE = "librehours.db";

/** What the file was called before the app was LibreHours. */
export const LEGACY_DATABASE_FILE = "time-tracker.db";

/**
 * Where the SQLite file is. LibreHours used to be called time-tracker, and a
 * data directory from then holds `time-tracker.db`. When the configured file
 * has the default name, doesn't exist yet and the old file sits beside it, the
 * old file is the data: starting an empty database next to it would look like
 * everyone's time had vanished. Any other configured path is taken as given.
 */
export function resolveDatabasePath(
  configured: string | undefined,
  exists: (path: string) => boolean = existsSync,
): { path: string; legacy: boolean } {
  const path = configured || join(".", "data", DEFAULT_DATABASE_FILE);
  if (basename(path) !== DEFAULT_DATABASE_FILE || exists(path)) return { path, legacy: false };
  const legacy = join(dirname(path), LEGACY_DATABASE_FILE);
  return exists(legacy) ? { path: legacy, legacy: true } : { path, legacy: false };
}
