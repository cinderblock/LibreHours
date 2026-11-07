# A service item per person

## Goal

When two people bill time to the same client on the same day, the invoice has
to say whose time each line is. QuickBooks puts a time record's service item
and note on the invoice line, but not the person's name. A service item per
person (e.g. `Engineering:Alice`, `Engineering:Bob`, subitems at the same rate)
makes the person show on every line, with no typing at invoice time.

## Decisions

- **Per person, not in the note.** Putting the name in the note was rejected:
  it would show even when only one person worked for a client.
- **Precedence, nearest first:** the entry's own item, then the job's (or the
  nearest one up the tree), then the person's, then the organisation's
  default. A job's own item says what the work was for that client, so it
  wins.
- **Changing a person's item amends their time already sent**, without anyone
  taking it back. Only entries whose item came from the person or the default
  are affected.
- **Amending looks first.** Each record is fetched before it is changed. One
  already invoiced (`HasBeenBilled`), changed in QuickBooks since this app
  sent it (edit sequence moved on), or deleted there is left as it is,
  recorded in `time_entries.stale_skipped`, and listed on the Accounting page
  until dismissed. Rewriting an invoiced line or someone's hand edit is worse
  than a stale item.

## Done

- [x] Migration `014_person_service_item`: `users.default_service_item_id`,
      `time_entries.stale_skipped`.
- [x] `FoundTime.billed` from both QuickBooks backends.
- [x] `serviceItemFor` precedence in `src/sync.ts`.
- [x] `setPersonServiceItem` (remote-lists) and `amendPersonsSentTime` /
      `markForAmending` / `dismissSkipped` (sync).
- [x] Accounting page: a service item per person row; "Left as they are in
      QuickBooks" alert with Dismiss.
- [x] Unit tests (precedence; amending with invoiced, edited, deleted, other
      people's and own-job records) and an e2e round trip.

## Not done / later

- Changing a **job's** item or the **default** doesn't amend sent time. Only
  the person's does, because that is what was needed. The same
  `markForAmending` would serve the others.
- Time taken back and submitted again after it was invoiced is still amended
  in place with `BillableStatus=Billable` (see ISSUES.md).
