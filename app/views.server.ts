import { listApiTokens } from "../src/api-tokens.ts";
import { listCredentials } from "../src/credentials.ts";
import { formatDate, formatRelative } from "../src/format.ts";
import { listSessions } from "../src/sessions.ts";
import { describeUserAgent } from "../src/user-agent.ts";
import type { ApiTokenView } from "./components/api-tokens.tsx";
import type { PasskeyView, SessionView } from "./components/credential-lists.tsx";

/** A person's passkeys, shaped for display. */
export function passkeyViews(userId: number, now = Date.now()): PasskeyView[] {
  return listCredentials(userId).map((c) => ({
    id: c.id,
    nickname: c.nickname,
    created: formatDate(c.createdAt),
    lastUsed: c.lastUsedAt ? formatRelative(c.lastUsedAt, now) : "never",
    synced: c.backedUp,
  }));
}

/** A person's live sessions, shaped for display. */
export function sessionViews(userId: number, currentSessionId: string | null, now = Date.now()): SessionView[] {
  return listSessions(userId, now).map((s) => ({
    id: s.id,
    device: describeUserAgent(s.userAgent),
    passkey: s.credentialNickname,
    lastUsed: formatRelative(s.lastUsedAt, now),
    current: s.id === currentSessionId,
  }));
}

/** A person's live API tokens, shaped for display. Never the token itself: that isn't kept. */
export function apiTokenViews(userId: number, now = Date.now()): ApiTokenView[] {
  return listApiTokens(userId, now).map((t) => ({
    id: t.id,
    name: t.name,
    hint: `lh_…${t.hint}`,
    created: formatDate(t.createdAt),
    lastUsed: t.lastUsedAt ? formatRelative(t.lastUsedAt, now) : "never",
    expires: t.expiresAt ? formatDate(t.expiresAt) : null,
  }));
}
