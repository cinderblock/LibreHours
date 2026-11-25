import { beforeEach, describe, expect, test } from "bun:test";

import { setJobBillableWithToken } from "./agent-jobs.ts";
import { createApiToken, resolveApiToken, tokenJobSettings } from "./api-tokens.ts";
import { db } from "./db.server.ts";
import { createJob, getJob } from "./jobs.ts";
import { OpError } from "./op-error.ts";
import { freshDb } from "./testing/db.ts";
import { createUser } from "./users.ts";
import { uuidv7 } from "./uuid.ts";

let adminId = 0;
let workerId = 0;
let customer = "";
let job = "";

function tokenFor(userId: number) {
  const { token } = createApiToken({ userId, actorUserId: userId, name: "Agent", lifetimeMs: null });
  return resolveApiToken(token)!;
}

function refusal(fn: () => unknown): OpError {
  try {
    fn();
  } catch (err) {
    if (err instanceof OpError) return err;
    throw err;
  }
  throw new Error("expected an OpError");
}

beforeEach(() => {
  freshDb();
  adminId = createUser({ name: "Admin", role: "admin", actorUserId: null }).id;
  workerId = createUser({ name: "Worker", role: "employee", actorUserId: null }).id;
  customer = uuidv7();
  job = uuidv7();
  createJob({ id: customer, name: "Acme", actorUserId: adminId });
  createJob({ id: job, name: "Intro", parentId: customer, actorUserId: adminId });
});

describe("a token setting whether a job is billable", () => {
  test("an admin's token can, and it's audited against the token", () => {
    const token = tokenFor(adminId);
    expect(tokenJobSettings(token)).toEqual(["billable"]);
    const updated = setJobBillableWithToken(token, job, false);
    expect(updated).toMatchObject({ billable: false, billed: false });
    expect(getJob(job)!.billed).toBe(false);

    const row = db()
      .query<{ actor_user_id: number; device_id: string; after_json: string }, [string]>(
        "SELECT actor_user_id, device_id, after_json FROM audit_log WHERE entity = 'job' AND entity_id = ? AND action = 'update'",
      )
      .get(job)!;
    expect(row.actor_user_id).toBe(adminId);
    expect(row.device_id).toBe(`token:${token.apiToken.id}`);
    expect(JSON.parse(row.after_json)).toMatchObject({ billable: false });
  });

  test("null goes back to following the row above", () => {
    const token = tokenFor(adminId);
    setJobBillableWithToken(token, customer, false);
    setJobBillableWithToken(token, job, true);
    expect(getJob(job)!.billed).toBe(true);
    expect(setJobBillableWithToken(token, job, null)).toMatchObject({ billable: null, billed: false });
  });

  test("a non-admin's token can't, as its person can't", () => {
    const token = tokenFor(workerId);
    expect(tokenJobSettings(token)).toEqual([]);
    expect(refusal(() => setJobBillableWithToken(token, job, false)).code).toBe("forbidden");
    expect(getJob(job)!.billable).toBeNull();
  });

  test("an unknown or merged job is not found", () => {
    const token = tokenFor(adminId);
    expect(refusal(() => setJobBillableWithToken(token, uuidv7(), false)).code).toBe("not_found");
    const other = uuidv7();
    createJob({ id: other, name: "Old", parentId: customer, actorUserId: adminId });
    db().query("UPDATE jobs SET merged_into = ? WHERE id = ?").run(job, other);
    expect(refusal(() => setJobBillableWithToken(token, other, false)).code).toBe("not_found");
  });
});
