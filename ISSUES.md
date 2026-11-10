# Issues

Known problems not fixed yet. Each is just enough for someone to pick it up.

## Re-sending invoiced time may un-invoice it

Taking back time that was already sent, then submitting it again, sends a
`TimeTrackingMod` with `BillableStatus` set to `Billable` (or `NotBillable`),
whatever QuickBooks has. If the record was on an invoice by then
(`HasBeenBilled`), that either is refused by QuickBooks or rewrites an invoiced
line and its status. Untested against real QuickBooks.

Where: `src/sync.ts` (`listWork` → `entry.mod`), `timeBody` in
`src/accounting/qb-bridge.ts`, `src/accounting/qbxml.ts`. The amend-after-a-
settings-change path already looks first and skips invoiced records
(`markForAmending`, plans/service-item-per-person.md); the take-back path does
not.

## Week-strip slide e2e test fails about one run in three — in progress — flaky-e2e

`e2e/tracking.spec.ts` "a day slides its highlight along the strip, a week
slides the whole strip, and the arrows stay put" fails intermittently at
`expect(week.some((a) => a.startsWith("::view-transition-group(tt-day-selected) "))).toBe(false)`
— the highlight's own transition group shows up during a week move. Seen on
untouched `master` (1 of 3 runs of `bunx playwright test --project=chromium
auth tracking`, 2026-11-09) as well as on branches. Waiting for the day
move to finish before recording the week move (the `slidWhile` change on the
`problem-highlight` branch) didn't remove it. A red e2e run that's only this
test isn't a regression signal until it's fixed.

## Bug-report e2e test fails about one run in three — in progress — flaky-e2e

`e2e/bugs.spec.ts` "Report a problem: what the person says, a screenshot,
and what the page knew" fails intermittently: sometimes the dialog's
screenshot image never appears (line ~100), sometimes the admin page's
breadcrumb table has no `nav /account` row (line ~119) although the click on
"Your account" is recorded and the URL changed. Seen on untouched `master`
and on branches, 2026-11-09 (`bunx playwright test --project=chromium auth
bugs`, 1 of 3 runs). Possibly the first click landing before hydration, or
the breadcrumbs' 500 ms persist debounce.
