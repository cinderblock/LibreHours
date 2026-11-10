# "The problem is here": one attention color, and landing on it

## Goal

A bug report from use (2026-11-08): a submitted day was still called
"isn't finished" from the other days. The person followed "Go to <day>",
landed on the day, and couldn't see what was wrong there. Asked for
(2026-11-09):

1. **One clear, consistent "problem is here" color.** Anything that needs the
   person looks the same everywhere, and following a link to a problem lands
   on it, marked.
2. **Don't let it happen again.** Turning a job's notes into hours while a
   note is still unsent in that job's box should include it automatically, or
   warn, or refuse. Not leave it behind.
3. **A whole-UI review, repeated until every review scores 10/10.**

## Environment / context

- Worktree `~/git/Personal Projects/time-tracker-problem-highlight`, branch
  `problem-highlight`, from `origin/master` `8484d05`.
- Checks: `bun run typecheck`, `bun test src/ app/`, `bun run test:e2e`
  (heavy: through the compute-budget broker / sentinel).
- Day screen: `app/tracker/` — `NotesPanel.tsx` (notes by job, `NoteBox`,
  `NoteRow`, `HoursDialog`), `DayHeader.tsx` (week strip), `EntryList.tsx`,
  `HeldEntries.tsx`, `SubmitDay.tsx`.
- The "isn't finished" callouts are `NotesPanel` (`model.notesToRollUp`, from
  `pendingNotesBefore` on the server). The morning notification reads the same.

## What happened (confirmed in the live op log)

Times local (PST).

1. 6:00 PM — job started (a start note).
2. 6:02:57 PM — **Turn into hours** pressed for that job. Only the start note
   was pending; the description was still typed, unsent, in the job's note
   box. The entry was made with no text.
3. 6:03:00 PM — Add pressed: the note went in, 3 s after the entry. A note
   joins an entry only through a rollup, so it stayed "not yet hours".
4. 6:03:20 PM — the same text typed into the entry by hand.
5. The day was submitted. Every later day then said it "isn't finished"
   because of that one loose note. On the day itself, nothing marked it: the
   note looked like the others except for a missing grey badge.

## Decisions already made (don't re-ask)

- **Unsent text is included automatically** (user offered: automatic, a
  warning, or refuse). The hours dialog shows it as part of what's being
  turned into hours, says it will be added, adds it as a note first and
  includes it in the rollup. Automatic and visible beats a refusal that sends
  the person back to press Add.
- **Two meanings, two colors**, used the same way everywhere:
  - *Needs you* (attention): something here is waiting on the person — notes
    not yet hours on a past day, held entries, a day that isn't finished.
  - *Failed* (red): something went wrong — a refused save, a sync error.
  Informational / done states stay neutral or green.
- **Links to a problem carry where it is**, and the day marks it on arrival
  (scroll to it, outlined in the attention color, with a line saying what to
  do). The mark also shows without the link whenever the day is the cause of
  a warning elsewhere.

## Plan / steps

1. [x] Unsent note included in "Turn into hours" (`NotesPanel.tsx`):
       `useNoteBox` in the job card owns the box's text; `HoursDialog` shows
       it ("Your note … wasn't added yet. It goes in with these hours."),
       adds it first and rolls it up with the rest. The box's 30 s auto-send
       pauses while the dialog is open (`send-when-left.ts`).
2. [x] `app/components/needs-you.tsx` + `.module.css`: `NEEDS_YOU` (orange),
       `FAILED` (red), `needsYou()` props, `toProblem()` links,
       `useArriveAtProblem()`. Yellow retired from "needs you" uses in
       NotesPanel, SubmitDay, HeldEntries, EntryList; offline → gray,
       paused badge → gray, the note box countdown → orange.
3. [x] Job cards with notes not hours on a day gone by / submitted day are
       outlined, say what to do, and each loose note is tagged "not in the
       hours". Links to a day with a problem carry `#needs-you`; arriving
       scrolls to, focuses and pulses the first marked thing. Week strip:
       orange dot + bottom edge on days that need you (server `week[].needsYou`;
       the day shown is read from the screen).
4. [x] Unit: `app/tracker/needs-you.test.ts`. E2e: unsent note goes in with
       the hours; "Go to" lands on the marked card. ← e2e run in progress
5. [ ] UI tour: `scripts/ui-tour/{seed,tour}.ts` — made-up org, every screen,
       desktop + phone, light + dark, headless.
6. [ ] Review rounds: independent reviewers score each screen; fix; repeat
       until every review is 10/10.
7. [ ] Checks, commit, deploy only on the user's word.

## Findings / gotchas

- `useDraft` does not sync between hook instances with the same key, so the
  dialog can't just read the note box's draft key; the state is lifted.
- The reducer-mirror unit test compares week rows; `needsYou` is left out of
  that comparison on purpose (the day shown is computed on screen).
- `rbuild`/sentinel isn't allowed for this repo; e2e runs locally under
  `srmctl run --slots 2 --low`.

## UI review rounds

Tour: `bun run ui-tour` (screenshots to `ui-tour/`, ignored). Brief for
reviewers: a fresh agent per review, given the screenshots and source, told
the owner wants 10/10 and to mark findings [must]/[nice]. Two reviewers per
round with different lenses (A: visual/consistency on desktop-light +
phone-dark; B: usability/copy/a11y on phone-light + desktop-dark).

### Round 1 — A 7/10, B 7/10 — fixes applied (round 2 tour pending)

Done for round 1: Mantine `v8CssVariablesResolver` (dark "light" surfaces
were brick red, light/subtle text white — Mantine 9's own resolver);
`NeedsYouCallout` everywhere a "needs you" message was an Alert (notes
panel, submit day, earlier days, held days, two lines, accounting blocked /
duplicates, sign-in not set up); yellow retired (offline/join warning gray,
location problem red); person palette without orange/red/yellow; note
status badge inline at the end of the text ("in the hours" / "not in the
hours"); arrival scrolls to the card's top; the problem card says the hold
and offers "Take the day back"; the header's "to move on" line removed;
submitted card says when a note isn't in the hours; "Add time manually"
hidden on a signed-off day; "Stop holding days for this" instead of "Start
today anyway"; account copy (self passkey text, VAPID → neutral, "Saved."
beside a disabled Save); "Unknown device" instead of "This device" for an
unrecognised browser; settings "Use the defaults" shortened; timesheets
cells "7h 30m" with the orange dot on waiting days; "submitted" instead of
"signed off"/"frozen"; dialog titles 600/lg; undo line tucked under the
header. Not done: native time input's "05:00 PM" (the browser's own
rendering); content widths; H1 color in dark (Mantine's text color).

Consolidated findings (both unless noted), status in brackets:

1. [ ] Arrival on phone: `block: "center"` puts a tall card's top under the
   sticky header. → `block: "start"` + scroll-margin.
2. [ ] Phone note rows: the badge squeezes the note to 1–2 words a line
   ("thermocoup/le"); "ADDED TO TIME" truncates. → badge under the text.
3. [ ] Dark mode: Mantine's orange `light` variant is a brick/rust that reads
   as an error. → own needs-you surface: neutral/low-alpha wash, orange
   border, orange title.
4. [ ] Needs-you callouts come in 3–4 shapes (filled alert, outlined card,
   text-only "Submit it"). → one `NeedsYouCallout`, one action button style.
5. [ ] The loose-note day contradicts itself ("move on" line, "This day is
   submitted", orange card, "This day is done"); "Take it back" is at the
   bottom; "Add time manually" offered on a locked day.
6. [ ] Person colors include orange/red/yellow (calendar). → drop them.
7. [ ] Terms: "added to time" / "in the hours" / "turn into hours"; admin
   "approved / signed off / frozen". → "hours" and "submitted".
8. [ ] Dark mode: red Delete/Remove/Sign out and blue Rename/Add-a-job turn
   plain white.
9. [ ] Settings: "Use the defaults (Time Tracker, #1c7ed…" clipped on phone.
10. [ ] Account: third-person "This person can't sign in" on your own page;
    VAPID jargon banner (and it's orange-brown in dark); "05:00 PM";
    "Admin" looks like a subtitle; disabled Save without a reason.
11. [ ] (B) "Start today anyway" silently flips a setting.
12. [ ] Admin person: someone else's session labelled "This device";
    "can't sign in" next to an active session.
13. [ ] Timesheets: no needs-you mark on unsubmitted past cells; "1:30" vs
    "1h 30m".
14. [nice] Dialog titles lighter than field labels; phone dialog buttons
    stack ragged.
15. [nice] ~60–80px dead space under the week strip.
16. [nice] Calendar today column too heavy; green overloaded; "NONE" badge
    green on Jobs, grey on Accounting; H1s dim in dark; content widths vary;
    category selects disabled with no reason; date formats vary.

## Progress log

- [x] 2026-11-09 — Report read, cause confirmed in the op log, plan written.

## Open questions for the user

- (none yet)

## Things not to do

- Don't put company, people or host names in this public repo.
- Don't use yellow for some "needs you" states and orange for others.
