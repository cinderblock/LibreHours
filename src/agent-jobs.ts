import { type ResolvedApiToken, tokenJobSettings } from "./api-tokens.ts";
import { type Job, getJob, updateJob } from "./jobs.ts";
import { OpError } from "./op-error.ts";
import { UserInputError } from "./users.ts";

/**
 * Job settings an API token may change (POST /api/agent/jobs/:id). Only
 * `billable`, and only for a token whose person is an admin, who could change
 * it on the Jobs page anyway: an agent that books a client's intro meeting to
 * a job can then say the time isn't billable without a browser.
 *
 * Not an op: a job setting isn't part of anyone's day, the device never sends
 * it, and setting a value twice is already harmless.
 */
export function setJobBillableWithToken(
  token: ResolvedApiToken,
  jobId: string,
  /** Null goes back to following the row above. */
  billable: boolean | null,
): Job {
  if (!tokenJobSettings(token).includes("billable")) {
    throw new OpError("forbidden", "Only an admin's token can change whether a job is billable.");
  }
  const job = getJob(jobId);
  if (!job || job.mergedInto) throw new OpError("not_found", "That job doesn't exist.");
  try {
    return updateJob({ id: job.id, billable, actorUserId: token.user.id, deviceId: `token:${token.apiToken.id}` });
  } catch (err) {
    if (err instanceof UserInputError) throw new OpError("invalid", err.message);
    throw err;
  }
}
