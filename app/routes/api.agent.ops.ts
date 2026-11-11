import { OpError } from "../../src/op-error.ts";
import { applyOps } from "../../src/ops.ts";
import { isPost, readJson } from "../auth.server.ts";
import { agentJson, requireApiToken, tokenWho } from "../agent-auth.server.ts";
import type { Route } from "./+types/api.agent.ops";

/**
 * POST /api/agent/ops — ops sent with an API token. Same body and answer as
 * /api/ops (`{ ops }` → `{ results }`, one per op, through the same
 * idempotency ledger by opId), limited to what the token's scope allows:
 * other op types come back `forbidden`, and so does any change to hours that
 * aren't a draft. Each op is recorded against the token.
 */
export async function action({ request }: Route.ActionArgs) {
  isPost(request);
  const resolved = requireApiToken(request);
  const body = await readJson(request);
  try {
    return agentJson({ results: applyOps(tokenWho(resolved), body.ops) });
  } catch (err) {
    if (err instanceof OpError) return agentJson({ error: err.message, code: err.code }, { status: 400 });
    throw err;
  }
}
