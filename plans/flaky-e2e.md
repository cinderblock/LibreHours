# Flaky e2e tests

**Status: done.** All four causes fixed in the app, verified, on master.

## Goal

Three Playwright e2e tests fail intermittently, on untouched `master` too.
Find each one's cause and fix it where it's actually wrong (test or app),
without retries or longer timeouts:

1. `e2e/tracking.spec.ts`: "a day slides its highlight along the strip, a
   week slides the whole strip, and the arrows stay put" (ISSUES.md).
2. `e2e/bugs.spec.ts`: "Report a problem: what the person says, a
   screenshot, and what the page knew" (ISSUES.md).
3. `e2e/auth.spec.ts`: "the admin can sign out and back in with the passkey"
   (reported later from the `problem-highlight` thread; not in ISSUES.md).

## Environment

- Worktree `.t3/worktrees/time-tracker/flaky-e2e`, branch `flaky-e2e`, pushed to
  `origin/master` as fast-forwards only.
- Heavy runs go through `~/.srm/bin/srmctl run --slots 2 --low --label <name> -- <cmd>`.
- Each concurrent e2e run needs its own `E2E_PORT`. This thread uses 3240;
  `problem-highlight` uses 3260, and the default is 3140.
- Build before e2e: `bun run build`. The e2e servers serve the built output.
- Probes (not committed): `e2e/zz-probe.spec.ts` loops the week-strip
  sequence; `e2e/zz-bugs-probe.spec.ts` loops the report flow and reads the
  sent report body. Logs are in the session scratchpad.

## Decisions (don't re-ask)

- Fix causes, not symptoms: no retries, no longer timeouts.
- ISSUES entries claimed on master in `a413809`.

## Findings

### 1. Week-strip slide: the app took `data-day-move` off mid-transition

- `markDayMove` cleared `<html data-day-move>` on a timer started at the
  click (`max(slow, base) + 200` = 520 ms). The view transition starts only
  once the loader returns, often 100–300 ms after the click under load, so
  the attribute came off while the transition was still running.
- Removing it swaps the authored animations (`tt-day-move-in`, the
  highlight's duration) for the browser's defaults mid-flight. The day fades
  in a second time, and the transition is stretched to ~700 ms, so it
  overlaps the next move. Probe log: ready at 3503 ms, `attr=-` at 3808,
  finished at 4188. The week move's window then sees the day move's
  `::view-transition-group(tt-day-selected)`.
- Waiting in the test for the attribute to clear (already on master) can't
  help while the attribute's lifetime is wrong.
- Probe, old app: 14/25, 10/12, 9/30 iterations bad.
- **First fix attempt failed (30/30 bad):** clearing when the transition's
  animations' `finished` promises resolve is still a frame too early. Finished
  `fill: both` animations hold their last frame until the browser takes the
  transition down. Removing the attribute in that frame changes the
  pseudo-elements' `animation-name`, which starts the browser's 250 ms fades
  over again.
- **Current fix:** clear once this move's pseudo-element animations are *gone
  from* `document.getAnimations()` (the transition is torn down). A newer
  move owns the mark, so an older one never clears it. If no transition
  appears within 10 s, give up and clear.

### 2. Bug report

- Missing `nav /account` crumb, hypothesis: "Your account" clicked before
  hydration does a plain page load. If "Track time" is then clicked before
  `/account` hydrates, React's `useEffect` that records the `nav` crumb never
  runs there. The click crumb is recorded anyway, because the click
  listener is installed at module load. Fix: `notePlace()` records the landing
  page when the recorder installs; the effect deduplicates.
- Also, every `nav` crumb lands one interaction late in the trail (e.g.
  `click:Track time` then `nav:/account`; `nav:/` after "Report a problem
  pressed"). It's recorded from a passive `useEffect`, which React runs late
  after a transition commit. Fix: `useLayoutEffect`, so it's recorded at commit.
- The `bugs-before` probe (old build, 20 iterations) never lost
  `nav /account`; all its navigations were client-side. Not reproduced yet.
- Missing screenshot: the dialog opens only after `drawPage()` finishes, and
  drawing took 1.6–8 s on this near-empty page, over the 8 s give-up 3/20
  times ("The page couldn't be drawn (Drawing the page took too long.)").
  No network requests during the drawing. A CPU profile shows about 2 s in
  modern-screenshot's computed-style copying (`getPropertyValue`,
  `setProperty`, `item`) plus about 1.5 s idle. The machine was at 100% CPU
  from other jobs throughout.
- modern-screenshot's `fixSvgXmlDecode` redraw waits only happen on
  Safari/Firefox (`drawImageCount` only grows there), so they're not the
  idle time in Chromium.
- modern-screenshot `debug: true` stages, 4 drawings of `/` (241 elements),
  machine at ~98% CPU: clone node 2.9–3.6 s every time; image to canvas
  (browser rasterising the foreignObject SVG) 0.7–6.4 s; fonts and embedding
  negligible. Totals: 4.2, 4.2, 9.7 and 6.1 s. So the screenshot is CPU-bound
  and load-sensitive. The app gives up at 8 s, the test waits 5 s, and the
  dialog doesn't open at all until the drawing is done.

- Repeating one test: these specs are `mode: "serial"` and build on each
  other's state, so `--repeat-each` on one test can't run it alone. The
  probes repeat each test's own sequence many times within one test; the real
  suites are then rerun whole, each run with fresh servers
  (`scratchpad/loop-real.sh`).

### 3. Sign in with a passkey

- `/signin` (and `/join`) rendered the passkey button enabled on the server
  (`supported` defaulted to `true`). Sign-out does a full page load to
  `/signin`, and a press before hydration does nothing. Fix: `supported`
  starts `null`, and the button stays disabled until the client has checked.
  Playwright waits for enabled; a person on a slow phone no longer gets a
  dead tap.
- `auth.spec.ts:95` ("sign-in returns to the page that asked for it") failed
  the same way once in this thread's runs: the same pre-hydration press.

## Decisions (user, 2026-11-10)

- Screenshot: draw behind the dialog. Copy the page before the dialog opens
  (it reads the live page), then decode the image behind the open dialog,
  with "Drawing the page…" and no give-up. Sending waits for the picture.
  Done in `08ec482`. The e2e test now checks the picture after typing, just
  before Send.
- Verification keeps `--low` on the compute budget, even though it queues
  for a long time behind other threads' jobs.

## Progress

- [x] Reproduce week-strip flake with a probe; root cause found
- [x] Fixes committed locally: `6064046` (day move), `abd9b59` (passkey
      buttons), `e01087e` (breadcrumbs). Typecheck and unit tests pass. Not
      pushed: e2e verification pending.
- [x] Week-strip fix v2: probe 0/30 bad on the fixed build (old build: 14/25,
      10/12, 9/30)
- [x] Real `auth tracking bugs` x5 (round 1): auth and tracking passed every
      run. The bug report failed 3/5 at a later line,
      `expect(context.screens.day).toHaveProperty("shown.workDate")`.
      `useBugContext` registered the day screen's data from a passive
      effect, which hadn't run when Report was pressed straight after the day
      appeared. It was masked before by the earlier failures. Fixed in
      `c4a8c18` (layout effect).
- [x] Real `auth tracking bugs`, whole, with fresh servers each time:
      15/15 runs clean (43/43 each), 2026-11-10
- [x] Entire e2e suite, every project: 90 passed, 3 skipped (the
      screenshot-only tests, as on master)
- [x] Sign-in fix: auth passed all 15 runs (before: `auth.spec.ts:84`
      and `:95` each failed once in this thread's runs)
- [x] ISSUES.md entries removed; probes deleted; pushed to master
- [x] Breadcrumb fix verified by the 15 whole runs
- [x] Screenshot fix implemented (`08ec482`); typecheck and unit tests pass
- [x] Screenshot fix: probe 20/20 pictures arrived (slowest 5.9 s after
      the click; before, 3/20 gave up). The probe stops at report 21 because
      of the app's own reports-per-hour limit ("That's a lot of reports in an
      hour"). That's the probe's artifact, not a flake.
- [x] Breadcrumbs: `nav` crumbs now sit in order (arrival before the next
      click) in the probe's trails

## Things not to do

- Don't clear `data-day-move` on `Animation.finished`. See above.
- Don't run two e2e suites on the same `E2E_PORT`.
- Don't register anything a click handler reads (bug-report data,
  breadcrumbs) from a passive `useEffect`. React can run it after the next
  press. Use `useLayoutEffect`.
- Don't use `--repeat-each` on one test of these serial specs. They build
  on each other's state; repeat the whole suite instead.
