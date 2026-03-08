import { test, expect } from "@playwright/test";

const PAGE_LOAD_BUDGET_MS = 2000;

test.describe("Pipeline page performance", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/login");
    await page.getByPlaceholder(/workspace/i).fill("demo");
    await page.getByPlaceholder(/email/i).fill("admin@demo.nexcrm.com");
    await page.getByPlaceholder(/password|••••/i).fill("demo123");
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL("**/");
  });

  test("pipeline board loads within budget", async ({ page }) => {
    const start = Date.now();
    await page.goto("/pipeline");
    await page.waitForLoadState("networkidle");

    // Wait for pipeline columns/stages to render
    const board = page.locator("[data-testid='pipeline-board'], .pipeline-board, [class*='pipeline']").first();
    await board.waitFor({ state: "visible", timeout: PAGE_LOAD_BUDGET_MS });

    const elapsed = Date.now() - start;
    console.log(`Pipeline page load: ${elapsed}ms (budget: ${PAGE_LOAD_BUDGET_MS}ms)`);

    expect(elapsed).toBeLessThan(PAGE_LOAD_BUDGET_MS);
  });

  test("pipeline page has no layout shift", async ({ page }) => {
    await page.goto("/pipeline");

    // Measure CLS using PerformanceObserver
    const cls = await page.evaluate(() => {
      return new Promise<number>((resolve) => {
        let clsValue = 0;
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (!(entry as any).hadRecentInput) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              clsValue += (entry as any).value;
            }
          }
        });
        observer.observe({ type: "layout-shift", buffered: true });
        setTimeout(() => {
          observer.disconnect();
          resolve(clsValue);
        }, 3000);
      });
    });

    console.log(`Pipeline CLS: ${cls}`);
    expect(cls).toBeLessThan(0.1);
  });
});
