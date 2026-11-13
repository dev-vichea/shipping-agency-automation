import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("staff archives originals, verifies the worker and saves an import draft", async ({ page, request }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Set SHIPPING_E2E_EMAIL and SHIPPING_E2E_PASSWORD to a local test account.");

  const suffix = randomUUID().slice(0, 8);
  const subject = `Synthetic arrival ${suffix}`;
  const filename = `fixture-${suffix}.pdf`;
  const invoice = `TEST-${suffix}`;
  const original = Buffer.from("%PDF-1.4\nSynthetic document for intake testing\n%%EOF\n");
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  await page.goto("/inbox");
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Inbox" })).toBeVisible();
  await page.getByText("Simulate an arrival", { exact: true }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message", { exact: true }).fill("Synthetic shipping note without an invoice reference.");
  await page.getByLabel("Attachments", { exact: true }).setInputFiles({
    name: filename, mimeType: "application/pdf", buffer: original,
  });
  await page.getByLabel("Attachment type").selectOption("draft_bl");
  await page.getByRole("button", { name: "Archive arrival" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const caseUrl = page.url();
  const caseId = new URL(caseUrl).pathname.split("/").at(-1);
  const downloadLink = page.getByRole("link", { name: `Download ${filename}` });
  const href = (await downloadLink.getAttribute("href"))!;
  expect((await request.get(href)).status()).toBe(401);
  const download = page.waitForEvent("download");
  await downloadLink.click();
  expect(await readFile((await (await download).path())!)).toEqual(original);

  await expect.poll(async () => {
    const response = await page.request.get(`/api/v1/intakes/${caseId}`);
    if (!response.ok()) return response.status();
    const record = await response.json();
    return [record.state, record.detected_reference, record.import_id];
  }).toEqual(["needs_review", null, null]);
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByText("Needs review", { exact: true }).first()).toBeVisible();

  await page.getByLabel("Company", { exact: true }).fill("Synthetic Shipping Co");
  await page.getByLabel("Invoice number").fill(invoice);
  await page.getByLabel("Supplier").fill("Synthetic Supplier");
  await page.getByRole("button", { name: "Save import draft" }).click();
  await expect(page.getByRole("heading", { name: invoice })).toBeVisible();
  const draftUrl = page.url();
  await expect(page.getByText("Import draft · pending approval")).toBeVisible();
  await expect(page.getByRole("link", { name: `Download ${filename}` })).toBeVisible();
  await page.getByRole("link", { name: "Imports", exact: true }).click();
  await expect(page.getByRole("link", { name: invoice })).toBeVisible();

  await page.getByRole("link", { name: "Automation", exact: true }).click();
  const healthResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/automation/health-check") && response.status() === 202);
  await page.getByRole("button", { name: "Run worker check" }).click();
  const healthId = (await (await healthResponse).json()).id;
  await expect.poll(async () => {
    const runs = await (await page.request.get("/api/v1/automation/runs")).json();
    return runs.find((run: { id: string }) => run.id === healthId)?.state;
  }).toBe("succeeded");
  await page.getByRole("button", { name: "Refresh" }).click();
  await expect(page.getByRole("row").filter({ hasText: "Worker health check" }).first()).toContainText("Succeeded");
  await expect(page.getByText(/Ollama · qwen3.5/)).toBeVisible();

  await page.goto(draftUrl);
  await expect(page.getByRole("heading", { name: invoice })).toBeVisible();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  expect((await page.request.get(href)).status()).toBe(401);
  expect(consoleErrors).toEqual([]);
});
