import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import type { ReviewAnalysis, ReviewWorkflow } from "../src/lib/contracts";

test("review suggestions stay pending until a staff decision and preserve unresolved CDC checks", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure a synthetic local E2E staff account.");
  const errors: string[] = [];
  await page.context().setExtraHTTPHeaders({ Origin: process.env.SHIPPING_E2E_URL ?? "http://localhost:3000" });
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login/);
  const data = new FormData();
  data.set("provider_message_id", `suggestions-${randomUUID()}`);
  for (const name of ["supplier-review.xlsx", "draft-bl-review.pdf"]) {
    data.append("files", new File([new Uint8Array(await readFile(resolve("../api/tests/fixtures", name)))], name));
  }
  const received = await page.request.post("/api/v1/intakes/simulate", { multipart: data });
  expect(received.ok()).toBeTruthy();
  const caseId = (await received.json()).case_id;
  const path = `/api/v1/intakes/${caseId}`;
  const readAnalysis = async (): Promise<ReviewAnalysis> => (await page.request.get(`${path}/analysis`)).json();
  const readReview = async (): Promise<ReviewWorkflow> => (await page.request.get(`${path}/review`)).json();
  await expect.poll(async () => (await readAnalysis()).state, { timeout: 30_000 }).toBe("available");
  const registered = await page.request.post("/api/v1/cdc/versions", { multipart: {
    company: "Harbor Demo Co., Ltd.", year: "2026", approval_ref: "DEMO-2026", verified: "true",
    file: { name: "cdc-review.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: await readFile(resolve("../api/tests/fixtures/cdc-review.xlsx")) },
  } });
  expect(registered.ok()).toBeTruthy();
  const version = await registered.json();
  const selected = await page.request.post(`${path}/cdc-version`, { data: { expected_revision: (await readAnalysis()).revision, version_id: version.id } });
  expect(selected.ok()).toBeTruthy();
  await expect.poll(async () => (await readAnalysis()).state, { timeout: 30_000 }).toBe("available");
  await page.goto(`/review/${caseId}`);
  await page.getByRole("button", { name: /^Review \(/ }).click();
  const dialog = page.getByRole("dialog", { name: "Review Warnings" });
  await expect(dialog.getByRole("tab", { name: /Document Fields/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Confirm all passing document checks" })).toBeDisabled();
  await dialog.getByRole("checkbox", { name: "AI Auto-Suggestion with CDC Rules" }).uncheck();
  await dialog.getByRole("checkbox", { name: "AI Auto-Suggestion with CDC Rules" }).check();
  expect((await readReview()).review).toBeNull();
  const weight = dialog.getByRole("article", { name: "Gross Weight finding", exact: true }).first();
  const source = weight.getByLabel(/Source value to use/);
  const choices = await source.locator("option").evaluateAll((options) => options.map((option) => ({ value: (option as HTMLOptionElement).value, label: option.textContent ?? "" })));
  const invoiceChoice = choices.find((option) => option.label.includes("· invoice ·"));
  expect(invoiceChoice).toBeTruthy();
  await source.selectOption(invoiceChoice!.value);
  await weight.getByLabel("Decision reason").fill("Checked invoice and packing weights against original cells.");
  await weight.getByRole("button", { name: "Approve selection" }).click();
  await expect.poll(async () => (await readReview()).review?.finding_decisions?.length).toBe(1);
  const documentReview = (await readReview()).review?.id;
  await dialog.getByRole("tab", { name: /CDC Items/ }).click();
  const row = dialog.getByRole("article", { name: "CDC invoice row 10" });
  await row.getByLabel("CDC material candidate").selectOption("3");
  await expect(row.getByText(/CDC evidence/)).toBeVisible();
  expect((await readReview()).review?.id).toBe(documentReview);
  await row.getByLabel("Decision reason").fill("Checked material in CDC original; unit and balance remain unresolved.");
  await row.getByRole("button", { name: "Approve selection" }).click();
  await expect.poll(async () => (await readReview()).review?.finding_decisions?.find((entry) => entry.key === "cdc.row.10.mapping")?.action).toBe("approved");
  const workflow = await readReview();
  expect(workflow.review?.cdc_ready).toBe(false);
  expect(workflow.review?.permit_pending).toBeTruthy();
  expect(workflow.finding_audit?.[0].stale).toBe(false);
  await expect(dialog.getByText("CDC checks remain unresolved")).toBeVisible();
  await page.screenshot({ path: test.info().outputPath("cdc-suggestion-review.png"), fullPage: true });
  await page.reload();
  await page.getByRole("button", { name: /^Review \(/ }).click();
  await page.getByRole("tab", { name: /CDC Items/ }).click();
  await expect(page.getByRole("article", { name: "CDC invoice row 10" }).getByRole("status")).toContainText("approved");
  expect(errors).toEqual([]);
});
