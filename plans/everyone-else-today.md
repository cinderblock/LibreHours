# Everyone else's time, on an admin's own day

## Goal

User request (2026-11-08): *"a feature that lets admins see other employees'
times alongside theirs during the same day."*

Admin → Calendar already shows everyone's week as blocks, the admin's own
included. What's missing is seeing it **from the admin's own day screen**,
while tracking: who else is working that day, on what, since when, and how
much they have so far.

## Environment / context

- Repo `~/git/Personal Projects/time-tracker` (shared working tree), `master`.
  Checks: `bun run typecheck`, `bun test src/ app/`, `bun run test:e2e`
  (through the compute-budget broker).
- Day screen: `app/tracker/TrackerScreen.tsx` (used by `/`, `/day/:date` and
  the admin's acting-for screen `/admin/people/:id/time/:date?`).
- Per-entry data already exists: `reportLines()` in `src/reports.ts` (live
  seconds for a running timer, first start, last end, untimed seconds,
  status). Pending notes: `pendingNotesOn()` in `src/notes.ts`.
- The service worker never caches `/api/` (`public/sw.js`), so a JSON route
  there stays online-only by construction.

## Decisions

1. **A panel on the admin's own day screen** (user picked this over a time-axis
   strip or improving the Calendar). Under the day's own record and Submit, in
   the right column; at the bottom on phones.
2. **Admins only, and only on their own screen** — not in acting-for mode,
   where the screen is someone else's day.
3. **Its own JSON route, `GET /api/admin/day/:date`**, not a field on the day
   model. The day model is stored on the device for offline use; other
   people's time shouldn't be, and doesn't need to be. Offline, the panel says
   it can't load rather than showing an old copy.
4. **Refreshes itself**: when the day changes, every minute while the tab is
   visible, and when the tab comes back into view or the connection returns. A
   running timer's total ticks on screen between refreshes.
5. **What each person shows**: name, the day's total, a running timer, and
   whether the day is submitted / approved; one line per job with its times
   ("7:30 AM – now", "plus 30m without times"). Notes-mode people with notes
   not yet turned into hours say so, with the time of their latest note — they
   are working even if they have no hours yet. Entry notes (descriptions) are
   left out: it's a glance, and the person's name links to their day.
6. **Who's listed**: every active person except the admin, plus anyone
   deactivated who has time that day. People with nothing that day are rolled
   into one "Nothing yet:" line rather than a card each.
7. **Collapsible**, open by default; the choice is kept per device
   (`localStorage`, wrapped in try/catch).

## Plan / steps

1. `src/reports.ts`: `othersDay(workDate, exceptUserId, now)` built on
   `reportLines()` + `pendingNotesOn()`. Unit tests in `src/admin.test.ts`.
2. `app/routes/api.admin.day.$date.ts` + `app/routes.ts`: `requireAdmin`,
   date validation, JSON.
3. `app/tracker/EveryoneElse.tsx`: fetch hook + panel; mounted from
   `TrackerScreen` when the signed-in user is an admin and not acting for
   anyone.
4. e2e in `e2e/timesheets.spec.ts`: admin's day shows another person's
   running timer and hours; a non-admin's day doesn't show the panel; the
   route refuses a non-admin.
5. README + `plans/time-tracker.md` page table.

## Findings / gotchas

- **The e2e database is shared by every spec**, so the panel on an admin's
  day also lists people made by other specs (Olive Offline, Nora Notify…).
  The first run asserted "1 with time, 1 on the clock" and failed with "2 with
  time, 2 on the clock"; assertions now look only at this spec's person.
- **`tracking.spec.ts` "move a week at a time" failed on its own, unrelated**:
  its `dayIn()` stepped back in 24-hour blocks, which across the 2026-11-01
  clock change lands a day off late in the evening (expected `2026-10-26`,
  page correctly at `2026-10-25`). Fixed to calendar days (`addDays`), its
  own commit.
- Under load (other sessions' builds had the CPU at 100%), the bug-report
  context check and the branding "Saved." toast each failed once and passed
  on the other run — timing, not this change.
- Paused timers: `reportLines()` gives an open entry no `endedAt`, so a paused
  line would have read "– now". The panel says "– paused" instead.

## Progress log

- [x] Plan written.
- [x] Server query (`othersDay`, `pendingNotesByPerson`) + 2 unit tests
- [x] API route `GET /api/admin/day/:date` (401/403/404, `no-store`)
- [x] Panel `app/tracker/EveryoneElse.tsx`; calendar colours moved to
      `app/components/person-color.ts` so a person matches on both
- [x] e2e: panel content, fold remembered across reload, name → their day,
      absent when acting for someone, absent for employees, 403 / 404
- [x] README + `plans/time-tracker.md`; typecheck, 512 unit green
- [x] Final e2e run: 89 passed, 3 skipped (2026-11-08). Committed.
- [x] 2026-11-09 — **Deployed `4d00106`** (user: "deploy"): image CI green;
      image revision label matches the commit; container healthy, running
      `4d00106`; `/signin` 200 and `/api/admin/day/:date` answers 401 signed
      out.

## Open questions for the user

None.

## Things not to do

- Don't put other people's time into `DayModel` — it's persisted to IndexedDB
  for offline use.
- Don't use `useFetcher().load` for the panel: a failed load there goes to the
  route's error boundary and would take down the whole day screen.
