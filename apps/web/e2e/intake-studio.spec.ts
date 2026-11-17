import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ReviewAnalysis, ReviewWorkflow } from "../src/lib/contracts";

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

  await expect(tabs.getByRole("button", { name: /^B\/L(?:\s|$)/ })).toHaveAttribute("aria-pressed", "true");
  await expect(details.getByRole("button", { name: "B/L Number DEMOBL0001" })).toBeVisible();
  await expect(details.getByText("Vessel", { exact: true })).toHaveCount(0);
  await page.getByRole("region", { name: "Goods", exact: true })
    .getByRole("button", { name: /Description of Goods Woven label/i }).click();
  await expect(source.getByRole("img", { name: "Source citation bounding box" })).toBeVisible();
  await expect(source.getByText("Page 1", { exact: true })).toBeVisible();
  await expect(source.getByText("99% match")).toHaveCount(0);
  await expectConnectorAtTarget();
  const billNumber = details.getByRole("button", { name: "B/L Number DEMOBL0001" });
  const legacyLineRequests: string[] = [];
  page.on("request", (request) => {
    if (/\/pages\/1\?.*&line=\d+$/.test(request.url())) legacyLineRequests.push(request.url());
  });
  await billNumber.click();
  await expect(source.getByRole("img", { name: "draft-bl-review.pdf, page 1" })).toBeVisible();
  await expectConnectorAtTarget();
  expect(legacyLineRequests).toHaveLength(0);
  await expect(source.getByRole("textbox", { name: "B/L Number value" })).toHaveValue("DEMOBL0001");
  await source.getByRole("button", { name: "Zoom In" }).click();
  await expectConnectorAtTarget();

  await viewport.evaluate((node) => node.scrollTo({ top: node.scrollHeight, behavior: "instant" }));
  await expect(connector).toBeHidden();
  await billNumber.click();
  await expectConnectorAtTarget();

  await details.getByRole("button", { name: /^Shipper/ }).click();
  await expectConnectorAtTarget();
  await expect(source.getByRole("button", { name: "Raw Excerpt", exact: true })).toBeVisible();
  await source.getByRole("button", { name: "Raw Excerpt", exact: true }).click();
  await expect(target).toContainText("Fabric Demo Co., Ltd.");
  await expectConnectorAtTarget();
  await billNumber.click();
  await expect(target).toContainText("DEMOBL0001");
  await expectConnectorAtTarget();
  await source.getByRole("button", { name: "Document Canvas", exact: true }).click();
  await expect(source.getByRole("img", { name: "Source citation bounding box" })).toBeVisible();
  await expectConnectorAtTarget();

  await tabs.getByRole("button", { name: /^Invoice(?:\s|$)/ }).click();
  await expect(connector).toBeHidden();
  await expect(details.getByText("Invoice Number", { exact: true })).toBeVisible();
  await expect(details.getByText("B/L Number", { exact: true })).toHaveCount(0);
  const consignee = details.getByRole("button", { name: /^Consignee / });
  await consignee.click({ position: { x: 3, y: 8 } });
  await expect(consignee).toHaveAttribute("aria-pressed", "true");
  await expect(source.getByRole("region", { name: "Edit Consignee" })).toBeVisible();
  await expect(source.locator('td[data-connector-target="true"]')).toContainText("Harbor Demo Co., Ltd.");
  await expect(goods.getByRole("columnheader", { name: "Unit Price" })).toBeVisible();
  const invoiceItem = goods.getByRole("row").filter({ hasText: "Woven label" });
  await invoiceItem.getByRole("button", { name: "12 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("invoice");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("12");
  await expectConnectorAtTarget();

  await tabs.getByRole("button", { name: /^Packing list(?:\s|$)/ }).click();
  const packedItem = goods.getByRole("row").filter({ hasText: "Woven label" });
  await packedItem.getByRole("button", { name: "10 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("PackingList");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("10");
  await expect(goods.getByRole("columnheader", { name: "Gross Weight" })).toBeVisible();
  await expectConnectorAtTarget();

  const workflow: ReviewWorkflow = await (await page.request.get(`${intakePath}/review`)).json();
  const issueCount = workflow.issues?.length ?? 0;
  expect(issueCount).toBeGreaterThan(1);
  const issues = page.getByRole("navigation", { name: "Review issues" });
  const previousIssue = issues.getByRole("button", { name: "Previous issue" });
  const nextIssue = issues.getByRole("button", { name: "Next issue" });
  await expect(issues.getByRole("status")).toHaveText(`${issueCount} issues`);
  await expect(previousIssue).toBeDisabled();
  await nextIssue.click();
  await expect(issues.getByRole("status")).toContainText(`1 / ${issueCount}`);
  await expect(source.getByLabel("Worksheet")).toHaveValue("invoice");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("12");
  await expect(source.getByRole("textbox", { name: "Quantity value" })).toHaveValue("12");
  await nextIssue.click();
  await expect(issues.getByRole("status")).toContainText(`2 / ${issueCount}`);
  await previousIssue.click();
  await expect(issues.getByRole("status")).toContainText(`1 / ${issueCount}`);
  await expect(previousIssue).toBeDisabled();
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("12");

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(goods).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
