# Agent API access: hours over a token, not a browser

## Goal

Let Claude agents (first: the `time-approve` skill) read Cameron's days and add
**draft** hours in LibreHours over a direct, authenticated HTTPS API, instead of
driving Cameron's signed-in Chrome session.

Asked for on 2026-11-11: "Why are we using chrome? We have full control over the
LibreHours install and api… make a secure connection so you don't need to use
chrome to update hours." Driving Chrome pops a browser on Cameron's screen, and a
permission classifier now blocks it outright.

## Environment / context

- Repo: `cinderblock/LibreHours` (public; was `time-tracker`). Worktree for this
  task: `~/.t3/worktrees/time-tracker/agent-api-access`, branch `agent-api-access`.
- Production: https://time.twilltech.com on `steamboat`. Deployed by the ops repo
  (`~/git/Personal Projects/ops`): `servers/steamboat/stacks/time-tracker/pin.json`
  pins an image digest built by this repo's CI; Caddy (`sites.d/time.twilltech.com.caddy`)
  reverse-proxies to `localhost:9020` with no extra gate. An `Authorization`
  header passes through, so **no proxy, Cloudflare or DNS change is needed**: only
  a pin bump.
- Production was pinned at `884ea60` when this started, 33 commits behind master.
  Bumping the pin ships those too.
- The skill: `~/.claude/skills/time-approve/SKILL.md` ("Approving", steps 3–6 use Chrome).
- The CLI goes in `~/git/playgrounds/qb-time/scripts/` (not a git repo).
- Background: `~/git/playgrounds/qb-time/plans/daily-time-capture.md`.

## Decisions already made (don't re-ask)

- **Per-person API tokens**, created and revoked by the person on their Account
  page, shown once, stored as SHA-256 only (same as session cookies; 256-bit
  random tokens need no slow KDF). Format `lh_<43 base64url chars>`: the prefix
  makes a leaked one easy to recognise and grep for.
- **One scope, `drafts`**, with an explicit op allowlist in code:
  `entry.create`, `entry.update`, `rollup.commit`. Everything else is refused
  (`day.submit`, `day.unsubmit`, timers, notes, deletes, `duplicate.resolve`,
  `job.create`, …). Tokens can't reach admin pages, invoices, accounting/sync,
  users or tokens at all: they're only accepted on `/api/agent/*`.
- **Drafts only, enforced in the domain code, not just by op type.** Adding time
  to a job that already has submitted hours that day normally *takes the line
  back* (`lineReadyToAdd` in `src/entries.ts`), which would be an unsubmit by
  another name. A token op refuses instead (`forbidden`). `entry.update` from a
  token only touches `draft` lines (not running timers, not submitted ones).
- **Separate endpoints** under `/api/agent/`, bearer-only. Cookie routes don't
  read the header and agent routes don't read cookies, so neither path loosens
  the other. No Origin check on these (no ambient credential to forge).
- **Audit**: `applied_ops.api_token_id` names the token for every op it sent,
  and the op's `device_id` is forced to `token:<id>` (so entries it creates carry
  it too). Token creation and revocation go to `audit_log`.
- **Idempotency kept**: token ops go through the same `applied_ops` ledger by
  `opId`. The allowlist is checked *before* the ledger, so a token can't read
  back the stored result of an op type it isn't allowed.
- Expiry chosen at creation: 30 days, 90 days, 1 year (default) or never.
- The CLI is TypeScript run with Bun, not Python: Cameron prefers TypeScript (2026-11-11).
- Cameron approved rewriting the skill's "Approving" section to use the CLI, after the deploy.
- Any signed-in person can make tokens for themselves: a token can only do a
  subset of what they can already do on their phone.

## API

All take `Authorization: Bearer lh_…`. 401 `{error, code: "unauthorized"}` when
missing, unknown, revoked, expired, or its person is deactivated.

- `GET /api/agent/me` → `{ user: {id, name}, token: {id, name, scope, expiresAt}, ops: [...] }`
- `GET /api/agent/day/:date` → `{ workDate, today, timezone, mode, entries, notes, jobs, open, aliases }`
  — the day screen's own model (`loadDay`), trimmed to what an agent needs.
- `POST /api/agent/ops` body `{ ops: Op[] }` → `{ results: OpResult[] }`, same as `/api/ops`.

## Plan / steps

1. [x] Plan doc.
2. [x] Migration `015_api_tokens`: `api_tokens` table, `applied_ops.api_token_id`.
3. [x] `src/api-tokens.ts`: create / resolve / list / revoke, with tests.
4. [x] `src/ops.ts`: a token-limited `Who` (allowlist, forced device id,
       `draftsOnly` threaded into `addToLine` and `updateEntry`), with tests.
5. [x] Routes `/api/agent/me`, `/api/agent/day/:date`, `/api/agent/ops`.
6. [x] Account page: list, create (shown once, copy), revoke.
7. [x] README section; typecheck, unit tests, e2e for the token flow.
8. [x] Local end-to-end: run the built server, make a token, drive it with the CLI.
9. [x] CLI `qb-time/scripts/librehours.ts` (Bun; `me`, `day`, `ops`), token from a
       local file outside git.
10. [x] Push `agent-api-access` to master (builds the image, free: public repo).
11. [x] Deploy in ops: `pin.json` image → `ghcr.io/cinderblock/librehours` (the repo
        rename moved it), new digest and commit. Show it; apply only on Cameron's yes.
12. [x] Cameron makes the production token (Account → Tokens for scripts and agents) and saves it to
        `~/.config/librehours/token`. Check with `bun librehours.ts me`.
13. [x] Edit the `time-approve` skill (approved) once the deploy is live, so it never points at an
        API production doesn't have yet.

## Findings / gotchas

- `lineReadyToAdd` (`src/entries.ts`) silently reopens submitted lines when time
  is added to the same job and day. Both `entry.create` and `rollup.commit` reach
  it through `addToLine`. This is why "drafts only" can't be an op-type filter alone.
- `updateEntry` refuses to move an entry onto a job that already has a line, so
  it can't merge into submitted hours.
- `isEditable` includes `open` (running timers); token updates use `draft` only.
- The e2e spec is `e2e/tokens.spec.ts`, not `agent-api.spec.ts`: spec files run alphabetically and
  `auth.spec.ts` must run first (it expects no admin yet).
- **Pushing LibreHours master deploys it**, via ops Renovate (cron 4:00 AM PST / 12:00Z, and whenever
  a `renovate/**` check finishes). There is no manual gate. The local ops checkout was 313 behind
  and misled me; always read `origin/master` there.
- After the rename to LibreHours, CI pushes `ghcr.io/cinderblock/librehours`; production's
  `pin.json` still names `ghcr.io/cinderblock/time-tracker`. Both pull anonymously (checked
  2026-11-11), so the pin bump changes the image name as well as the digest.
- The heavier Account page made `bugs.spec.ts` "Report a problem" fail ~3 runs in 4 (the commit
  before passed 4/4): the test pressed Track time once the URL said /account, before the page
  rendered; React abandons that render, so no `nav /account` crumb. App behaviour is right (the page
  was never shown); the test now waits for the page's heading. 5/5 clean after.
- Bug-report breadcrumbs record only method, path and status, so a new token can't leak into a
  report through them.

## Progress log

- 2026-11-11: surveyed the code and the deploy; plan written.
- 2026-11-11: feature committed (`566a457`). 538 unit tests and all 77 chromium e2e tests pass
  (new: `src/api-tokens.test.ts`, `e2e/tokens.spec.ts`). CLI
  `~/git/playgrounds/qb-time/scripts/librehours.ts` driven against a local built server on a
  throwaway DB: me/day/ops, replay, local and server refusals; the token never appears in the
  server log. Rewritten in TypeScript (Python version removed) and re-run the same way.
- 2026-11-11: pushed to master (`da8f92d`) with Cameron's yes; image built
  (`sha256:91a54838…`, matches GHCR `:latest`).
- 2026-11-11: **correction** — I'd told Cameron the push wouldn't deploy. Wrong: ops Renovate follows
  `:latest` and its fast-forward of ops master is the deploy. Cameron said ship now; pinned by hand
  (ops `7f0b3f66`), Server Deploys run 43127138382 succeeded. Live: `/api/agent/me` → 401 JSON with
  `WWW-Authenticate: Bearer`.
- 2026-11-11: production token "Claude Daily Hours" made by Cameron and saved (via a secret card,
  never seen) to `~/.config/librehours/token`, ACL'd to his user. `librehours.ts me` names Cameron;
  `day 2026-11-10` reads (0 entries, 83 jobs). Nothing written to production. Done.
- 2026-11-11: `time-approve` skill's Approving section and hard rules rewritten to use
  `librehours.ts`; Chrome only appears as "don't fall back to it".
- 2026-11-11: follow-up approved by Cameron: admin person page lists a person's tokens with Revoke
  (no create). e2e covers it; full chromium suite 78/78. Fixed the bugs.spec race above.

## Open questions for the user

None open. (Admins seeing and revoking a person's tokens on their page: Cameron said yes, 2026-11-11;
done. Admins can't make tokens for someone else.)

## Things not to do

- Don't write to production while developing; test against a local server.
- Never send `day.submit` / `day.unsubmit`; never touch invoices.
- Don't add the 11-10 drafts from this thread; the review thread will.
- Don't print token values in chat or logs.
- Don't bump the ops pin or touch steamboat without Cameron's yes for that change.
