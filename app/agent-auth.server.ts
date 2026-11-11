import { type ResolvedApiToken, SCOPE_OPS, resolveApiToken } from "../src/api-tokens.ts";
import type { Who } from "../src/ops.ts";

/**
 * Auth for /api/agent/*: an API token in `Authorization: Bearer …`, and
 * nothing else. These routes never read the session cookie, and no other
 * route reads this header, so a token can't reach a page or an admin action
 * and a browser session can't be borrowed by a script.
 *
 * No Origin check here, unlike the cookie routes: that check stops another
 * site from using the browser's ambient cookie, and a bearer token is never
 * sent by a browser on its own.
 */

function unauthorized(error: string): Response {
  return Response.json(
    { error, code: "unauthorized" },
    { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="LibreHours"', "Cache-Control": "no-store" } },
  );
}

/** The token a request carries and its person, or a 401 to throw. */
export function requireApiToken(request: Request): ResolvedApiToken {
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) throw unauthorized("Send an API token as Authorization: Bearer <token>.");
  const resolved = resolveApiToken(match[1]);
  // One answer for unknown, revoked, expired and deactivated: which one it
  // was is the token owner's business, not the caller's.
  if (!resolved) throw unauthorized("That token isn't valid. It may have been revoked or have expired.");
  return resolved;
}

/** Who a token's ops act as, and what it may send. */
export function tokenWho({ apiToken, user }: ResolvedApiToken): Who {
  return { userId: user.id, actorUserId: user.id, apiToken: { id: apiToken.id, ops: SCOPE_OPS[apiToken.scope] } };
}

/** JSON that's never cached: everything here is one person's own data. */
export function agentJson(body: unknown, init?: ResponseInit): Response {
  const headers = new Headers(init?.headers);
  headers.set("Cache-Control", "no-store");
  return Response.json(body, { ...init, headers });
}
