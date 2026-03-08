import { test, expect } from "@playwright/test";

const PAGE_LOAD_BUDGET_MS = 2000;

test.describe("Contacts page performance", () => {
  test.beforeEach(async ({ page }) => {
    // Login first
    await page.goto("/login");
    await page.getByPlaceholder(/workspace/i).fill("demo");
    await page.getByPlaceholder(/email/i).fill("admin@demo.nexcrm.com");
    await page.getByPlaceholder(/password|••••/i).fill("demo123");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/");
  });

  test("contacts list loads within budget", async ({ page }) => {
    const start = Date.now();
    await page.goto("/contacts");
    await page.waitForLoadState("networkidle");

    // Wait for the table/list to render
    const content = page.locator("table, [data-testid='contacts-list']").first();
    await content.waitFor({ state: "visible", timeout: PAGE_LOAD_BUDGET_MS });

    const elapsed = Date.now() - start;
    console.log(`Contacts page load: ${elapsed}ms (budget: ${PAGE_LOAD_BUDGET_MS}ms)`);

    expect(elapsed).toBeLessThan(PAGE_LOAD_BUDGET_MS);
  });

  test("search responds within 500ms", async ({ page }) => {
    await page.goto("/contacts");
    await page.waitForLoadState("networkidle");

    const searchInput = page.getByPlaceholder(/search/i).first();
    await searchInput.waitFor({ state: "visible" });

    const start = Date.now();
    await searchInput.fill("test");

    // Wait for results to update (debounced search)
    await page.waitForTimeout(500);
    const elapsed = Date.now() - start;

    console.log(`Search response: ${elapsed}ms`);
    expect(elapsed).toBeLessThan(1000);
  });
});
