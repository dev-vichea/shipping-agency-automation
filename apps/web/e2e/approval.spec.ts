import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { CaseDetail, ImportDetail, MasterVersion, PermitDraft, ReviewAnalysis, ReviewWorkflow, StaffReview } from "../src/lib/contracts";

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
  const headers = { Origin: origin };
  const workspace = await page.request.post("/api/v1/workspaces", { headers, data: { name: subject } });
  expect(workspace.ok()).toBe(true);
  await page.goto("/home");
  await page.getByRole("link", { name: "Upload documents", exact: true }).click();
  await page.getByLabel("Subject").fill(subject);
  await page.getByLabel("Attachments", { exact: true }).setInputFiles([
    fixture("supplier-review.xlsx"), fixture("draft-bl-review.pdf"),
  ]);
  await page.getByRole("button", { name: "Upload and process" }).click();
  await expect(page).toHaveURL(/\/review\/[0-9a-f-]{36}$/);
  const caseId = new URL(page.url()).pathname.split("/").at(-1);
  const path = `/api/v1/intakes/${caseId}`;
  const read = async (): Promise<ReviewAnalysis> => (await page.request.get(`${path}/analysis`)).json();
  await expect.poll(async () => (await read()).state, { timeout: 45_000 }).toBe("available");
  const workbook = await readFile(fixture("cdc-approval.xlsx"));
  const master = await page.request.post("/api/v1/cdc/versions", {
    headers,
    multipart: {
      company: "Harbor Demo Co., Ltd.", approval_ref: "DEMO-2026", year: "2026", verified: "true",
      balance_as_of: new Date().toISOString().slice(0, 10),
      file: { name: "cdc-approval.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        buffer: workbook },
    },
  });
  let version: MasterVersion;
  if (master.status() === 409) {
    const versions: (MasterVersion & { sha256: string })[] = await (await page.request.get("/api/v1/cdc/versions?limit=100")).json();
    const checksum = createHash("sha256").update(workbook).digest("hex");
    const match = versions.find((entry) => entry.sha256 === checksum);
    if (!match) throw new Error(await master.text());
    version = match;
  } else {
    expect(master.ok(), await master.text()).toBe(true);
    version = await master.json();
  }
  const initial = await read();
  expect((await page.request.post(`${path}/cdc-version`, { headers,
    data: { version_id: version.id, expected_revision: initial.revision },
  })).ok()).toBe(true);
  await expect.poll(async () => (await read()).analyzed_master?.id, { timeout: 45_000 }).toBe(version.id);
  await page.getByRole("button", { name: "Refresh" }).click();
  const source = page.getByRole("region", { name: "Source viewer" });
  const tabs = page.getByRole("navigation", { name: "Document intake tabs" });
  const approve = page.getByRole("button", { name: "Approve", exact: true });
  const processed = page.getByRole("button", { name: "Add to Processed" });
  const updated = () => page.waitForResponse((response) =>
    response.url().endsWith(`${path}/review`) && response.request().method() === "POST");

  await expect(approve).toHaveCount(0);
  await expect(processed).toHaveCount(0);
  const premature = await page.request.post(`${path}/approve`, {
    headers, data: { expected_revision: (await read()).revision, review_id: null, notes: "Attempt before reviewing the discrepancy." },
  });
  expect(premature.status()).toBe(409);
  const original: CaseDetail = await (await page.request.get(path)).json();
  expect(original.import_id).toBeNull();

  await tabs.getByRole("button", { name: /^Packing list(?:\s|$)/ }).click();
  const goods = page.getByRole("region", { name: "Goods items" });
  await goods.getByRole("button", { name: "10 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("PackingList");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("10");
  await goods.getByRole("switch", { name: "Toggle auto save" }).click();
  const quantity = goods.getByPlaceholder("Enter row 11: quantity…", { exact: true });
  await quantity.fill("12");
  const firstSave = updated();
  await goods.getByRole("button", { name: "Save", exact: true }).click();
  expect(((await (await firstSave).json()) as StaffReview).ready).toBe(false);
  await expect(goods.getByRole("button", { name: "12 PCS", exact: true }).locator("[data-field-status=present]")).toBeVisible();

  const undone = updated();
  await goods.getByRole("button", { name: "Reset", exact: true }).click();
  expect(((await (await undone).json()) as StaffReview).changes).toHaveLength(0);
  await expect(goods.getByRole("button", { name: "10 PCS", exact: true })).toBeVisible();
  await quantity.fill("12");
  const secondSave = updated();
  await goods.getByRole("button", { name: "Save", exact: true }).click();
  expect((await secondSave).ok()).toBe(true);
  await expect(goods.getByRole("button", { name: "12 PCS", exact: true })).toBeVisible();

  await goods.getByRole("row").filter({ hasText: "Woven label" }).getByRole("button", { name: /^2\.75(?:\s|$)/ }).click();
  const price = goods.getByPlaceholder("Enter row 11: unit price…", { exact: true });
  await price.fill("2.50");
  await goods.getByRole("textbox", { name: "Currency (e.g. USD)", exact: true }).fill("USD");
  const priceBeforeSave: ReviewWorkflow = await (await page.request.get(`${path}/review`)).json();
  expect(priceBeforeSave.review?.corrections.some(({ name }) => name === "unit_price")).toBe(false);
  const priceSave = updated();
  await goods.getByRole("button", { name: "Save", exact: true }).click();
  expect((await priceSave).ok()).toBe(true);

  await tabs.getByRole("button", { name: /^B\/L(?:\s|$)/ }).click();
  const details = page.getByRole("region", { name: "Container & Cargo" });
  const weightRow = details.getByRole("button", { name: /^Gross Weight/ });
  await expect(weightRow.locator("[data-field-status=problem]")).toBeVisible();
  await weightRow.click();
  await expect(source.getByRole("img", { name: "Source citation bounding box" })).toBeVisible();
  await details.getByPlaceholder("1000", { exact: true }).fill("24");
  const weightSave = updated();
  await details.getByRole("button", { name: "Save", exact: true }).click();
  expect((await weightSave).ok()).toBe(true);
  await expect(weightRow.locator("[data-field-status=present]")).toBeVisible();
  await page.reload();
  await expect(weightRow).toHaveAccessibleName("Gross Weight 24 KG");
  await expect(weightRow.locator("[data-field-status=present]")).toBeVisible();

  await page.getByRole("button", { name: /Audit & findings/ }).click();
  const audit = page.getByRole("dialog", { name: "Audit & Compliance" });
  await audit.getByText("Resolve with note", { exact: true }).click();
  for (let pending = 2; pending > 0; pending -= 1) {
    const note = audit.getByLabel(/Packages.*Numeric units are missing or incompatible/).first();
    await note.fill("Checked the package count in both documents. The spreadsheet header has no printed unit.");
    const response = updated();
    await note.locator("xpath=ancestor::form").getByRole("button", { name: "Save resolution" }).click();
    expect((await response).ok()).toBe(true);
    await expect(audit.getByLabel(/Packages.*Numeric units are missing or incompatible/)).toHaveCount(pending - 1);
  }
  await audit.getByRole("button", { name: "Close audit drawer" }).click();

  await tabs.getByRole("button", { name: /^Invoice(?:\s|$)/ }).click();
  await page.getByText("Verify CDC candidates", { exact: true }).click();
  await page.getByLabel("CDC match for invoice row 10").selectOption("3");
  await page.getByLabel("I verified the selected CDC items.").check();
  const ready = updated();
  await page.getByRole("button", { name: "Save CDC matches" }).click();
  const review: StaffReview = await (await ready).json();
  expect(review.blockers).toEqual([]);
  await page.getByRole("button", { name: /^Verification/ }).click();
  await expect(approve).toBeEnabled();

  const confirmation = page.waitForResponse((response) => response.url().endsWith(`${path}/approve`));
  await approve.click();
  const approved = await confirmation;
  expect(approved.ok(), await approved.text()).toBe(true);
  const approval = await approved.json();
  await expect(page).toHaveURL(/\/review\//);
  await processed.click();
  await expect(page.getByText("Processed", { exact: true })).toBeVisible();
  await page.getByRole("link", { name: "Linked import" }).click();
  await expect(page).toHaveURL(new RegExp(`/imports/${approval.import_id}$`));
  await expect(page.getByRole("heading", { name: "INV-FIXTURE-101", level: 1, exact: true })).toBeVisible();
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
    headers, data: { expected_revision: (await read()).revision, review_id: review.id, notes: "Approved after staff review." },
  });
  expect(await repeated.json()).toEqual(approval);
  await page.goto("/reports");
  await expect(page.locator(`a[href="/imports/${approval.import_id}"]`)).toBeVisible();
  const exportFile = page.waitForEvent("download");
  await page.getByRole("link", { name: "Download Excel report" }).click();
  expect((await exportFile).suggestedFilename()).toBe("approved-imports.xlsx");
});
