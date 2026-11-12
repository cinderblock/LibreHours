import { execFileSync } from "node:child_process";

import { type APIRequestContext, type BrowserContext, type Page, expect, request, test } from "@playwright/test";

import { e2eEnv } from "../playwright.config.ts";
import type { OpPayload, OpType } from "../src/ops-schema.ts";
import { today } from "../src/time.ts";
import { uuidv7 } from "../src/uuid.ts";

/**
 * API tokens end to end: a person makes one on their Account page, a script
 * uses it with no browser and no cookie to read a day and add draft hours, it
 * can't submit, it doesn't work anywhere but /api/agent/*, and revoking it
 * stops it at once.
 *
 * Runs after auth.spec.ts against the same server, so an admin exists and
 * `admin-link` hands out invites.
 */
test.describe.configure({ mode: "serial" });

let ctx: BrowserContext;
let page: Page;
let api: APIRequestContext;
let token = "";
let jobId = "";
let userId = 0;
const day = today("America/Los_Angeles");

function op<T extends OpType>(type: T, payload: OpPayload<T>) {
  return { opId: uuidv7(), type, deviceId: "e2e-agent", clientTime: Date.now(), payload };
}

const auth = () => ({ Authorization: `Bearer ${token}` });

test.beforeAll(async ({ browser }) => {
  ctx = await browser.newContext();
  page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const url = execFileSync("bun", ["src/cli/admin-link.ts"], {
    env: { ...process.env, ...e2eEnv },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  })
    .trim()
    .split(/\r?\n/)
    .pop()!;
  await page.goto(url);
  await page.getByLabel("Your name").fill("Token Owner");
  await page.getByRole("button", { name: "Create passkey" }).click();
  await expect(page.getByRole("banner").getByText("Token Owner")).toBeVisible();

  // A job to book to, made the way a signed-in device makes one.
  const customerId = uuidv7();
  jobId = uuidv7();
  const made = await page.request.post("/api/ops", {
    headers: { Origin: e2eEnv.PUBLIC_BASE_URL, "Content-Type": "application/json" },
    data: {
      ops: [
        op("job.create", { jobId: customerId, name: "Token Customer" }),
        op("job.create", { jobId, name: "Token Job", parentId: customerId }),
      ],
    },
  });
  expect((await made.json()).results.every((r: { ok: boolean }) => r.ok)).toBe(true);

  // No cookies: what a script on another machine has.
  api = await request.newContext({ baseURL: e2eEnv.PUBLIC_BASE_URL });
});

test.afterAll(async () => {
  await api?.dispose();
  await ctx?.close();
});

test("a person makes a token on their Account page, shown once", async () => {
  await page.goto("/account");
  const section = page.locator("#tokens");
  await expect(section.getByText("No tokens.")).toBeVisible();
  await section.getByLabel("New token for").fill("E2E agent");
  await section.getByRole("button", { name: "Make token" }).click();

  const dialog = page.getByRole("dialog", { name: "New token" });
  await expect(dialog).toBeVisible();
  token = (await dialog.locator("pre, code").first().innerText()).trim();
  expect(token).toMatch(/^lh_[A-Za-z0-9_-]{43}$/);
  await dialog.getByRole("button", { name: "Done" }).click();
  await expect(dialog).toBeHidden();

  // The list shows its name and its last characters, never the token.
  await expect(section.getByText("E2E agent")).toBeVisible();
  await expect(section.getByText(`lh_…${token.slice(-4)}`)).toBeVisible();
  await expect(section.getByText("last used never")).toBeVisible();
  expect(await page.content()).not.toContain(token);
});

test("without a valid token, the agent API answers 401", async () => {
  expect((await api.get("/api/agent/me")).status()).toBe(401);
  expect((await api.get("/api/agent/me", { headers: { Authorization: "Bearer lh_nope" } })).status()).toBe(401);
  // A signed-in browser's cookie isn't a token either.
  expect((await page.request.get("/api/agent/me")).status()).toBe(401);
});

test("the token reads its person's day", async () => {
  const me = await api.get("/api/agent/me", { headers: auth() });
  expect(me.status()).toBe(200);
  const who = await me.json();
  userId = who.user.id;
  expect(who).toMatchObject({
    user: { name: "Token Owner" },
    token: { name: "E2E agent", scope: "drafts" },
    ops: ["entry.create", "entry.update", "rollup.commit"],
  });

  const res = await api.get(`/api/agent/day/${day}`, { headers: auth() });
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
  const body = await res.json();
  expect(body.workDate).toBe(day);
  expect(body.entries).toEqual([]);
  expect(body.jobs.find((j: { id: string }) => j.id === jobId)).toMatchObject({ fullName: "Token Customer:Token Job" });

  expect((await api.get("/api/agent/day/2026-02-30", { headers: auth() })).status()).toBe(400);
});

test("the token adds draft hours, and can't submit them", async () => {
  const entryId = uuidv7();
  const create = op("entry.create", { entryId, jobId, workDate: day, durationSeconds: 5400, note: "From an agent" });
  const sent = await api.post("/api/agent/ops", { headers: auth(), data: { ops: [create] } });
  expect(sent.status()).toBe(200);
  expect((await sent.json()).results[0]).toMatchObject({ ok: true });
  // The same op again is the same answer, and no second line.
  const again = await api.post("/api/agent/ops", { headers: auth(), data: { ops: [create] } });
  expect((await again.json()).results[0]).toMatchObject({ ok: true });

  const submit = await api.post("/api/agent/ops", {
    headers: auth(),
    data: { ops: [op("day.submit", { workDate: day })] },
  });
  expect((await submit.json()).results[0]).toMatchObject({ ok: false, code: "forbidden" });

  const read = await (await api.get(`/api/agent/day/${day}`, { headers: auth() })).json();
  expect(read.entries).toHaveLength(1);
  expect(read.entries[0]).toMatchObject({ id: entryId, status: "draft", durationSeconds: 5400, note: "From an agent" });

  // And it shows on the person's own day screen.
  await page.goto("/");
  await expect(page.getByText("From an agent")).toBeVisible();
});

test("the token works nowhere else", async () => {
  const ops = await api.post("/api/ops", {
    headers: { ...auth(), Origin: e2eEnv.PUBLIC_BASE_URL },
    data: { ops: [op("day.submit", { workDate: day })] },
  });
  expect(ops.status()).toBe(401);
  const page = await api.get("/account", { headers: auth(), maxRedirects: 0 });
  expect(page.status()).toBe(302);
  expect(page.headers().location).toContain("/signin");
});

test("revoking it on the Account page stops it at once", async () => {
  await page.goto("/account");
  const section = page.locator("#tokens");
  await expect(section.getByText(/last used (just now|\d+ minutes? ago)/)).toBeVisible();
  await section.getByRole("button", { name: "Revoke" }).click();
  await section.getByRole("button", { name: "Revoke token" }).click();
  await expect(section.getByText("No tokens.")).toBeVisible();
  expect((await api.get("/api/agent/me", { headers: auth() })).status()).toBe(401);
});

test("an admin sees a person's tokens on their page, and can revoke one there", async () => {
  // A second token, made the person's own way.
  await page.goto("/account");
  const own = page.locator("#tokens");
  await own.getByLabel("New token for").fill("Second agent");
  await own.getByRole("button", { name: "Make token" }).click();
  const dialog = page.getByRole("dialog", { name: "New token" });
  const second = (await dialog.locator("pre, code").first().innerText()).trim();
  await dialog.getByRole("button", { name: "Done" }).click();
  const secondAuth = { Authorization: `Bearer ${second}` };
  expect((await api.get("/api/agent/me", { headers: secondAuth })).status()).toBe(200);

  // The token owner here is an admin, so they see their own person page too.
  await page.goto(`/admin/people/${userId}`);
  const listed = page.locator("#tokens");
  await expect(listed.getByText("Second agent")).toBeVisible();
  await expect(listed.getByText(`lh_…${second.slice(-4)}`)).toBeVisible();
  // No way to make one for someone else from here.
  await expect(listed.getByRole("button", { name: "Make token" })).toHaveCount(0);
  await listed.getByRole("button", { name: "Revoke" }).click();
  await listed.getByRole("button", { name: "Revoke token" }).click();
  await expect(listed.getByText("No tokens.")).toBeVisible();
  expect((await api.get("/api/agent/me", { headers: secondAuth })).status()).toBe(401);
});
