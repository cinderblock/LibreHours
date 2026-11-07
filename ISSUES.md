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
