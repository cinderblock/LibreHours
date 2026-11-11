import { beforeEach, describe, expect, test } from "bun:test";

import { requireApiToken, tokenWho } from "../app/agent-auth.server.ts";
import { API_TOKEN_LIFETIMES } from "./api-token-options.ts";
import { MAX_LIVE_TOKENS, createApiToken, listApiTokens, resolveApiToken, revokeApiToken } from "./api-tokens.ts";
import { db } from "./db.server.ts";
import { getEntry, listEntriesForDate } from "./entries.ts";
import { listNotesForDate } from "./notes.ts";
import { applyOp } from "./ops.ts";
import type { OpPayload, OpResult, OpType, Op } from "./ops-schema.ts";
import { freshDb } from "./testing/db.ts";
import { UserInputError, createUser, updateUserAccess } from "./users.ts";
import { uuidv7 } from "./uuid.ts";

const MIN = 60_000;
const HOUR = 60 * MIN;
// 2026-09-16 09:00 in America/Los_Angeles is 16:00 UTC.
const NINE = Date.parse("2026-09-16T16:00:00Z");
const DAY = "2026-09-16";
const YEAR = API_TOKEN_LIFETIMES.find((l) => l.key === "1y")!.ms!;

let adminId = 0;
let userId = 0;
let jobA = "";
let jobB = "";

function op<T extends OpType>(type: T, payload: OpPayload<T>, opId = uuidv7()): Op {
  return { opId, type, deviceId: "agent-device", clientTime: NINE, payload } as Op;
}

/** As the person, from a signed-in device. */
function asPerson<T extends OpType>(type: T, payload: OpPayload<T>, opId?: string): OpResult {
  return applyOp(userId, op(type, payload, opId), NINE);
}

function ok(result: OpResult): OpResult {
  if (!result.ok) throw new Error(`expected ok, got ${result.code}: ${result.error}`);
  return result;
}

function refused(result: OpResult, code: string): string {
  expect(result.ok).toBe(false);
  if (result.ok) return "";
  expect(result.code).toBe(code as never);
  return result.error;
}

function makeToken(owner = userId, lifetimeMs: number | null = YEAR, now = NINE) {
  return createApiToken({ userId: owner, actorUserId: owner, name: "Claude daily hours", lifetimeMs, now });
}

function bearer(token: string | null, scheme = "Bearer"): Request {
  return new Request("http://localhost/api/agent/me", token ? { headers: { Authorization: `${scheme} ${token}` } } : {});
}

function thrownResponse(fn: () => unknown): Response {
  try {
    fn();
  } catch (err) {
    if (err instanceof Response) return err;
    throw err;
  }
  throw new Error("expected a thrown Response");
}

beforeEach(() => {
  process.env.TZ = "America/Los_Angeles";
  freshDb();
  adminId = createUser({ name: "Admin", role: "admin", actorUserId: null }).id;
  userId = createUser({ name: "Worker", role: "employee", actorUserId: null }).id;
  const customer = uuidv7();
  jobA = uuidv7();
  jobB = uuidv7();
  ok(asPerson("job.create", { jobId: customer, name: "Acme" }));
  ok(asPerson("job.create", { jobId: jobA, name: "Alpha", parentId: customer }));
  ok(asPerson("job.create", { jobId: jobB, name: "Bravo", parentId: customer }));
});

describe("making and revoking tokens", () => {
  test("the token is returned once; only its hash is stored", () => {
    const { token, apiToken } = makeToken();
    expect(token).toMatch(/^lh_[A-Za-z0-9_-]{43}$/);
    expect(apiToken.hint).toBe(token.slice(-4));
    expect(apiToken.expiresAt).toBe(NINE + YEAR);
    const stored = db().query<{ token_hash: string }, []>("SELECT token_hash FROM api_tokens").get()!;
    expect(stored.token_hash).not.toContain(token.slice(3));
    expect(stored.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("a name is required, and only the offered lifetimes are accepted", () => {
    expect(() => createApiToken({ userId, actorUserId: userId, name: "  ", lifetimeMs: YEAR })).toThrow(UserInputError);
    expect(() => createApiToken({ userId, actorUserId: userId, name: "x", lifetimeMs: 5 })).toThrow(UserInputError);
    expect(createApiToken({ userId, actorUserId: userId, name: "x", lifetimeMs: null }).apiToken.expiresAt).toBeNull();
  });

  test("there's a ceiling on live tokens", () => {
    for (let i = 0; i < MAX_LIVE_TOKENS; i++) makeToken();
    expect(() => makeToken()).toThrow(UserInputError);
    revokeApiToken({ id: listApiTokens(userId, NINE)[0]!.id, userId, actorUserId: userId, now: NINE });
    expect(() => makeToken()).not.toThrow();
  });

  test("resolves while live; not once revoked, expired, or its person is deactivated", () => {
    const { token, apiToken } = makeToken(userId, 30 * 24 * HOUR);
    expect(resolveApiToken(token, NINE)?.user.id).toBe(userId);
    expect(resolveApiToken(token, NINE + 30 * 24 * HOUR)).toBeNull();
    expect(resolveApiToken(token.slice(0, -1) + (token.endsWith("A") ? "B" : "A"), NINE)).toBeNull();
    expect(resolveApiToken(token.slice(3), NINE)).toBeNull();

    // Someone else can't revoke it.
    revokeApiToken({ id: apiToken.id, userId: adminId, actorUserId: adminId, now: NINE });
    expect(resolveApiToken(token, NINE)).not.toBeNull();
    revokeApiToken({ id: apiToken.id, userId, actorUserId: userId, now: NINE });
    expect(resolveApiToken(token, NINE)).toBeNull();
    expect(listApiTokens(userId, NINE)).toHaveLength(0);

    const second = makeToken();
    updateUserAccess({ userId, active: false, actorUserId: adminId });
    expect(resolveApiToken(second.token)).toBeNull();
    // Reactivating doesn't bring it back.
    updateUserAccess({ userId, active: true, actorUserId: adminId });
    expect(resolveApiToken(second.token)).toBeNull();
  });

  test("use is recorded, at most once a minute", () => {
    const { token, apiToken } = makeToken();
    expect(apiToken.lastUsedAt).toBeNull();
    expect(resolveApiToken(token, NINE + 1000)?.apiToken.lastUsedAt).toBe(NINE + 1000);
    expect(resolveApiToken(token, NINE + 2000)?.apiToken.lastUsedAt).toBe(NINE + 1000);
    expect(resolveApiToken(token, NINE + 1000 + MIN)?.apiToken.lastUsedAt).toBe(NINE + 1000 + MIN);
  });

  test("creation and revocation are audited, without the token", () => {
    const { token, apiToken } = makeToken();
    revokeApiToken({ id: apiToken.id, userId, actorUserId: userId, now: NINE });
    const rows = db()
      .query<{ action: string; after_json: string | null }, []>(
        "SELECT action, after_json FROM audit_log WHERE entity = 'api_token' ORDER BY id",
      )
      .all();
    expect(rows.map((r) => r.action)).toEqual(["create", "revoke"]);
    expect(JSON.stringify(rows)).not.toContain(token.slice(3));
  });
});

describe("the Authorization header", () => {
  test("takes a bearer token, and nothing else", () => {
    const { token } = makeToken();
    expect(requireApiToken(bearer(token)).user.id).toBe(userId);
    expect(requireApiToken(bearer(token, "bearer")).user.id).toBe(userId);
    for (const req of [bearer(null), bearer(token, "Basic"), bearer("lh_nope"), bearer(`${token} extra`)]) {
      const res = thrownResponse(() => requireApiToken(req));
      expect(res.status).toBe(401);
      expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
    }
  });
});

describe("ops sent with a token", () => {
  function asToken<T extends OpType>(token: string, type: T, payload: OpPayload<T>, opId?: string): OpResult {
    const resolved = resolveApiToken(token, NINE)!;
    return applyOp(tokenWho(resolved), op(type, payload, opId), NINE);
  }

  test("adds draft hours, recorded against the token", () => {
    const { token, apiToken } = makeToken();
    const entryId = uuidv7();
    ok(asToken(token, "entry.create", { entryId, jobId: jobA, workDate: DAY, durationSeconds: 2 * 3600, note: "Bench test" }));
    const entry = getEntry(entryId)!;
    expect(entry.status).toBe("draft");
    expect(entry.durationSeconds).toBe(2 * 3600);
    const ledger = db()
      .query<{ api_token_id: number; device_id: string; actor_user_id: number }, []>(
        "SELECT api_token_id, device_id, actor_user_id FROM applied_ops WHERE type = 'entry.create'",
      )
      .get()!;
    expect(ledger).toEqual({ api_token_id: apiToken.id, device_id: `token:${apiToken.id}`, actor_user_id: userId });
  });

  test("is idempotent by opId", () => {
    const { token } = makeToken();
    const opId = uuidv7();
    const entryId = uuidv7();
    const payload = { entryId, jobId: jobA, workDate: DAY, durationSeconds: 3600 };
    const first = ok(asToken(token, "entry.create", payload, opId));
    expect(asToken(token, "entry.create", payload, opId)).toEqual(first);
    expect(listEntriesForDate(userId, DAY)).toHaveLength(1);
    expect(getEntry(entryId)!.durationSeconds).toBe(3600);
  });

  test("refuses every op type outside its scope, without recording it", () => {
    const { token } = makeToken();
    const entryId = uuidv7();
    ok(asPerson("entry.create", { entryId, jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    const attempts: Op[] = [
      op("day.submit", { workDate: DAY }),
      op("day.unsubmit", { workDate: DAY }),
      op("entry.delete", { entryId, at: NINE }),
      op("timer.start", { entryId: uuidv7(), jobId: jobA, at: NINE }),
      op("job.create", { jobId: uuidv7(), name: "Sneaky" }),
      op("note.create", { noteId: uuidv7(), at: NINE, text: "hi", jobId: jobA }),
      op("notes.leave_out", { noteIds: [uuidv7()], at: NINE }),
      op("duplicate.resolve", { entryId, action: "discard" }),
      op("entry.combine", { intoEntryId: entryId, entryIds: [uuidv7()] }),
    ];
    const resolved = resolveApiToken(token, NINE)!;
    for (const attempt of attempts) {
      refused(applyOp(tokenWho(resolved), attempt, NINE), "forbidden");
    }
    expect(getEntry(entryId)!.status).toBe("draft");
    const recorded = db()
      .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM applied_ops WHERE api_token_id IS NOT NULL")
      .get()!.n;
    expect(recorded).toBe(0);
  });

  test("can't read back the result of another kind of op by replaying its id", () => {
    const { token } = makeToken();
    ok(asPerson("entry.create", { entryId: uuidv7(), jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    const submitId = uuidv7();
    ok(asPerson("day.submit", { workDate: DAY }, submitId));
    refused(asToken(token, "day.submit", { workDate: DAY }, submitId), "forbidden");
  });

  test("won't add to hours already submitted, which would take them back", () => {
    const { token } = makeToken();
    const lineId = uuidv7();
    ok(asPerson("entry.create", { entryId: lineId, jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    ok(asPerson("day.submit", { workDate: DAY }));

    const error = refused(
      asToken(token, "entry.create", { entryId: uuidv7(), jobId: jobA, workDate: DAY, durationSeconds: 1800 }),
      "forbidden",
    );
    expect(error).toContain("submitted");
    const line = getEntry(lineId)!;
    expect(line.status).toBe("submitted");
    expect(line.durationSeconds).toBe(3600);

    // A different job that day is a new draft line, which is fine.
    ok(asToken(token, "entry.create", { entryId: uuidv7(), jobId: jobB, workDate: DAY, durationSeconds: 1800 }));
    expect(getEntry(lineId)!.status).toBe("submitted");
  });

  test("joins a draft line, as the app does", () => {
    const { token } = makeToken();
    const lineId = uuidv7();
    ok(asPerson("entry.create", { entryId: lineId, jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    ok(asToken(token, "entry.create", { entryId: uuidv7(), jobId: jobA, workDate: DAY, durationSeconds: 1800 }));
    expect(getEntry(lineId)!.durationSeconds).toBe(5400);
  });

  test("updates only drafts: not submitted hours, not a running timer", () => {
    const { token } = makeToken();
    const draftId = uuidv7();
    ok(asPerson("entry.create", { entryId: draftId, jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    ok(asToken(token, "entry.update", { entryId: draftId, durationSeconds: 7200, note: "More" }));
    expect(getEntry(draftId)!.durationSeconds).toBe(7200);

    ok(asPerson("day.submit", { workDate: DAY }));
    refused(asToken(token, "entry.update", { entryId: draftId, durationSeconds: 3600 }), "forbidden");
    expect(getEntry(draftId)!.durationSeconds).toBe(7200);

    const timerId = uuidv7();
    ok(asPerson("timer.start", { entryId: timerId, jobId: jobB, at: NINE - HOUR }));
    refused(asToken(token, "entry.update", { entryId: timerId, note: "hi" }), "forbidden");
  });

  test("rolls notes into hours, but not onto submitted hours", () => {
    const { token } = makeToken();
    const noteA = uuidv7();
    const noteB = uuidv7();
    ok(asPerson("note.create", { noteId: noteA, at: NINE - 2 * HOUR, kind: "note", text: "Wiring", jobId: jobA }));
    ok(asPerson("note.create", { noteId: noteB, at: NINE - HOUR, kind: "note", text: "Docs", jobId: jobB }));

    const lineB = uuidv7();
    ok(asPerson("entry.create", { entryId: lineB, jobId: jobB, workDate: DAY, durationSeconds: 3600 }));
    ok(asPerson("day.submit", { workDate: DAY }));

    // Job B's hours are submitted: the whole rollup is refused, nothing half-done.
    refused(
      asToken(token, "rollup.commit", {
        workDate: DAY,
        lines: [
          { entryId: uuidv7(), jobId: jobA, noteIds: [noteA], durationSeconds: 3600, note: "Wiring" },
          { entryId: uuidv7(), jobId: jobB, noteIds: [noteB], durationSeconds: 1800, note: "Docs" },
        ],
      }),
      "forbidden",
    );
    expect(listEntriesForDate(userId, DAY).map((e) => e.jobId)).toEqual([jobB]);
    expect(getEntry(lineB)!.status).toBe("submitted");

    const lineA = uuidv7();
    ok(
      asToken(token, "rollup.commit", {
        workDate: DAY,
        lines: [{ entryId: lineA, jobId: jobA, noteIds: [noteA], durationSeconds: 3600, note: "Wiring" }],
      }),
    );
    expect(getEntry(lineA)!.status).toBe("draft");
    expect(listNotesForDate(userId, DAY).find((n) => n.id === noteA)!.rolledIntoEntryId).toBe(lineA);
  });

  test("a signed-in device is unaffected: it still takes submitted hours back to add to them", () => {
    const lineId = uuidv7();
    ok(asPerson("entry.create", { entryId: lineId, jobId: jobA, workDate: DAY, durationSeconds: 3600 }));
    ok(asPerson("day.submit", { workDate: DAY }));
    ok(asPerson("entry.create", { entryId: uuidv7(), jobId: jobA, workDate: DAY, durationSeconds: 1800 }));
    expect(getEntry(lineId)!.status).toBe("draft");
    expect(getEntry(lineId)!.durationSeconds).toBe(5400);
  });
});
