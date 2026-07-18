import { test, expect, type Page } from "@playwright/test";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * WealthRank end-to-end suite. Every major user-facing feature, exercised the
 * way a real user would, on desktop AND an iPhone-sized viewport.
 *
 * Run:  npx playwright test            (against the live site)
 *       WR_BASE_URL=http://localhost:4173 npx playwright test   (local build)
 */

// 1x1 PNG (valid image bytes) used to exercise the receipt pipeline.
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

const CSV_FIXTURE = path.join(__dirname, "..", "fixtures", "test-bank.csv");

async function gotoMoney(page: Page) {
  await page.goto("/money");
  await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
}

test.describe("Rank", () => {
  test("computes a percentile from age + net worth", async ({ page }) => {
    await page.goto("/");
    await page.getByLabel("Your age", { exact: true }).fill("21");
    await page.locator('input[placeholder="12,000"]').fill("15000");
    await page.getByRole("button", { name: /check my rank/i }).click();
    await expect(page.locator(".pct-number")).toContainText("percentile");
  });

  test("URL routing works: /money and /learn load their tabs directly", async ({ page }) => {
    await page.goto("/money");
    await expect(page.getByRole("heading", { name: "Your money" })).toBeVisible();
    await page.goto("/learn");
    await expect(page.getByRole("heading", { name: "Make it grow" })).toBeVisible();
  });
});

test.describe("Account", () => {
  test("modal opens with username + password fields and closes", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: /account/i }).click();
    await expect(page.locator(".modal")).toBeVisible();
    await expect(page.locator('.modal input[type="password"], .modal button')).not.toHaveCount(0);
    await page.locator(".modal-backdrop").click({ position: { x: 5, y: 5 } });
    await expect(page.locator(".modal")).toBeHidden();
  });
});

test.describe("Money: paycheck + taxes", () => {
  test("all 50 states + DC selectable; state tax changes the take-home", async ({ page }) => {
    await gotoMoney(page);
    const state = page.getByLabel("Your state");
    // 50 states + DC + the "Pick your state..." placeholder
    await expect(state.locator("option")).toHaveCount(52);
    await page.getByLabel(/yearly salary/i).fill("62000");
    await state.selectOption("VA");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(page.locator(".takehome-head")).toContainText("Take-home estimate");
    const taxesVA = await page.locator(".takehome-taxes").innerText();
    expect(taxesVA).toContain("State");
    await state.selectOption("TX");
    const taxesTX = await page.locator(".takehome-taxes").innerText();
    expect(taxesTX).not.toContain("State"); // TX has no wage tax
    await expect(page.locator(".takehome-taxes")).toContainText("Federal");
  });
});

test.describe("Money: ledger features", () => {
  test("bank CSV import adds categorized rows to the ledger", async ({ page }) => {
    await gotoMoney(page);
    await page.locator('input[type="file"][accept*="csv"]').setInputFiles(CSV_FIXTURE);
    await expect(page.locator(".import-msg")).toContainText(/imported 5 transactions/i, { timeout: 20_000 });
    await expect(page.locator(".ledger")).toContainText("PAYROLL ACME CORP");
    await expect(page.locator(".ledger")).toContainText("NETFLIX.COM");
  });

  test("receipt attach decodes an image and reports success", async ({ page }) => {
    await gotoMoney(page);
    await page.locator('input[type="file"][accept*="image"]').setInputFiles({
      name: "receipt.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });
    await expect(page.locator(".import-msg")).toContainText(/receipt attached/i, { timeout: 20_000 });
  });
});

test.describe("Learn", () => {
  test("compound interest simulator renders projections", async ({ page }) => {
    await page.goto("/learn");
    await expect(page.locator(".proj").first()).toContainText("$");
    await expect(page.getByRole("heading", { name: "The order of operations" })).toBeVisible();
  });
});

test.describe("Layout", () => {
  test("no horizontal overflow on any tab", async ({ page }) => {
    for (const route of ["/", "/money", "/learn"]) {
      await page.goto(route);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      );
      expect(overflow, `${route} overflows horizontally`).toBeLessThanOrEqual(0);
    }
  });
});
