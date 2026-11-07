# A note left unsent goes by itself

## Goal

Someone types a note into a job's note box, forgets to press Add, and moves
on — to another app, another tab, or elsewhere on the page. The note sat
there unsent (kept as a draft, but never in the day). Asked for 2026-11-06:
"If I'm in the middle of adding a note, and forget to add it, and I tab
away. Send it after like 30 sec delay."

## Environment / context

- Note box: `NoteBox` in `app/tracker/NotesPanel.tsx` (notes mode, one per
  job on the day, past days included).
- The timer card's note already saves the moment its field loses focus
  (`TimerCard.tsx`, `onBlur` → `entry.update`), so it needed nothing.
- Editing an existing note (`NoteRow`) is out of scope: it's an open editor
  with Save/Cancel, not a note being added.

## Decisions already made (don't re-ask)

1. **30 seconds** after the box is left (`SEND_AFTER_MS`).
2. **"Left" means focus leaves the box** — the field, its Add button and its
   time field count as one box. That covers tabbing to another app or tab
   (the window losing focus blurs the field), a phone putting the app away
   (also caught by `visibilitychange` while the cursor is still in the box),
   and clicking elsewhere on the page.
3. **The note's time is when the box was left**, not when it went — that's
   when it was written. On a past day the note's typed time is used, as with
   Add.
4. **It says so, in a small callout under the Add button** (user, 2026-11-06:
   "a little warning/note/callout near the button"). While there are words
   in the box, a quiet grey one: "Not added yet — it adds itself 30 s after
   you leave this box." Once left, it turns yellow and counts down:
   "Adding this note in N s. Keep writing". Coming back to the box, or
   "Keep writing", calls it off.
5. **A page that slept through the wait** (a phone freezes background pages)
   sends it when it's picked up again, with the time it was left.

## Design

- `app/tracker/send-when-left.ts`: `createLeaveWatch` (pure rules, unit
  tested) and `useSendWhenLeft(hasText, send, fieldRef)` → `boxProps` for the
  form (`onFocus`/`onBlur` with `relatedTarget`), `secondsLeft`,
  `keepWriting`.
- `NoteBox`: `add(now)` takes the note's time; Add passes `Date.now()`, the
  watch passes the time the box was left.

## Findings / gotchas

- "Keep writing" needs `onMouseDown` → `preventDefault`: focus landing on the
  link is itself coming back to the box, which calls the wait off and
  unmounts the link before its click arrives.
- Hidden tabs run timers late (Chrome: about once a second, once a minute
  after five minutes hidden), so it can go a little after 30 s while the tab
  is hidden; it is also checked the moment the page is visible again.
- e2e fakes the clock in its own browser context (same sign-in via
  `storageState`), so the midnight test that installs the clock last is
  untouched.

## Progress log

- [x] 2026-11-06 — Built: watch + hook, note box wiring, unit tests, e2e.
- [ ] Deploy (ops pin), with whatever ships next.

## Open questions for the user

- (none)

## Things not to do

- Don't send on the box losing focus to its own Add button or time field.
- Don't stamp the note with the time it was sent: after a long absence that
  puts it far from when it was written.
