import { beforeEach, describe, expect, test } from "bun:test";

import { applyOp } from "../../src/ops.ts";
import type { Op, OpPayload, OpType } from "../../src/ops-schema.ts";
import { freshDb } from "../../src/testing/db.ts";
import { createUser, setTrackingMode } from "../../src/users.ts";
import { uuidv7 } from "../../src/uuid.ts";
import { loadDay } from "../tracker.server.ts";
import { daySignedOff, pendingNotesNeedYou } from "./model.ts";

/**
 * What counts as waiting on the person, on the screen and in the week strip:
 * the same rules in both, so a day marked in the strip has something marked
 * on it when it's opened.
 */

const NINE = Date.parse("2026-09-16T16:00:00Z"); // 09:00 in Los Angeles
const DAY = "2026-09-16"; // a day gone by
const NEXT = "2026-09-17";

let userId = 0;
let job = "";

const op = <T extends OpType>(type: T, payload: OpPayload<T>): Op =>
  ({ opId: uuidv7(), type, deviceId: "t", clientTime: NINE, payload }) as Op;

function apply<T extends OpType>(type: T, payload: OpPayload<T>) {
  const r = applyOp(userId, op(type, payload), NINE);
  if (!r.ok) throw new Error(r.error);
}

const flagged = (date: string) => loadDay(userId, DAY).week.find((d) => d.date === date)?.needsYou === true;

beforeEach(() => {
  freshDb();
  userId = createUser({ name: "W", role: "employee", actorUserId: null }).id;
  setTrackingMode({ userId, mode: "notes", actorUserId: userId });
  const customer = uuidv7();
  job = uuidv7();
  apply("job.create", { jobId: customer, name: "Acme", parentId: null });
  apply("job.create", { jobId: job, name: "Alpha", parentId: customer });
});

describe("pendingNotesNeedYou", () => {
  const base = { mode: "notes" as const, workDate: "2026-11-09", today: "2026-11-09", entries: [] };
  test("today's notes in notes mode are work under way", () => {
    expect(pendingNotesNeedYou(base)).toBe(false);
  });
  test("a day gone by, a submitted day, or leftovers in timer mode wait on the person", () => {
    expect(pendingNotesNeedYou({ ...base, workDate: "2026-11-08" })).toBe(true);
    expect(pendingNotesNeedYou({ ...base, entries: [{ status: "submitted" as const }] })).toBe(true);
    expect(pendingNotesNeedYou({ ...base, mode: "timer" })).toBe(true);
  });
  test("a day is signed off only when it has time and all of it is", () => {
    expect(daySignedOff([])).toBe(false);
    expect(daySignedOff([{ status: "synced" }, { status: "submitted" }])).toBe(true);
    expect(daySignedOff([{ status: "synced" }, { status: "draft" }])).toBe(false);
  });
});

describe("the week strip's needs-you days", () => {
  test("a note not yet hours on a day gone by marks it, until it's hours", () => {
    const start = uuidv7();
    const note = uuidv7();
    apply("note.create", { noteId: start, at: NINE, kind: "start", jobId: job });
    apply("note.create", { noteId: note, at: NINE + 60_000, text: "Framing", jobId: job });
    expect(flagged(DAY)).toBe(true);
    expect(flagged(NEXT)).toBe(false);

    apply("rollup.commit", {
      workDate: DAY,
      lines: [{ entryId: uuidv7(), jobId: job, durationSeconds: 3600, note: "Framing", noteIds: [start, note] }],
    });
    // Hours now, but not submitted, on a day gone by: still waiting.
    expect(flagged(DAY)).toBe(true);
    apply("day.submit", { workDate: DAY });
    expect(flagged(DAY)).toBe(false);
  });

  test("a note added after the day was submitted marks it again", () => {
    apply("entry.create", { entryId: uuidv7(), jobId: job, workDate: DAY, durationSeconds: 600 });
    apply("day.submit", { workDate: DAY });
    expect(flagged(DAY)).toBe(false);
    apply("note.create", { noteId: uuidv7(), at: NINE, text: "Forgot this", jobId: job });
    expect(flagged(DAY)).toBe(true);
  });
});
