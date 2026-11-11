/**
 * The choices offered when making an API token (src/api-tokens.ts), shared
 * with the Account page. Dependency-free: the browser imports it.
 */

const DAY = 24 * 3600_000;

/** How long a new token lasts. `null` never expires. The first is the default. */
export const API_TOKEN_LIFETIMES: readonly { key: string; label: string; ms: number | null }[] = [
  { key: "1y", label: "1 year", ms: 365 * DAY },
  { key: "90d", label: "90 days", ms: 90 * DAY },
  { key: "30d", label: "30 days", ms: 30 * DAY },
  { key: "never", label: "Never expires", ms: null },
];
