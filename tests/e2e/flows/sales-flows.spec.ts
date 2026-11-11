/**
 * Browser end-to-end flows against a running stack (web + gateway + auth +
 * graph-core). Logs in through the real login form and drives the UI.
 *
 *   E2E_SLUG / E2E_EMAIL / E2E_PASSWORD — an ADMIN user in a workspace that
 *   already has some accounts and opportunities (e.g. after
 *   scripts/simulate-sales-org). Skipped when not set.
 */
import { test, expect, type Page } from "@playwright/test";

const SLUG = process.env.E2E_SLUG;
const EMAIL = process.env.E2E_EMAIL;
const PASSWORD = process.env.E2E_PASSWORD;

test.skip(!SLUG || !EMAIL || !PASSWORD, "E2E_SLUG / E2E_EMAIL / E2E_PASSWORD not set");
test.describe.configure({ mode: "serial" });

const stamp = Date.now().toString(36);
const problems: string[] = [];

/** Expected noise: AI engine is optional in this stack. */
const IGNORE = [/\/api\/v1\/ai\//, /status of 503/];

function watch(page: Page) {
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on("console", (m) => {
    if (m.type() === "error" && !IGNORE.some((r) => r.test(m.text()))) problems.push(`console: ${m.text().slice(0, 200)}`);
  });
  page.on("response", (r) => {
    const u = r.url();
    if (u.includes("/api/") && r.status() >= 500 && !IGNORE.some((x) => x.test(u))) problems.push(`HTTP ${r.status()} ${u}`);
  });
}

async function login(page: Page) {
  await page.goto("/login");
  await page.fill('input[name="tenantSlug"]', SLUG!);
  await page.fill('input[name="email"]', EMAIL!);
  await page.fill('input[name="password"]', PASSWORD!);
  await Promise.all([
    page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 }),
    page.click('button[type="submit"]'),
  ]);
}

test.beforeEach(async ({ page }) => {
  problems.length = 0;
  watch(page);
  await login(page);
});

test.afterEach(() => {
  expect(problems, "no page errors, console errors or 5xx responses").toEqual([]);
});

test("wrong password shows an error and stays on the login page", async ({ browser }) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.fill('input[name="tenantSlug"]', SLUG!);
  await page.fill('input[name="email"]', EMAIL!);
  await page.fill('input[name="password"]', "definitely-wrong");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(2500);
  expect(new URL(page.url()).pathname).toContain("/login");
});

test("every main page renders without errors", async ({ page }) => {
  test.setTimeout(600_000);
  const pages = ["dashboard", "leads", "contacts", "companies", "pipeline", "quotes", "approvals", "tasks", "activities",
    "reports", "forecasting", "workflows", "sequences", "marketing", "territories", "settings", "notifications",
    "knowledge", "audit-log", "lead-scoring", "anomalies", "insights", "coaching", "calling", "scheduler", "import",
    "compliance", "marketplace", "review"];
  for (const p of pages) {
    const res = await page.goto(`/${p}`, { waitUntil: "networkidle", timeout: 90_000 });
    expect(res?.status(), `/${p} status`).toBeLessThan(400);
    const body = await page.locator("body").innerText();
    expect(body, `/${p} shows an error page`).not.toMatch(/Application error|Unhandled Runtime Error|This page could not be found/);
    // Raw translation keys ("tasks.due") mean a missing message.
    expect(body, `/${p} shows a raw translation key`).not.toMatch(/\b(tasks|activities|settings|quotes|leads|pipeline|common)\.[a-z][A-Za-z]+\b/);
  }
});

test("dashboard totals come from all opportunities, not the first page", async ({ page }) => {
  const [summary] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/deals/summary") && r.status() === 200),
    page.goto("/dashboard"),
  ]);
  const { data } = await summary.json();
  await expect(page.getByText(`${data.open.count} active deals`)).toBeVisible();
});

test("pipeline board shows every stage, including pre-qualified", async ({ page }) => {
  await page.goto("/pipeline", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "All", exact: true }).click();
  await page.waitForLoadState("networkidle");
  for (const col of ["Pre-qualified", "Qualified", "Discovery", "Proposal", "Negotiation", "Closed Won", "Closed Lost"]) {
    await expect(page.getByText(col, { exact: true }).first()).toBeVisible();
  }
});

test("add a lead, then convert it to a new account with an opportunity", async ({ page }) => {
  test.setTimeout(120_000);
  const email = `flow.${stamp}@flowco-${stamp}.test`;
  await page.goto("/leads", { waitUntil: "networkidle" });
  await page.getByRole("button", { name: "Add Lead" }).click();
  await page.getByPlaceholder("Ada", { exact: true }).fill("Flow");
  await page.getByPlaceholder("Lovelace", { exact: true }).fill(`Lead${stamp}`);
  await page.getByPlaceholder("ada@company.com").fill(email);
  await page.getByRole("button", { name: "Create Lead" }).click();
  const row = page.getByRole("row").filter({ hasText: `Lead${stamp}` });
  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.getByRole("button", { name: /Convert/ }).click();
  await page.getByRole("button", { name: "New account" }).click();
  await page.locator("form").getByRole("textbox").first().fill(`FlowCo ${stamp}`);
  const [resp] = await Promise.all([
    page.waitForResponse((r) => /\/api\/v1\/leads\/[^/]+\/convert/.test(r.url())),
    page.locator('form button[type="submit"]').click(),
  ]);
  expect(resp.status(), "convert API status").toBe(201);
  await expect(page.getByText("Lead converted.")).toBeVisible();
  const body = await resp.json();
  expect(body.data.companyCreated).toBe(true);
  expect(body.data.dealId).toBeTruthy();

  // The converted person is now a contact, and is gone from the leads list.
  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("/leads", { waitUntil: "networkidle" });
  await expect(page.getByRole("row").filter({ hasText: `Lead${stamp}` })).toHaveCount(0);
  await page.goto("/contacts", { waitUntil: "networkidle" });
  await page.getByPlaceholder(/Search/).first().fill(`Lead${stamp}`);
  await expect(page.getByText(`Lead${stamp}`).first()).toBeVisible({ timeout: 20_000 });
});

test("global search finds a record", async ({ page }) => {
  await page.goto("/dashboard", { waitUntil: "networkidle" });
  const first = await (await page.request.get("/api/v1/companies?limit=1")).json();
  const term: string = first.data[0].name;
  const [resp] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/search") && r.status() === 200, { timeout: 30_000 }),
    (async () => {
      await page.getByRole("button", { name: /Search/ }).first().click();
      const input = page.locator('input[placeholder]').last();
      await input.waitFor({ state: "visible" });
      await input.fill(term);
    })(),
  ]);
  const body = await resp.json();
  expect(body.data.results.length).toBeGreaterThan(0);
  await expect(page.getByText(term).first()).toBeVisible();
});

test("every settings tab opens", async ({ page }) => {
  test.setTimeout(240_000);
  await page.goto("/settings", { waitUntil: "networkidle" });
  const tabs = page.locator("nav button, aside button").filter({ hasText: /\S/ });
  const n = await tabs.count();
  expect(n).toBeGreaterThan(8);
  for (let i = 0; i < n; i++) {
    await tabs.nth(i).click();
    await page.waitForLoadState("networkidle");
    await expect(page.locator("body")).not.toContainText(/Application error|Unhandled Runtime Error/);
  }
});

test("workflow builder offers catalog triggers and actions", async ({ page }) => {
  const [cat] = await Promise.all([
    page.waitForResponse((r) => r.url().includes("/api/v1/workflows/catalog") && r.status() === 200),
    page.goto("/workflows"),
  ]);
  const { data } = await cat.json();
  expect(data.triggers.length).toBeGreaterThan(20);
  expect(data.actions.length).toBeGreaterThanOrEqual(11);
});
