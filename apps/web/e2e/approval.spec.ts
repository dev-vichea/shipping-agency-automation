import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ImportDetail, PermitDraft, ReviewAnalysis, StaffReview } from "../src/lib/contracts";

const fixture = (name: string) => resolve("../api/tests/fixtures", name);
const origin = process.env.SHIPPING_E2E_URL ?? "http://localhost:3000";

test("staff corrects a discrepancy and approves one import with a permit and report", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");
  const subject = `Phase 3 approval ${randomUUID().slice(0, 8)}`;
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await page.getByRole("link", { name: "Upload documents", exact: true }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Attachments", { exact: true }).setInputFiles([
    fixture("supplier-review.xlsx"), fixture("draft-bl-review.pdf"),
  ]);
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  const caseId = new URL(page.url()).pathname.split("/").at(-1);
  const path = `/api/v1/intakes/${caseId}`;
  const headers = { Origin: origin };
  const read = async (): Promise<ReviewAnalysis> => (await page.request.get(`${path}/analysis`)).json();
  await expect.poll(async () => (await read()).state, { timeout: 45_000 }).toBe("available");
  const master = await page.request.post("/api/v1/cdc/versions", {
    headers,
    multipart: {
      company: "Harbor Demo Co., Ltd.", approval_ref: "DEMO-2026", year: "2026", verified: "true",
      balance_as_of: new Date().toISOString().slice(0, 10),
      file: { name: "cdc-approval.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: await readFile(fixture("cdc-approval.xlsx")) },
    },
  });
  expect(master.ok()).toBe(true);
  const version = await master.json();
  const initial = await read();
  expect((await page.request.post(`${path}/cdc-version`, { headers,
    data: { version_id: version.id, expected_revision: initial.revision },
  })).ok()).toBe(true);
  await expect.poll(async () => (await read()).analyzed_master?.id, { timeout: 45_000 }).toBe(version.id);
  await page.getByRole("button", { name: "Refresh" }).click();
  await page.getByRole("button", { name: "Staff review" }).click();
  const blocked = page.waitForResponse((response) => response.url().endsWith(`${path}/review`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save review" }).click();
  expect(((await (await blocked).json()) as StaffReview).ready).toBe(false);
  await expect(page.getByText(/invoice_packing\.quantity\.10\.11/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve intake" })).toHaveCount(0);

  for (const [field, value] of [
    ["Packing list · Row 11 · Quantity", "12"],
    ["Packing list · Row 11 · Unit price", "2.50"],
    ["Draft B/L · Header · Gross weight", "24"],
  ]) {
    await page.getByLabel("Field to correct").selectOption({ label: field });
    await page.getByRole("textbox", { name: "Reviewed value", exact: true }).fill(value);
    await page.getByLabel("Correction reason").fill("Confirmed against the synthetic corrected source.");
    await page.getByRole("button", { name: "Apply field correction" }).click();
  }
  await page.getByLabel("CDC match for invoice row 10").selectOption("3");
  await page.getByLabel(/I verified the selected CDC items/).check();
  const ready = page.waitForResponse((response) => response.url().endsWith(`${path}/review`) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save review" }).click();
  const review: StaffReview = await (await ready).json();
  expect(review.blockers).toEqual([]);
  await expect(page.getByRole("button", { name: "Approve intake", exact: true })).toBeEnabled();
  await page.getByLabel("Approval note").fill("Approved synthetic Phase 3 verification.");
  const confirmation = page.waitForResponse((response) => response.url().endsWith(`${path}/approve`));
  await page.getByRole("button", { name: "Approve intake" }).click();
  const approval = await (await confirmation).json();
  await expect(page.getByRole("heading", { name: "INV-FIXTURE-101" })).toBeVisible();
  const recordPath = `/api/v1/imports/${approval.import_id}`;
  const record: ImportDetail = await (await page.request.get(recordPath)).json();
  expect(record.state).toBe("approved");
  expect(record.etd_status).toBe("pending");
  const drafts: PermitDraft[] = await (await page.request.get(`${recordPath}/permit-drafts`)).json();
  expect(drafts).toHaveLength(1);
  expect(drafts[0].recipient).toBeNull();
  const permit = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download permit draft" }).click();
  expect((await permit).suggestedFilename()).toMatch(/^permit-draft-.*\.xlsx$/);
  const repeated = await page.request.post(`${path}/approve`, {
    headers, data: { expected_revision: (await read()).revision, review_id: review.id, notes: "Approved synthetic Phase 3 verification." },
  });
  expect(await repeated.json()).toEqual(approval);
  await page.goto("/reports");
  await expect(page.locator(`a[href="/imports/${approval.import_id}"]`)).toBeVisible();
  const exportFile = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel report" }).click();
  expect((await exportFile).suggestedFilename()).toBe("approved-imports.xlsx");
});
