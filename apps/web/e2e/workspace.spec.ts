import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";

test("staff archives originals, verifies the worker and saves an import draft", async ({ page, request, baseURL }) => {
  test.setTimeout(90_000);
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password || !baseURL) throw new Error("Set SHIPPING_E2E_EMAIL and SHIPPING_E2E_PASSWORD to a local test account.");

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
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await page.getByRole("link", { name: "Upload documents", exact: true }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Message", { exact: true }).fill("Synthetic shipping note without an invoice reference.");
  await page.getByLabel("Attachments", { exact: true }).setInputFiles({
    name: filename, mimeType: "application/pdf", buffer: original,
  });
  await page.getByLabel("Attachment type").selectOption("draft_bl");
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  const caseUrl = page.url();
  const caseId = new URL(caseUrl).pathname.split("/").at(-1);
  const downloadLink = page.getByRole("region", { name: "Source viewer" })
    .getByRole("link", { name: `Download original ${filename}`, exact: true });
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
  }, { timeout: 35_000 }).toEqual(["needs_review", null, null]);
  await expect(page.getByRole("heading", { name: "Intake case", exact: true })).toBeVisible();

  // The manual draft endpoint remains available to API clients. The UI now links
  // the intake to its import instead of rendering a manual draft form.
  const created = await page.request.post("/api/v1/imports", {
    headers: { Origin: new URL(baseURL).origin },
    data: { intake_case_id: caseId, company: "Synthetic Shipping Co", invoice_no: invoice, supplier: "Synthetic Supplier" },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.reload();
  await page.getByRole("link", { name: "Linked import" }).click();
  await expect(page.getByRole("heading", { name: invoice })).toBeVisible();
  const draftUrl = page.url();
  await expect(page.getByText("Import draft · pending approval")).toBeVisible();
  await expect(page.getByRole("link", { name: `Download ${filename}` })).toBeVisible();
  const workspace = page.getByRole("navigation", { name: "Workspace" });
  await workspace.getByRole("link", { name: "Import records", exact: true }).click();
  const intakeRow = page.getByRole("row").filter({ hasText: subject });
  await expect(intakeRow.getByRole("link", { name: "Review draft" })).toHaveAttribute("href", `/review/${caseId}`);

  await workspace.getByRole("link", { name: "Automation runs", exact: true }).click();
  const healthResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/automation/health-check") && response.status() === 202);
  await page.getByRole("button", { name: "Run worker check" }).click();
  const healthId = (await (await healthResponse).json()).id;
  await expect.poll(async () => {
    const runs = await (await page.request.get("/api/v1/automation/runs")).json();
    return runs.find((run: { id: string }) => run.id === healthId)?.state;
  }, { timeout: 30_000 }).toBe("succeeded");
  await page.reload();
  const runLink = page.getByRole("link", { name: "Worker health check", exact: true }).and(page.locator(`a[href="/automation/${healthId}"]`));
  await expect(page.getByRole("row").filter({ has: runLink })).toContainText("Succeeded");
  await runLink.click();
  await expect(page.getByRole("heading", { name: "Run details" })).toBeVisible();

  await page.goto(draftUrl);
  await expect(page.getByRole("heading", { name: invoice })).toBeVisible();
  await page.getByLabel("Account menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  expect((await page.request.get(href)).status()).toBe(401);
  expect(consoleErrors).toEqual([]);
});
