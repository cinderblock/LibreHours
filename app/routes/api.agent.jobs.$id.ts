import { z } from "zod";

import { setJobBillableWithToken } from "../../src/agent-jobs.ts";
import { OpError } from "../../src/op-error.ts";
import { isPost, readJson } from "../auth.server.ts";
import { agentJson, requireApiToken } from "../agent-auth.server.ts";
import type { Route } from "./+types/api.agent.jobs.$id";

const body = z.object({ billable: z.boolean().nullable() }).strict();

const STATUS: Partial<Record<OpError["code"], number>> = { forbidden: 403, not_found: 404 };

/**
 * POST /api/agent/jobs/:id `{ billable: true | false | null }` — whether time
 * on a job goes to the accounting system as billable (null follows the row
 * above). Only for a token whose person is an admin (src/agent-jobs.ts).
 * Answers `{ job: { id, fullName, billable, billed } }`, `billed` being what
 * applies after inheritance.
 */
export async function action({ request, params }: Route.ActionArgs) {
  isPost(request);
  const resolved = requireApiToken(request);
  const parsed = body.safeParse(await readJson(request));
  if (!parsed.success) {
    return agentJson({ error: "Send { billable: true, false or null }.", code: "invalid" }, { status: 400 });
  }
  try {
    const job = setJobBillableWithToken(resolved, params.id, parsed.data.billable);
    return agentJson({ job: { id: job.id, fullName: job.fullName, billable: job.billable, billed: job.billed } });
  } catch (err) {
    if (err instanceof OpError) return agentJson({ error: err.message, code: err.code }, { status: STATUS[err.code] ?? 400 });
    throw err;
  }
}
