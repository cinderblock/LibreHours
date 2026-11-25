import { SCOPE_OPS, tokenJobSettings } from "../../src/api-tokens.ts";
import { agentJson, requireApiToken } from "../agent-auth.server.ts";
import type { Route } from "./+types/api.agent.me";

/**
 * GET /api/agent/me — whose token this is and what it may do. A cheap way for
 * a script to check its token before doing anything with it.
 */
export function loader({ request }: Route.LoaderArgs) {
  const resolved = requireApiToken(request);
  const { apiToken, user } = resolved;
  return agentJson({
    user: { id: user.id, name: user.name },
    token: { id: apiToken.id, name: apiToken.name, scope: apiToken.scope, expiresAt: apiToken.expiresAt },
    ops: [...SCOPE_OPS[apiToken.scope]],
    // Job settings it may change at /api/agent/jobs/:id (none unless its person is an admin).
    jobSettings: tokenJobSettings(resolved),
  });
}
