# Rename: time-tracker → LibreHours

## Goal

The time tracker becomes **LibreHours**, a standalone product that sits next to
**LibreBooks** (`cinderblock/LibreBooks`). Either can be used alone. They can be
used together, or LibreHours can be used with QuickBooks Desktop (as it is today).

Asked for on 2026-11-09, in the LibreBooks thread about whether time-tracker
should be folded into LibreBooks.

## Environment / context

- Repo: `C:\Users\camer\git\Personal Projects\time-tracker`, GitHub
  `cinderblock/time-tracker` (public), branch `master`.
- CI (`.github/workflows/build.yml`) publishes `ghcr.io/${{ github.repository }}`,
  so the image name follows the GitHub repo name.
- Production: `servers/steamboat/stacks/time-tracker` in the ops repo
  (`~/git/Personal Projects/ops`). `pin.json` pins
  `ghcr.io/cinderblock/time-tracker@sha256:…`, and Renovate moves the pin.
  `compose.yml` sets `DATABASE_PATH=/data/time-tracker.db` explicitly and sets
  **no `APP_NAME`**, so production shows the built-in default name.
- Other threads commit to this repo and deploy it while this runs. Stage only
  this thread's files.

## Decisions already made (don't re-ask)

1. **Name: LibreHours.** "LibreTime" was the first choice, but it is an established
   AGPL radio-automation project (`LibreTime/libretime`, libretime.org). No
   "LibreHours" project turned up in a search on 2026-11-09.
2. **Two separate products**, not merged or vendored. Different stacks
   (Bun/TypeScript vs Rust), and keeping them apart stops employees' phones from
   sharing a process and an attack surface with the general ledger.
3. **No QuickBooks Time / Workforce support** in LibreBooks. The user agreed it
   is excessive: those are QuickBooks Online-side products.
4. **GitHub repo becomes `cinderblock/LibreHours`**, matching `LibreBooks`'
   casing. `package.json` name `librehours` (npm names are lowercase).
5. **Storage identifiers stay as they are**: the `tt_session` cookie, the
   `tt-*` localStorage, cache and channel names, and the IndexedDB databases
   `time-tracker` and `time-tracker-problems`. Renaming them would sign everyone
   out, and would throw away offline changes that haven't synced yet. Nobody
   sees them. "tt" reads fine as "time tracking".
6. **The default database file becomes `librehours.db`.** When the default is
   in use, that file is missing and `time-tracker.db` sits beside it, the app
   keeps using the old file and says so in the log
   (`src/database-path.ts`). The image's `DATABASE_PATH=/data/librehours.db`
   counts as the default here. Any path with another file name is taken as given.

## Plan / steps

1. **Code and docs in this repo**: product name, defaults, README, master plan
   renamed to `plans/librehours.md`, cross-references. Finished plans keep their
   historical local paths (`~/git/Personal Projects/time-tracker…`), since those
   record where the work was done.
2. **Push, then rename the GitHub repo** ← current to `cinderblock/LibreHours` and update
   its description. GitHub redirects the old URL for git and the web.
3. **First CI build after the rename** publishes `ghcr.io/cinderblock/librehours`.
   Check the new package is **public**: ops pulls anonymously.
4. **Ops (needs the user's yes for each change)**: point `pin.json` at the new
   image, and decide whether to set `APP_NAME` in `compose.yml` (otherwise the
   app's name in production changes from "Time Tracker" to "LibreHours" on the
   next deploy). Renaming the stack, container, data directory and backup units
   is optional and cosmetic, and can wait.
5. **LibreBooks docs**: refer to the sibling project as LibreHours.
6. **Local folder** `time-tracker` → `LibreHours`: only with the user's go-ahead,
   because open threads and T3 projects point at the current path.

## Findings / gotchas

- The image name comes from `github.repository`. Once the repo is renamed, new
  builds land in a new package. The old package and the current pin keep
  working, but Renovate in ops stops seeing new builds until `pin.json` moves.
- The first build after the rename failed at "Build and push", after every
  check had passed: `invalid tag "ghcr.io/cinderblock/LibreHours:0a6d251…":
  repository name must be lowercase`. The workflow now lowercases
  `GITHUB_REPOSITORY` into `IMAGE_PREFIX` in a step.
- Production relies on the default app name (no `APP_NAME` in compose). An admin
  may have set a name under Settings, which wins over the default.
- Changing the IndexedDB name would orphan each phone's unsynced outbox.

## Progress log

- [x] Name chosen and checked for conflicts
- [x] Step 1: code and docs. Typecheck and 516 unit tests pass locally; the
  end-to-end tests run in CI on push
- [ ] Step 2: push, rename the GitHub repo
- [ ] Step 3: new package public
- [ ] Step 4: ops pin and `APP_NAME` (waiting on the user)
- [ ] Step 5: LibreBooks docs
- [ ] Step 6: local folder (waiting on the user)

## Open questions for the user

1. Production name after the switch: keep "Time Tracker" (set `APP_NAME` in
   ops), use "LibreHours", or something TWILL-specific? Recommendation: set it
   explicitly in ops, so the product's default never changes what employees see.
2. Rename the local folder? Recommendation: yes, once no other thread is active in it.
3. LibreBooks ↔ LibreHours integration plan (LibreBooks pulls queued time, and a
   scoped credential): write it up as a LibreBooks plan now, or later?

## Things not to do

- Don't rename the storage identifiers in decision 5.
- Don't change ops files without a per-change yes.
- Don't change `DATABASE_PATH` in production's compose. The data lives at
  `/srv/time-tracker-data/time-tracker.db`, and the backup units name it too.
