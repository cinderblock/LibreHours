/**
 * A made-up organisation for the UI tour (tour.ts): two weeks of time for a
 * few people, in both tracking modes, with the states a person meets — a
 * day gone by with notes not yet hours, a day not submitted, a submitted
 * day, a running timer, a second line for one job.
 *
 * Run by tour.ts in its own process with DATABASE_PATH pointing at a fresh
 * file; prints the session cookies to stdout as JSON for the browser.
 * Every name here is invented.
 */
import { applyOp } from "../../src/ops.ts";
import type { Op, OpPayload, OpType } from "../../src/ops-schema.ts";
import { createSession } from "../../src/sessions.ts";
import { addDays, today } from "../../src/time.ts";
import { createUser, setNotesHoldNextDay, setTrackingMode } from "../../src/users.ts";
import { uuidv7 } from "../../src/uuid.ts";
import { db, initDb } from "../../src/db.server.ts";
import { config } from "../../src/config.server.ts";

initDb(undefined, () => {});
const { sessionCookie } = await import("../../app/auth.server.ts");

const tz = config.timezone;
const now = Date.now();
const todayDate = today(tz);

/** The instant of `hh:mm` on `date` in the organisation's zone. */
function at(date: string, hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number) as [number, number];
  // Walk from UTC noon on the date to the zone's wall time: exact across DST.
  const guess = Date.parse(`${date}T12:00:00Z`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "numeric",
    minute: "numeric",
    hourCycle: "h23",
  }).formatToParts(new Date(guess));
  const zh = Number(parts.find((p) => p.type === "hour")!.value);
  const zm = Number(parts.find((p) => p.type === "minute")!.value);
  return guess + ((h - zh) * 60 + (m - zm)) * 60_000;
}

function run<T extends OpType>(userId: number, type: T, payload: OpPayload<T>, when = now) {
  const op = { opId: uuidv7(), type, deviceId: "tour", clientTime: when, payload } as Op;
  const r = applyOp(userId, op, when);
  if (!r.ok) throw new Error(`${type}: ${r.error}`);
}

const admin = createUser({ name: "Morgan Reyes", role: "admin", actorUserId: null }).id;
const lee = createUser({ name: "Lee Okafor", role: "employee", actorUserId: admin }).id;
const sam = createUser({ name: "Sam Lindqvist", role: "employee", actorUserId: admin }).id;

// Customers and jobs.
const jobs: Record<string, string> = {};
function job(path: string) {
  const parts = path.split(":");
  let parent: string | null = null;
  for (let i = 0; i < parts.length; i++) {
    const key = parts.slice(0, i + 1).join(":");
    if (!jobs[key]) {
      jobs[key] = uuidv7();
      run(admin, "job.create", { jobId: jobs[key], name: parts[i]!, parentId: parent });
    }
    parent = jobs[key]!;
  }
  return jobs[path]!;
}
const harbor = job("Harbor Clinic:Patient Portal");
const harborAdmin = job("Harbor Clinic:Administrative");
const kiln = job("Kiln & Co:Kiln Controller:Firmware");
const kilnHw = job("Kiln & Co:Kiln Controller:Board Bring-up");
const greenway = job("Greenway Transit:Fare Display");
const internal = job("Internal:Tooling");

// Morgan (the admin we sign in as) tracks with notes.
setTrackingMode({ userId: admin, mode: "notes", actorUserId: admin });

/** A day written in notes and turned into hours, maybe submitted. */
function notesDay(
  userId: number,
  date: string,
  runs: { job: string; start: string; notes: [string, string][]; hours: number }[],
  { submit = true, leaveLoose = false } = {},
) {
  for (const [i, r] of runs.entries()) {
    const ids: string[] = [];
    const startId = uuidv7();
    run(userId, "note.create", { noteId: startId, at: at(date, r.start), kind: "start", jobId: r.job });
    ids.push(startId);
    for (const [t, text] of r.notes) {
      const id = uuidv7();
      run(userId, "note.create", { noteId: id, at: at(date, t), text, jobId: r.job });
      ids.push(id);
    }
    // The bug this tour was built around: one note left out of the hours.
    if (leaveLoose && i === 0) ids.pop();
    run(userId, "rollup.commit", {
      workDate: date,
      lines: [
        {
          entryId: uuidv7(),
          jobId: r.job,
          durationSeconds: r.hours * 3600,
          note: r.notes.map(([, t]) => t).join("; ") || null,
          noteIds: ids,
        },
      ],
    });
  }
  if (submit) run(userId, "day.submit", { workDate: date });
}

const d = (n: number) => addDays(todayDate, n);

// Two weeks back for Morgan.
for (let n = -13; n <= -3; n++) {
  const date = d(n);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) continue;
  notesDay(admin, date, [
    { job: kiln, start: "08:30", notes: [["09:10", "Reviewed PID tuning against last firing log"]], hours: 3 },
    { job: harbor, start: "12:30", notes: [["13:00", "Sprint planning"], ["15:20", "Fixed appointment time zone bug"]], hours: 4 },
  ]);
}
// Three days back: submitted, but one note never made it into the hours.
notesDay(
  admin,
  d(-2),
  [
    {
      job: kilnHw,
      start: "09:00",
      notes: [["09:40", "Brought up the second board revision; thermocouple amp reads 3 °C high"]],
      hours: 5,
    },
    { job: harborAdmin, start: "14:30", notes: [["15:00", "Travel to the clinic, met with their IT lead"]], hours: 2.25 },
  ],
  { leaveLoose: true },
);
// Yesterday: hours made, never submitted.
notesDay(
  admin,
  d(-1),
  [{ job: greenway, start: "10:00", notes: [["10:30", "Font rendering on the 7-inch panel"]], hours: 2 }],
  { submit: false },
);
// Today, under way: a job started and a couple of notes.
run(admin, "note.create", { noteId: uuidv7(), at: now - 3 * 3600_000, kind: "start", jobId: kiln });
run(admin, "note.create", { noteId: uuidv7(), at: now - 2.5 * 3600_000, text: "Ramp-rate limiter, first pass", jobId: kiln });
run(admin, "note.create", { noteId: uuidv7(), at: now - 1 * 3600_000, kind: "start", jobId: internal });
run(admin, "note.create", { noteId: uuidv7(), at: now - 0.5 * 3600_000, text: "CI cache for the firmware builds", jobId: internal });

// Lee tracks with timers: a week of hand-entered time, and a timer running now.
for (let n = -9; n <= -1; n++) {
  const date = d(n);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) continue;
  run(lee, "entry.create", { entryId: uuidv7(), jobId: greenway, workDate: date, durationSeconds: 6 * 3600, note: "Fare display layout" });
  run(lee, "entry.create", { entryId: uuidv7(), jobId: internal, workDate: date, durationSeconds: 1.5 * 3600, note: null });
  if (n < -2) run(lee, "day.submit", { workDate: date });
}
run(lee, "entry.create", {
  entryId: uuidv7(),
  jobId: greenway,
  startedAt: now - 2 * 3600_000,
  endedAt: now - 30 * 60_000,
  note: "Station names overflow on two lines",
});

// Sam: a short week, submitted.
for (let n = -6; n <= -2; n++) {
  const date = d(n);
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) continue;
  run(sam, "entry.create", { entryId: uuidv7(), jobId: harbor, workDate: date, durationSeconds: 7.5 * 3600, note: "Portal QA" });
  run(sam, "day.submit", { workDate: date });
}

// Sam also jots notes today, with the hold off (an unfinished day only
// reminds): today's note boxes are open for the "typed, not added" shot.
setTrackingMode({ userId: sam, mode: "notes", actorUserId: sam });
setNotesHoldNextDay({ userId: sam, hold: false, actorUserId: sam });
run(sam, "note.create", { noteId: uuidv7(), at: now - 2 * 3600_000, kind: "start", jobId: harbor });
run(sam, "note.create", { noteId: uuidv7(), at: now - 1.5 * 3600_000, text: "Regression pass on booking flow", jobId: harbor });

// Everyone signs in with a passkey in real life: a stand-in row each (it never
// has to verify anything — the tour's sessions are made directly), so pages
// listing passkeys look as they would rather than all saying "none".
const passkey = (userId: number, nickname: string) =>
  Number(
    db()
      .query<{ id: number }, [number, string, Uint8Array, string, number, number]>(
        `INSERT INTO credentials (user_id, credential_id, public_key, nickname, backed_up, created_at, last_used_at)
         VALUES (?, ?, ?, ?, 1, ?, ?) RETURNING id`,
      )
      .get(userId, uuidv7(), new Uint8Array(1), nickname, now - 30 * 86_400_000, now - 3600_000)!.id,
  );
const keys = {
  [admin]: passkey(admin, "Windows Hello"),
  [lee]: passkey(lee, "iPhone"),
  [sam]: passkey(sam, "Pixel"),
};

const cookie = async (userId: number) =>
  (
    await sessionCookie.serialize(
      createSession({
        userId,
        credentialId: keys[userId] ?? null,
        userAgent:
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
      }).token,
    )
  ).split(";")[0]!;

console.log(
  JSON.stringify({
    today: todayDate,
    dates: { loose: d(-2), unsubmitted: d(-1) },
    users: { admin, lee, sam },
    cookies: { admin: await cookie(admin), lee: await cookie(lee), sam: await cookie(sam) },
  }),
);
