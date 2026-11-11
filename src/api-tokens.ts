import { audit } from "./audit.ts";
import { randomToken, sha256Hex } from "./crypto.ts";
import { API_TOKEN_LIFETIMES } from "./api-token-options.ts";
import { db } from "./db.server.ts";
import { NICKNAME_MAX_LENGTH } from "./limits.ts";
import type { OpType } from "./ops-schema.ts";
import { type User, UserInputError, getUser } from "./users.ts";

/**
 * API tokens: how a script or agent works with one person's time without a
 * browser. The person makes one on their Account page, sees it once, and can
 * revoke it at any time. Only its SHA-256 is stored.
 *
 * A token is accepted only on /api/agent/* (app/agent-auth.server.ts), and only
 * for what its scope allows. There is one scope:
 *
 *   drafts — read the person's days, and add or change *draft* hours. It can't
 *            submit or take back a day, change hours already submitted (not
 *            even by adding to them, which would take them back), run timers,
 *            change notes, create jobs, or reach anything an admin page does.
 */

export const API_TOKEN_PREFIX = "lh_";

export const API_TOKEN_SCOPES = ["drafts"] as const;
export type ApiTokenScope = (typeof API_TOKEN_SCOPES)[number];

/** The ops each scope may send. Anything not listed is refused. */
export const SCOPE_OPS: Record<ApiTokenScope, ReadonlySet<OpType>> = {
  drafts: new Set<OpType>(["entry.create", "entry.update", "rollup.commit"]),
};

/** Enough for every agent a person runs; more is more likely a leak than a need. */
export const MAX_LIVE_TOKENS = 20;

/** last_used_at is written at most this often, so a busy agent isn't a write per call. */
const TOUCH_INTERVAL_MS = 60_000;

export interface ApiToken {
  id: number;
  userId: number;
  name: string;
  hint: string;
  scope: ApiTokenScope;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

interface Row {
  id: number;
  user_id: number;
  name: string;
  hint: string;
  scope: ApiTokenScope;
  created_at: number;
  expires_at: number | null;
  last_used_at: number | null;
  revoked_at: number | null;
}

const COLUMNS = "id, user_id, name, hint, scope, created_at, expires_at, last_used_at, revoked_at";

function toToken(r: Row): ApiToken {
  return {
    id: r.id,
    userId: r.user_id,
    name: r.name,
    hint: r.hint,
    scope: r.scope,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    lastUsedAt: r.last_used_at,
    revokedAt: r.revoked_at,
  };
}

/** Live: not revoked and not expired. */
const LIVE = "revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?)";

/**
 * Make a token. Returns the token itself, which is not stored and can't be
 * shown again.
 */
export function createApiToken(args: {
  userId: number;
  actorUserId: number;
  name: string;
  scope?: ApiTokenScope;
  /** How long it lasts; null for no expiry. */
  lifetimeMs: number | null;
  now?: number;
}): { token: string; apiToken: ApiToken } {
  const now = args.now ?? Date.now();
  const name = args.name.trim();
  if (!name) throw new UserInputError("Name the token, so you can tell later what uses it.");
  if (name.length > NICKNAME_MAX_LENGTH) throw new UserInputError(`Keep the name under ${NICKNAME_MAX_LENGTH} characters.`);
  if (!API_TOKEN_LIFETIMES.some((l) => l.ms === args.lifetimeMs)) throw new UserInputError("Pick how long the token lasts.");
  const scope = args.scope ?? "drafts";
  if (!API_TOKEN_SCOPES.includes(scope)) throw new UserInputError("That isn't a kind of token.");

  const live = db()
    .query<{ n: number }, [number, number]>(`SELECT COUNT(*) AS n FROM api_tokens WHERE user_id = ? AND ${LIVE}`)
    .get(args.userId, now)!.n;
  if (live >= MAX_LIVE_TOKENS) {
    throw new UserInputError(`You already have ${live} tokens. Revoke one you no longer use first.`);
  }

  const token = API_TOKEN_PREFIX + randomToken(32);
  const row = db()
    .query<Row, [number, string, string, string, string, number, number | null]>(
      `INSERT INTO api_tokens (user_id, name, token_hash, hint, scope, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${COLUMNS}`,
    )
    .get(args.userId, name, sha256Hex(token), token.slice(-4), scope, now, args.lifetimeMs == null ? null : now + args.lifetimeMs)!;
  const apiToken = toToken(row);
  audit({
    actorUserId: args.actorUserId,
    entity: "api_token",
    entityId: apiToken.id,
    action: "create",
    after: { userId: apiToken.userId, name: apiToken.name, scope: apiToken.scope, expiresAt: apiToken.expiresAt },
    at: now,
  });
  return { token, apiToken };
}

export interface ResolvedApiToken {
  apiToken: ApiToken;
  user: User;
}

/**
 * The live token and active person a bearer value names, or null. Anything
 * not shaped like one of ours is refused before the database is asked.
 */
export function resolveApiToken(token: string | null | undefined, now: number = Date.now()): ResolvedApiToken | null {
  if (!token || !token.startsWith(API_TOKEN_PREFIX) || token.length > 100) return null;
  const row = db()
    .query<Row, [string, number]>(`SELECT ${COLUMNS} FROM api_tokens WHERE token_hash = ? AND ${LIVE}`)
    .get(sha256Hex(token), now);
  if (!row) return null;
  const user = getUser(row.user_id);
  if (!user?.active) return null;

  let apiToken = toToken(row);
  if (apiToken.lastUsedAt == null || now - apiToken.lastUsedAt >= TOUCH_INTERVAL_MS) {
    db().query("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(now, apiToken.id);
    apiToken = { ...apiToken, lastUsedAt: now };
  }
  return { apiToken, user };
}

/** A person's live tokens, newest first. */
export function listApiTokens(userId: number, now: number = Date.now()): ApiToken[] {
  return db()
    .query<Row, [number, number]>(
      `SELECT ${COLUMNS} FROM api_tokens WHERE user_id = ? AND ${LIVE} ORDER BY created_at DESC, id DESC`,
    )
    .all(userId, now)
    .map(toToken);
}

/** Revoke one of a person's tokens. Revoking one already gone is a no-op. */
export function revokeApiToken(args: { id: number; userId: number; actorUserId: number; now?: number }): void {
  const now = args.now ?? Date.now();
  const result = db()
    .query("UPDATE api_tokens SET revoked_at = ? WHERE id = ? AND user_id = ? AND revoked_at IS NULL")
    .run(now, args.id, args.userId);
  if (result.changes === 1) {
    audit({ actorUserId: args.actorUserId, entity: "api_token", entityId: args.id, action: "revoke", at: now });
  }
}
