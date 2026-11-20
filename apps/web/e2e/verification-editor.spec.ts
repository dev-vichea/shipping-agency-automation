import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ReviewAnalysis, ReviewWorkflow } from "../src/lib/contracts";

async function login(page: Page) {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure a synthetic editor test account.");
  await page.context().setExtraHTTPHeaders({ Origin: process.env.SHIPPING_E2E_URL ?? "http://localhost:3000" });
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
}

test("verification edits real document cells, synchronizes print previews, confirms individually and reviews inline CDC", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await login(page);
  expect((await page.request.post("/api/v1/workspaces", { data: { name: `Document editor ${randomUUID().slice(0, 8)}` } })).ok()).toBe(true);
  const company = await page.request.post("/api/v1/companies", { data: { name: "Harbor Demo Co., Ltd." } });
  expect(company.ok()).toBe(true);
  const companyId = (await company.json()).id;
  const registered = await page.request.post("/api/v1/cdc/versions", { multipart: {
    company: "Harbor Demo Co., Ltd.", company_id: companyId, year: "2026", approval_ref: "DEMO-2026", verified: "true",
    file: { name: "cdc-review.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await readFile(resolve("../api/tests/fixtures/cdc-review.xlsx")) },
  } });
  expect(registered.ok()).toBe(true);
  const version = await registered.json();
  const files = new FormData();
  files.set("company_id", companyId); files.set("provider_message_id", randomUUID());
  for (const name of ["supplier-review.xlsx", "draft-bl-review.pdf"]) files.append("files", new File([new Uint8Array(await readFile(resolve("../api/tests/fixtures", name)))], name));
  const receipt = await page.request.post("/api/v1/intakes/simulate", { multipart: files });
  expect(receipt.ok()).toBe(true);
  const id = (await receipt.json()).case_id;
  const path = `/api/v1/intakes/${id}`;
  const read = async (): Promise<ReviewAnalysis> => (await page.request.get(`${path}/analysis`)).json();
  const workflow = async (): Promise<ReviewWorkflow> => (await page.request.get(`${path}/review`)).json();
  await expect.poll(async () => (await read()).state, { timeout: 30_000 }).toBe("available");
  expect((await page.request.post(`${path}/cdc-version`, { data: { expected_revision: (await read()).revision, version_id: version.id } })).ok()).toBe(true);
  await expect.poll(async () => (await read()).state, { timeout: 30_000 }).toBe("available");
  await page.goto(`/review/${id}`);
  await page.getByRole("button", { name: /^Verification/ }).click();
  const editor = page.getByRole("region", { name: "Verification document editor", exact: true });
  const left = editor.getByRole("region", { name: "Editable document data" });
  const right = editor.getByRole("region", { name: "Permit draft print preview" });
  const tabs = editor.getByRole("navigation", { name: "Verification documents" });
  await expect(left.getByLabel("Invoice Invoice Number", { exact: true })).toHaveValue("INV-FIXTURE-101");
  await expect(left.getByText("AI-filled", { exact: true })).toHaveCount(0);
  await left.getByLabel("Invoice row 10 Quantity", { exact: true }).focus();
  await expect(right.locator('[data-permit-print-sheet="inv"]')).toContainText("INV-FIXTURE-101");
  await expect(right.getByLabel("Worksheet")).toHaveCount(0);
  await tabs.getByRole("button", { name: /Packing List/ }).click();
  await expect(right.getByRole("heading", { name: "PACKING LIST", exact: true })).toBeVisible();
  await expect(left.getByLabel("Packing list row 11 Quantity", { exact: true })).toHaveValue("10");
  await left.getByLabel("Packing list row 11 Quantity", { exact: true }).focus();
  await expect(right.locator('[data-permit-print-sheet="pl"]')).toContainText("WOVEN LABEL");
  await tabs.getByRole("button", { name: /Invoice/ }).click();
  const separator = editor.getByRole("separator", { name: "Resize editor and preview" });
  const before = (await left.boundingBox())!.width;
  await separator.press("ArrowRight"); await separator.press("ArrowRight");
  await expect(separator).toHaveAttribute("aria-valuenow", "54");
  expect((await left.boundingBox())!.width).toBeGreaterThan(before);

  await left.getByRole("button", { name: "Suggestions for Invoice row 10 Quantity", exact: true }).click();
  const choices = left.getByLabel("Source suggestions for Invoice row 10 Quantity", { exact: true });
  const packingChoice = await choices.locator("option").evaluateAll((options) => options.find((option) => option.textContent?.includes("packing list"))?.getAttribute("value"));
  expect(packingChoice).toBeTruthy();
  await choices.selectOption(packingChoice!);
  await expect.poll(async () => (await workflow()).review?.corrections.find((entry) => entry.name === "quantity")?.confirmed).toBe(false);
  await left.getByRole("button", { name: "Confirm Invoice row 10 Quantity", exact: true }).click();
  await expect.poll(async () => (await workflow()).review?.corrections.find((entry) => entry.name === "quantity")?.confirmed).toBe(true);
  const copied = (await workflow()).review?.changes.find((entry) => entry.edit.name === "quantity");
  expect(copied?.after.value).toBe("10");
  expect(copied?.after.evidence[0].sheet).toBe("PackingList");
  await expect(right.getByRole("heading", { name: "INVOICE", exact: true })).toBeVisible();

  // Delay saves while typing in two different cells. The second request must keep
  // the first value and use the review id returned by its completed save.
  await page.route(`**${path}/review`, async (route) => {
    if (route.request().method() === "POST") await new Promise((resolve) => setTimeout(resolve, 250));
    await route.continue();
  });
  await left.getByLabel("Invoice Origin", { exact: true }).fill("Harbor West");
  await left.getByLabel("Invoice Destination", { exact: true }).fill("River Terminal");
  await left.getByRole("heading", { name: /Commercial invoice/ }).click();
  await expect.poll(async () => (await workflow()).review?.corrections.filter((entry) => ["origin", "destination"].includes(entry.name)).length).toBe(2);
  expect((await workflow()).review?.ready).toBe(false);
  await left.getByRole("button", { name: "Confirm Invoice Origin", exact: true }).click();
  await expect(left.getByLabel("Invoice Origin", { exact: true })).toHaveAttribute("readonly", "");
  const prior = (await workflow()).review?.id;
  await editor.getByRole("checkbox", { name: "AI suggestions", exact: true }).uncheck();
  await editor.getByRole("checkbox", { name: "AI suggestions", exact: true }).check();
  expect((await workflow()).review?.id).toBe(prior);
  await left.getByRole("button", { name: "Edit verified Invoice Origin", exact: true }).click();
  await left.getByLabel("Invoice Origin", { exact: true }).fill("Harbor East");
  expect((await workflow()).review?.changes.find((entry) => entry.edit.name === "origin")?.after.value).toBe("Harbor West");
  await left.getByLabel("Reason for Invoice Origin", { exact: true }).fill("Checked the corrected origin against supplier instructions.");
  await left.getByRole("button", { name: "Confirm Invoice Origin", exact: true }).click();
  await expect.poll(async () => (await workflow()).review?.changes.find((entry) => entry.edit.name === "origin")?.after.value).toBe("Harbor East");
  await expect(right.locator("[data-permit-print-sheet]")).toContainText("Harbor East");

  await editor.getByRole("checkbox", { name: "Autosave edits", exact: true }).uncheck();
  await left.getByLabel("Invoice Invoice Date", { exact: true }).fill("2026-11-17");
  await expect(editor.getByRole("status")).toContainText("unsaved");
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toBeDisabled();
  expect((await workflow()).review?.corrections.some((entry) => entry.name === "invoice_date")).toBe(false);
  await left.getByRole("button", { name: "Save edit", exact: true }).click();
  await expect.poll(async () => (await workflow()).review?.corrections.find((entry) => entry.name === "invoice_date")?.confirmed).toBe(false);
  await left.getByRole("button", { name: "Confirm Invoice Invoice Date", exact: true }).click();
  await expect.poll(async () => (await workflow()).review?.corrections.find((entry) => entry.name === "invoice_date")?.confirmed).toBe(true);
  await editor.getByRole("checkbox", { name: "Autosave edits", exact: true }).check();

  await left.getByRole("button", { name: "Review CDC material", exact: true }).first().click();
  const material = left.getByRole("region", { name: "CDC options for row 10" });
  await expect(material.getByText(/Best Matches/i)).toBeVisible();
  await material.getByRole("button").first().click();
  await expect.poll(async () => (await workflow()).review?.mappings.length).toBe(1);
  expect((await workflow()).review?.cdc_ready).toBe(false);
  await editor.getByRole("button", { name: "History", exact: true }).click();
  await expect(editor.getByLabel("Verification audit history")).toContainText("Harbor East");
  const lineItems = left.getByLabel("Editable line items");
  await expect(lineItems.getByRole("columnheader", { name: "Amount", exact: true })).toBeVisible();
  expect(await left.evaluate((element) => element.scrollHeight - element.clientHeight)).toBeLessThanOrEqual(1);
  expect(await lineItems.evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1);
  await expect(lineItems.locator('[data-slot="table-container"]')).toHaveCSS("overflow-x", "visible");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: test.info().outputPath("verification-editor-desktop.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: /^Verification/ }).click();
  await expect(page.getByLabel("Invoice Origin", { exact: true })).toHaveValue("Harbor East");
  await expect(page.getByLabel("Invoice Origin", { exact: true })).toHaveAttribute("readonly", "");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("region", { name: "Permit draft print preview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: test.info().outputPath("verification-editor-mobile.png"), fullPage: true });
  expect(errors).toEqual([]);
});

test("verification restores all three printable templates and synchronizes both document switches", async ({ page }) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await login(page);
  expect((await page.request.post("/api/v1/workspaces", { data: { name: `PDF editor ${randomUUID().slice(0, 8)}` } })).ok()).toBe(true);
  const files = new FormData(); files.set("provider_message_id", randomUUID());
  for (const name of ["verification-invoice.pdf", "verification-packing.pdf", "draft-bl-review.pdf"]) files.append("files", new File([new Uint8Array(await readFile(resolve("../api/tests/fixtures", name)))], name, { type: "application/pdf" }));
  const received = await page.request.post("/api/v1/intakes/simulate", { multipart: files });
  expect(received.ok()).toBe(true);
  const id = (await received.json()).case_id;
  await expect.poll(async () => (await (await page.request.get(`/api/v1/intakes/${id}/analysis`)).json()).state, { timeout: 30_000 }).toBe("available");
  await page.goto(`/review/${id}`);
  await page.getByRole("button", { name: /^Verification/ }).click();
  const editor = page.getByRole("region", { name: "Verification document editor", exact: true });
  const left = editor.getByRole("region", { name: "Editable document data" });
  const right = editor.getByRole("region", { name: "Permit draft print preview" });
  const template = right.getByLabel("Print template");
  await expect(template.locator("option")).toHaveCount(3);
  const controls = right.getByRole("group", { name: "Canvas controls" });
  const originalWidth = (await right.locator("[data-permit-print-sheet]").boundingBox())!.width;
  await controls.getByRole("button", { name: "Zoom In", exact: true }).click();
  await expect.poll(async () => (await right.locator("[data-permit-print-sheet]").boundingBox())!.width).toBeGreaterThan(originalWidth);
  await controls.getByRole("button", { name: "Reset zoom", exact: true }).click();
  const previewBounds = (await right.boundingBox())!;
  await expect.poll(async () => (await right.locator("[data-permit-print-sheet]").boundingBox())!.width).toBeLessThan(previewBounds.width);
  expect((await right.locator("[data-permit-print-sheet]").boundingBox())!.x).toBeGreaterThanOrEqual(previewBounds.x);
  for (const value of ["cdc_classic", "freight_agency", "commercial_billing"]) {
    await template.selectOption(value);
    await expect(right.getByRole("heading", { name: "INVOICE", exact: true })).toBeVisible();
    await expect(right.locator("[data-permit-print-sheet]")).toContainText("CERAMIC BEARINGS BX-24");
    await right.getByRole("button", { name: "PL (Packing List)", exact: true }).click();
    await expect(left.getByLabel("Packing list Invoice Number", { exact: true })).toHaveValue("FABLE-482");
    await expect(right.getByRole("heading", { name: "PACKING LIST", exact: true })).toBeVisible();
    await expect(template).toHaveValue(value);
    await editor.getByRole("navigation", { name: "Verification documents" }).getByRole("button", { name: /Invoice/ }).click();
    await expect(right.getByRole("button", { name: "INV (Invoice)", exact: true })).toHaveAttribute("aria-pressed", "true");
  }
  await expect(right.getByLabel("Worksheet")).toHaveCount(0);
  await expect(right.getByRole("button", { name: "Raw Excerpt", exact: true })).toHaveCount(0);
  await page.evaluate(() => { window.print = () => { document.documentElement.dataset.printCalled = "true"; }; });
  await right.getByRole("button", { name: "Print Preview", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-print-called", "true");
  await right.getByRole("button", { name: "Fullscreen preview", exact: true }).click();
  await expect(page.getByRole("button", { name: "Exit fullscreen", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
  const workflow = await (await page.request.get(`/api/v1/intakes/${id}/review`)).json();
  expect(workflow.review).toBeNull();
  await page.screenshot({ path: test.info().outputPath("verification-editor-pdf.png"), fullPage: true });
});
