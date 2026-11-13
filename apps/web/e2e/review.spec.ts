import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const fixture = (name: string) => resolve("../api/tests/fixtures", name);

test("review shows workbook cells, B/L pages, mismatches and CDC candidates", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");
  const subject = `Sanitized document review ${randomUUID().slice(0, 8)}`;
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.getByText("Simulate an arrival", { exact: true }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Attachments", { exact: true }).setInputFiles([
    fixture("supplier-review.xlsx"), fixture("draft-bl-review.pdf"),
  ]);
  await page.getByRole("button", { name: "Archive arrival" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const analysis = `/api/v1/intakes/${new URL(page.url()).pathname.split("/").at(-1)}/analysis`;
  const read = async () => (await page.request.get(analysis)).json();
  await expect.poll(async () => (await read()).state, { timeout: 25_000 }).toBe("available");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "Comparison findings" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: /quantity.*mismatch/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /supplier-review.xlsx · invoice · D10/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /draft-bl-review.pdf · Page 1/ }).first()).toBeVisible();
  await page.getByText("Register a verified workbook", { exact: true }).click();
  await page.getByLabel("Company on approval").fill("Harbor Demo Co., Ltd.");
  await page.getByLabel("Approval reference").fill("QIP # DEMO-2026");
  await page.getByLabel("Approval year").fill("2026");
  await page.getByLabel("Master List workbook").setInputFiles(fixture("cdc-review.xlsx"));
  await page.getByRole("checkbox", { name: /I checked this workbook/ }).check();
  const registered = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/cdc/versions") && [200, 201].includes(response.status()));
  await page.getByRole("button", { name: "Register workbook" }).click();
  const version = await (await registered).json();
  await page.getByLabel("CDC Master List version").selectOption(version.id);
  await page.getByRole("button", { name: "Apply version" }).click();
  await expect.poll(async () => {
    const result = await read();
    return [result.state, result.analyzed_master?.id];
  }, { timeout: 25_000 }).toEqual(["available", version.id]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("heading", { name: "CDC candidates" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: /unit.*mismatch/i }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Download CDC original", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Save import draft" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve intake" })).toHaveCount(0);
  const evidence = page.getByRole("region", { name: "Document evidence and comparisons" });
  await evidence.getByText("Invoice source excerpt", { exact: true }).click();
  await evidence.getByText(/Draft B\/L source excerpt/).click();
  await evidence.screenshot({ path: process.env.SHIPPING_REVIEW_SCREENSHOT ?? test.info().outputPath("review-center.png") });
});
