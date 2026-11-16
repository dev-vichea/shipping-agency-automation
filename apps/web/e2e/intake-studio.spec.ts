import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ReviewAnalysis } from "../src/lib/contracts";

const fixture = (name: string) => resolve("../api/tests/fixtures", name);

test("intake review shows detected fields and links goods to their source", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await page.getByRole("link", { name: "Upload documents", exact: true }).click();
  await page.getByLabel("Subject").fill(`Intake studio ${randomUUID()}`);
  await page.getByLabel("Attachments", { exact: true }).setInputFiles([
    fixture("supplier-review.xlsx"),
    fixture("draft-bl-review.pdf"),
  ]);
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  const intakePath = new URL(page.url()).pathname.replace("/review/", "/api/v1/intakes/");
  await expect.poll(async () => {
    const response = await page.request.get(`${intakePath}/analysis`);
    const analysis: ReviewAnalysis = await response.json();
    return analysis.state;
  }, { timeout: 25_000 }).toBe("available");
  await page.reload();

  const tabs = page.getByRole("navigation", { name: "Document intake tabs" });
  const details = page.getByRole("region", { name: "Document Details" });
  const goods = page.getByRole("region", { name: "Goods items" });
  const source = page.getByRole("region", { name: "Source viewer" });
  const viewport = source.getByLabel("Document canvas viewport");
  const connector = page.locator("[data-evidence-connector]");
  const target = source.locator("[data-connector-target]");

  async function expectConnectorAtTarget() {
    await expect(connector).toBeVisible();
    await expect.poll(async () => {
      const [overlay, highlight] = await Promise.all([connector.boundingBox(), target.boundingBox()]);
      if (!overlay || !highlight) return Infinity;
      const pin = await connector.locator("circle").last().evaluate((node: SVGCircleElement) => ({
        x: node.cx.baseVal.value, y: node.cy.baseVal.value,
      }));
      return Math.hypot(overlay.x + pin.x - highlight.x, overlay.y + pin.y - highlight.y - highlight.height / 2);
    }).toBeLessThan(2);
  }

  await expect(tabs.getByRole("button", { name: "B/L", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(details.getByRole("button", { name: "B/L Number DEMOBL0001" })).toBeVisible();
  await expect(details.getByText("Vessel", { exact: true })).toHaveCount(0);
  await page.getByRole("region", { name: "Goods", exact: true })
    .getByRole("button", { name: /Description of Goods Woven label/i }).click();
  await expect(source.getByRole("img", { name: "Source citation bounding box" })).toBeVisible();
  await expect(source.getByText(/Page 1 · Line \d+/)).toBeVisible();
  await expect(source.getByText("99% match")).toHaveCount(0);
  await expectConnectorAtTarget();
  const pendingCitation = Promise.withResolvers<void>();
  await page.route(/\/pages\/1\?.*&line=\d+$/, async (route) => {
    await Promise.all([pendingCitation.promise, new Promise((resolve) => setTimeout(resolve, 900))]);
    await route.continue();
  }, { times: 1 });
  const billNumber = details.getByRole("button", { name: "B/L Number DEMOBL0001" });
  try {
    await billNumber.click();
    await expect(connector).toBeHidden();
    await expect(source.getByRole("img", { name: "draft-bl-review.pdf, page 1" })).toBeVisible();
  } finally {
    pendingCitation.resolve();
  }
  await expectConnectorAtTarget();
  await expect(source.getByText("DEMOBL0001", { exact: true })).toBeVisible();
  await source.getByRole("button", { name: "Zoom In" }).click();
  await expectConnectorAtTarget();

  await viewport.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
  await expect(connector).toBeHidden();
  await billNumber.click();
  await expectConnectorAtTarget();

  await page.route(/\/pages\/1\?.*&line=\d+$/, async (route) => {
    const response = await route.fetch();
    await route.fulfill({ response, json: { ...(await response.json()), box: null } });
  }, { times: 1 });
  await details.getByRole("button", { name: /^Shipper/ }).click();
  await expect(target).toContainText("Shipper");
  await expectConnectorAtTarget();

  await tabs.getByRole("button", { name: "Invoice", exact: true }).click();
  await expect(connector).toBeHidden();
  await expect(details.getByText("Invoice Number", { exact: true })).toBeVisible();
  await expect(details.getByText("B/L Number", { exact: true })).toHaveCount(0);
  await expect(goods.getByRole("columnheader", { name: "Unit Price" })).toBeVisible();
  const invoiceItem = goods.getByRole("row").filter({ hasText: "Woven label" });
  await invoiceItem.getByRole("button", { name: "12 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("invoice");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("12");
  await expectConnectorAtTarget();

  await tabs.getByRole("button", { name: "Packing list", exact: true }).click();
  const packedItem = goods.getByRole("row").filter({ hasText: "Woven label" });
  await packedItem.getByRole("button", { name: "10 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("PackingList");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("10");
  await expect(goods.getByRole("columnheader", { name: "Gross Weight" })).toBeVisible();
  await expectConnectorAtTarget();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(goods).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
