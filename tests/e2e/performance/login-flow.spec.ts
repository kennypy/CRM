import { test, expect } from "@playwright/test";

const BUDGET_MS = 3000; // Login → dashboard in under 3 seconds

test.describe("Login flow performance", () => {
  test("login and reach dashboard within budget", async ({ page }) => {
    const start = Date.now();

    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Fill login form
    await page.getByPlaceholder(/workspace/i).fill("demo");
    await page.getByPlaceholder(/email/i).fill("admin@demo.nexcrm.com");
    await page.getByPlaceholder(/password|••••/i).fill("demo123");
    await page.getByRole("button", { name: /sign in/i }).click();

    // Wait for dashboard to load
    await page.waitForURL("**/", { timeout: BUDGET_MS });
    await page.waitForLoadState("networkidle");

    const elapsed = Date.now() - start;
    console.log(`Login → dashboard: ${elapsed}ms (budget: ${BUDGET_MS}ms)`);

    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

  test("login page loads within 1.5s", async ({ page }) => {
    const start = Date.now();
    await page.goto("/login");
    await page.waitForLoadState("domcontentloaded");

    // Ensure the form is visible
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();

    const elapsed = Date.now() - start;
    console.log(`Login page load: ${elapsed}ms`);

    expect(elapsed).toBeLessThan(1500);
  });
});
