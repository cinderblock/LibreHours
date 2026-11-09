/**
 * The UI tour: every screen of the app, with made-up data, photographed at a
 * desktop and a phone width, light and dark — for reviewing the UI as a
 * whole rather than one change at a time.
 *
 *   bun run build                      (the tour runs the production build)
 *   bun scripts/ui-tour/tour.ts [out]  screenshots into [out] (default ui-tour/)
 *
 * Headless; nothing appears on screen. A fresh database in the temp folder
 * each run, seeded by seed.ts; the app runs on a spare port and is stopped
 * after. Writes index.md alongside the pictures: one line per shot, saying
 * what it shows.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { type Browser, type BrowserContext, type Page, chromium } from "@playwright/test";

const out = resolve(process.argv[2] ?? "ui-tour");
const PORT = Number(process.env.TOUR_PORT ?? 3190);
const base = `http://localhost:${PORT}`;
const db = join(tmpdir(), `time-tracker-tour-${process.pid}-${Date.now()}.db`);
const env = {
  ...process.env,
  PORT: String(PORT),
  PUBLIC_BASE_URL: base,
  DATABASE_PATH: db,
  SESSION_SECRET: "ui-tour-only-session-secret",
  TZ: "America/Los_Angeles",
  APP_NAME: "Time Tracker",
  ACCOUNTING_BACKEND: "none",
  NOTIFY_EVERY_SECONDS: "0",
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const seeded = spawnSync("bun", ["scripts/ui-tour/seed.ts"], { env, encoding: "utf8" });
if (seeded.status !== 0) throw new Error(`seed failed:\n${seeded.stderr}`);
const seed = JSON.parse(seeded.stdout.trim().split(/\r?\n/).pop()!) as {
  today: string;
  dates: { loose: string; unsubmitted: string };
  users: { admin: number; lee: number; sam: number };
  cookies: { admin: string; lee: string; sam: string };
};

const server = spawn("bun", ["server.ts"], { env, stdio: ["ignore", "ignore", "inherit"] });
for (let i = 0; ; i++) {
  try {
    if ((await fetch(`${base}/signin`)).ok) break;
  } catch {}
  if (i > 100) throw new Error("the app didn't start");
  await new Promise((r) => setTimeout(r, 300));
}

const index: string[] = ["# UI tour", "", `Seeded ${seed.today}. One line per screenshot.`, ""];
const VIEWS = [
  { name: "desktop", viewport: { width: 1280, height: 860 }, isMobile: false, hasTouch: false },
  { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
] as const;
const SCHEMES = ["light", "dark"] as const;

type Step = { file: string; what: string; path: string; as?: "admin" | "lee" | "sam" | "none"; act?: (p: Page) => Promise<void> };

const steps: Step[] = [
  { file: "signin", what: "Sign-in page, signed out", path: "/signin", as: "none" },
  { file: "today-notes", what: "Today in notes mode: two jobs under way, earlier days waiting", path: "/" },
  {
    file: "today-unsent-hours-dialog",
    what: "Today (another person, in notes mode): a note typed but not added, then Turn into hours — the dialog takes it along",
    path: "/",
    as: "sam",
    act: async (p) => {
      const box = p.getByPlaceholder("What did you do?").first();
      await box.fill("Wrote up the limiter test plan");
      await p.getByRole("button", { name: /^Turn .* into hours$/ }).first().click();
      await p.getByRole("dialog").waitFor();
    },
  },
  { file: "day-loose-note", what: "A submitted day with one note not in the hours (opened directly)", path: `/day/${seed.dates.loose}` },
  {
    file: "day-loose-note-arrived",
    what: "The same day, arrived at by a 'Go to' link: the problem marked and scrolled to",
    path: `/day/${seed.dates.loose}#needs-you`,
  },
  { file: "day-unsubmitted", what: "Yesterday: hours made, not submitted", path: `/day/${seed.dates.unsubmitted}` },
  { file: "account", what: "Your account", path: "/account" },
  { file: "report-a-problem", what: "The Report a problem dialog", path: "/", act: async (p) => {
      await p.getByRole("button", { name: "Report a problem" }).first().click();
      await p.getByRole("dialog").waitFor();
    } },
  { file: "lee-timer", what: "A person in timer mode, signed in as themselves", path: "/", as: "lee" },
  { file: "admin-timesheets", what: "Admin: timesheets", path: "/admin/timesheets" },
  { file: "admin-calendar", what: "Admin: calendar", path: "/admin/calendar" },
  { file: "admin-reports", what: "Admin: reports", path: "/admin/reports" },
  { file: "admin-people", what: "Admin: people", path: "/admin/people" },
  { file: "admin-person", what: "Admin: one person", path: `/admin/people/${seed.users.lee}` },
  { file: "admin-person-time", what: "Admin: one person's day, acted for", path: `/admin/people/${seed.users.lee}/time` },
  { file: "admin-jobs", what: "Admin: jobs", path: "/admin/jobs" },
  { file: "admin-rates", what: "Admin: rates & categories", path: "/admin/rates" },
  { file: "admin-accounting", what: "Admin: accounting", path: "/admin/accounting" },
  { file: "admin-settings", what: "Admin: settings", path: "/admin/settings" },
  { file: "admin-bugs", what: "Admin: bug reports", path: "/admin/bugs" },
];

const browser: Browser = await chromium.launch({ headless: true });
try {
  for (const view of VIEWS) {
    for (const scheme of SCHEMES) {
      const contexts = new Map<string, BrowserContext>();
      const contextFor = async (as: string) => {
        let c = contexts.get(as);
        if (!c) {
          const { name: _, ...options } = view;
          c = await browser.newContext({ ...options, colorScheme: scheme, reducedMotion: "reduce", locale: "en-US", timezoneId: "America/Los_Angeles" });
          const value = as === "none" ? null : seed.cookies[as as "admin" | "lee" | "sam"];
          if (value) {
            const [cname, ...rest] = value.split("=");
            await c.addCookies([{ name: cname!, value: rest.join("="), url: base }]);
          }
          contexts.set(as, c);
        }
        return c;
      };
      for (const step of steps) {
        const page = await (await contextFor(step.as ?? "admin")).newPage();
        const file = `${step.file}--${view.name}-${scheme}.png`;
        try {
          await page.goto(base + step.path, { waitUntil: "load" });
          // The app keeps a connection or two open; wait for it to draw instead.
          await page.waitForTimeout(1200);
          if (step.act) await step.act(page);
          await page.waitForTimeout(500);
          await page.screenshot({ path: join(out, file), fullPage: !step.act });
          index.push(`- \`${file}\`: ${step.what} (${view.name}, ${scheme})`);
        } catch (error) {
          // One broken step shouldn't cost the rest of the tour; say so instead.
          const why = (error as Error).message.split("\n")[0];
          index.push(`- FAILED \`${file}\`: ${step.what} — ${why}`);
          console.error(`${file}: ${why}`);
        } finally {
          await page.close();
        }
      }
      for (const c of contexts.values()) await c.close();
    }
  }
} finally {
  await browser.close();
  // Wait for the app to let go of the database before removing it (Windows
  // refuses to delete an open file).
  const exited = new Promise((r) => server.once("exit", r));
  server.kill();
  await exited;
  writeFileSync(join(out, "index.md"), index.join("\n") + "\n");
  for (const suffix of ["", "-wal", "-shm"]) rmSync(db + suffix, { force: true });
}
console.log(`Wrote ${index.length - 4} screenshots to ${out}`);
