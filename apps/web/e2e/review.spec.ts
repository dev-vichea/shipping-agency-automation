import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { CaseDetail, ImportDetail, ReviewAnalysis, ReviewWorkflow } from "../src/lib/contracts";

const fixture = (name: string) => resolve("../api/tests/fixtures", name);

test("staff can review an analyzed shipment and save a draft linked to the original documents", async ({ page, baseURL }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password || !baseURL) throw new Error("Configure the local E2E staff account.");
  const subject = `Sanitized document review ${randomUUID().slice(0, 8)}`;
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  const headers = { Origin: new URL(baseURL).origin };
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
  const reviewUrl = page.url();
  const caseId = new URL(reviewUrl).pathname.split("/").at(-1);
  const intakePath = `/api/v1/intakes/${caseId}`;
  const read = async (): Promise<ReviewAnalysis> => (await page.request.get(`${intakePath}/analysis`)).json();
  await expect.poll(async () => (await read()).state, { timeout: 25_000 }).toBe("available");
  const analysis = await read();
  expect(analysis.extractions.map(({ role }) => role).sort()).toEqual(["draft_bl", "invoice", "packing_list"]);
  expect(analysis.outcome).toBe("MISMATCH");
  const original: CaseDetail = await (await page.request.get(intakePath)).json();
  expect(original.import_id).toBeNull();
  expect(analysis.line_items).toEqual(expect.arrayContaining([
    expect.objectContaining({ invoice_row: 10, packing_row: 11, quantity_delta: "-2", delta_unit: "PCS", outcome: "MISMATCH" }),
  ]));
  await page.reload();
  const tabs = page.getByRole("navigation", { name: "Document intake tabs" });
  const goods = page.getByRole("region", { name: "Goods items" });
  const source = page.getByRole("region", { name: "Source viewer" });
  await tabs.getByRole("button", { name: /^Packing list(?:\s|$)/ }).click();
  await goods.getByRole("row").filter({ hasText: "Woven label" }).getByRole("button", { name: "10 PCS", exact: true }).click();
  await expect(source.getByLabel("Worksheet")).toHaveValue("PackingList");
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("10");
  await source.getByRole("button", { name: "Raw Excerpt" }).click();
  await expect(source.locator('[data-connector-target="true"]')).toContainText("10");
  await source.getByRole("button", { name: "Document Canvas" }).click();

  await tabs.getByRole("button", { name: /^B\/L(?:\s|$)/ }).click();
  const bill = source.getByRole("img", { name: "draft-bl-review.pdf, page 1" });
  await expect(bill).toBeVisible();
  await expect.poll(() => bill.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth > 0)).toBe(true);
  await expect(source.getByRole("link", { name: "Download original draft-bl-review.pdf", exact: true })).toBeVisible();
  const rotate = page.waitForResponse((response) => response.url().includes("/image?rotation=90") && response.ok());
  const controls = source.getByRole("group", { name: "Canvas controls" });
  await controls.getByRole("button", { name: "Rotate Page" }).click();
  await rotate;
  await controls.getByRole("button", { name: "Expand canvas" }).click();
  const collapse = page.getByRole("group", { name: "Canvas controls" }).getByRole("button", { name: "Collapse canvas" });
  await expect(collapse).toBeVisible();
  await collapse.click();
  await expect(controls.getByRole("button", { name: "Expand canvas" })).toBeVisible();

  await tabs.getByRole("button", { name: /^Invoice(?:\s|$)/ }).click();
  await page.getByText("Select CDC Master List", { exact: true }).click();
  await page.getByRole("button", { name: "Register a verified workbook", exact: true }).click();
  const registration = page.getByRole("dialog", { name: "Register Master List" });
  await registration.getByLabel("Master List workbook").setInputFiles(fixture("cdc-review.xlsx"));
  await registration.getByRole("button", { name: "Apply suggestions" }).click();
  await expect(registration.getByLabel("Company on approval")).toHaveValue("Harbor Demo Co., Ltd.");
  await expect(registration.getByLabel("Approval year")).toHaveValue("2026");
  await registration.getByRole("checkbox", { name: /I checked this workbook/ }).check();
  const registered = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/cdc/versions") && response.request().method() === "POST");
  await registration.getByRole("button", { name: "Register workbook" }).click();
  const registrationResponse = await registered;
  expect(registrationResponse.ok(), await registrationResponse.text()).toBe(true);
  const version = await registrationResponse.json();
  await expect(registration).toBeHidden();
  await page.getByLabel("CDC Master List version").selectOption(version.id);
  await page.getByRole("button", { name: "Apply version" }).click();
  await expect.poll(async () => {
    const result = await read();
    return [result.state, result.analyzed_master?.id];
  }, { timeout: 25_000 }).toEqual(["available", version.id]);
  const compared = await read();
  expect(compared.candidates).toEqual(expect.arrayContaining([
    expect.objectContaining({ description: expect.stringMatching(/Woven label/i) }),
  ]));
  await page.reload();
  await tabs.getByRole("button", { name: /^Invoice(?:\s|$)/ }).click();
  await page.getByText("Select CDC Master List", { exact: true }).click();
  await expect(page.getByRole("link", { name: "Download selected workbook" })).toHaveAttribute("href", `/api/v1/cdc/versions/${version.id}/download`);
  await expect(page.getByRole("button", { name: "Create Draft", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Approve", exact: true })).toHaveCount(0);

  await page.screenshot({ path: process.env.SHIPPING_REVIEW_SCREENSHOT ?? test.info().outputPath("review-center.png") });
  await page.getByRole("button", { name: /Audit & findings/ }).click();
  const audit = page.getByRole("dialog", { name: "Audit & Compliance" });
  expect(compared.trace_id).toBeTruthy();
  await expect(audit.getByText(compared.trace_id!, { exact: true })).toBeVisible();
  await audit.getByRole("button", { name: /^Passed/ }).click();
  await expect(audit.getByRole("row").filter({ hasText: /invoice subtotal.*pass/i }).first()).toBeVisible();
  await audit.getByRole("button", { name: /^Blockers/ }).click();
  const mismatch = audit.getByRole("row").filter({ hasText: /quantity.*mismatch/i }).first();
  await expect(mismatch).toBeVisible();
  await expect(audit.getByRole("button", { name: /^Blockers/ })).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: process.env.SHIPPING_AUDIT_SCREENSHOT ?? test.info().outputPath("review-audit.png") });
  await mismatch.getByRole("button", { name: /supplier-review.xlsx · invoice · D10/i }).click();
  await expect(audit).toBeHidden();
  await expect(source.locator('td[data-connector-target="true"]')).toHaveText("12");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(source).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

  const search = page.getByRole("searchbox", { name: "Search shipments" });
  await search.fill("DEMOBL0001");
  await search.press("Enter");
  await expect(page).toHaveURL(/\/review\?q=DEMOBL0001/);
  const reviewRow = page.getByRole("row").filter({ hasText: subject });
  await expect(reviewRow).toHaveCount(1);
  await expect(reviewRow.getByText("Mismatch", { exact: true })).not.toHaveCount(0);
  await page.getByRole("searchbox", { name: "Search intakes" }).fill(subject);
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  const statuses = page.getByRole("navigation", { name: "Queue status filter tabs" });
  await statuses.getByRole("link", { name: "Review", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: subject })).toHaveCount(1);
  await statuses.getByRole("link", { name: "Approved", exact: true }).click();
  await expect(page.getByText("No cases match these filters.")).toBeVisible();

  await page.goto(`/cdc?version=${version.id}`);
  await page.getByRole("searchbox", { name: "Find workbook rows" }).fill("woven");
  await page.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: "Woven label" })).toHaveCount(1);
  await page.getByRole("link", { name: "Woven label" }).click();
  await expect(page).toHaveURL(/&row=3$/);
  await expect(page.getByRole("heading", { name: "Workbook details" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download workbook" })).toBeVisible();

  await page.goto(reviewUrl);
  await page.getByRole("button", { name: "Create Draft", exact: true }).click();
  await expect(page.getByRole("region", { name: "Verification document editor" })).toBeVisible();
  const workflow: ReviewWorkflow = await (await page.request.get(`${intakePath}/review`)).json();
  expect(workflow.review).toMatchObject({ ready: false });
  expect((await (await page.request.get(intakePath)).json()).import_id).toBeNull();

  const reference = `FLOW-${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/imports", {
    headers, data: { intake_case_id: caseId, company: "Harbor Demo Co., Ltd.", invoice_no: reference },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.reload();
  await page.getByRole("link", { name: "Linked import" }).click();
  await expect(page.getByRole("heading", { name: reference, exact: true })).toBeVisible();
  const importId = new URL(page.url()).pathname.split("/").at(-1);
  const response = await page.request.get(`/api/v1/imports/${importId}`);
  expect(response.ok()).toBe(true);
  const draft: ImportDetail = await response.json();
  expect(draft).toMatchObject({ id: importId, intake_case_id: caseId, state: "draft" });
  expect(draft.documents.map(({ id }) => id).sort()).toEqual(original.documents.map(({ id }) => id).sort());
  const overview = page.getByRole("heading", { name: "Overview", exact: true });
  const attachments = page.getByRole("heading", { name: "Original attachments", exact: true });
  const attachmentCard = page.locator("section").filter({ has: attachments });
  await expect(attachmentCard.getByRole("link")).toHaveCount(draft.documents.length);
  expect((await attachments.boundingBox())!.x).toBe((await overview.boundingBox())!.x);
  expect((await attachments.boundingBox())!.y).toBeGreaterThan((await overview.boundingBox())!.y);
  await page.setViewportSize({ width: 1440, height: 1000 });
  expect((await attachments.boundingBox())!.x).toBeGreaterThan((await overview.boundingBox())!.x);
  expect((await attachments.boundingBox())!.y).toBe((await overview.boundingBox())!.y);
  for (const doc of draft.documents) {
    const file = attachmentCard.getByRole("link", { name: `Download ${doc.original_filename}`, exact: true });
    await expect(file).toHaveText(doc.original_filename);
    await expect(file.locator("svg").first()).toBeVisible();
    const [downloaded] = await Promise.all([page.waitForEvent("download"), file.click()]);
    expect(downloaded.suggestedFilename()).toBe(doc.original_filename);
    expect(await readFile((await downloaded.path())!)).toEqual(await readFile(fixture(doc.original_filename)));
  }
  expect((await read()).outcome).toBe("MISMATCH");
  await expect(page.getByText("Import draft · pending approval")).toBeVisible();
});
