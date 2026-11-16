import { expect, test, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const demo = process.env.SHIPPING_DEMO_URL;
const email = process.env.SHIPPING_E2E_EMAIL ?? "";
const password = process.env.SHIPPING_E2E_PASSWORD ?? "";

test.describe("Shipping Agency AI Demo", () => {
  test.skip(!demo || !email || !password, "Set the demo URL and synthetic staff credentials.");
  test.describe.configure({ timeout: 150_000 });

  async function signIn(page: Page) {
    await page.goto(demo!);
    await page.locator("#loginModalBtn").click();
    await page.locator("#loginEmail").fill(email);
    await page.locator("#loginPassword").fill(password);
    await page.locator("#loginSubmitBtn").click();
    await expect(page.locator("#staffStatus")).toHaveText(email);
  }

  test("refreshes a pending advisory after the intake enters staff review", async ({ page }) => {
    const caseId = "00000000-0000-4000-8000-000000000001";
    const detail = { id: caseId, subject: "Advisory polling test", state: "needs_review" };
    let analysisReads = 0;
    await page.route("**/api/v1/intakes?limit=40", (route) =>
      route.fulfill({ json: [{ ...detail, state: "queued" }] }));
    await page.route(`**/api/v1/intakes/${caseId}`, (route) =>
      route.fulfill({ json: detail }));
    await page.route(`**/api/v1/intakes/${caseId}/analysis`, (route) =>
      route.fulfill({ json: {
        revision: 1,
        state: "available",
        outcome: "NEEDS_REVIEW",
        ai_state: ++analysisReads === 1 ? "pending" : "ready",
      } }));
    await page.route(`**/api/v1/automation/runs?limit=40&intake_case_id=${caseId}`, (route) =>
      route.fulfill({ json: [{
        id: "00000000-0000-4000-8000-000000000002",
        stage: "ai",
        state: "succeeded",
        input_revision: 1,
        attempt: 1,
        created_at: "2026-11-15T04:23:44Z",
      }] }));

    await signIn(page);
    await page.locator("#caseSelect").selectOption(caseId);
    await page.locator('.wizard-step[data-step="2"]').click();
    await expect(page.locator("#aiStageStatus")).toHaveText("Ready");
    await expect(page.locator("#caseSelect option:checked")).toHaveText("Advisory polling test (needs_review)");
    await expect(page.locator("#investigationSummary")).toHaveText(
      "No package-count investigation was queued for this revision.",
    );
  });

  test("investigates a scanned package count and keeps staff review required", async ({ page }) => {
    await signIn(page);
    await page.locator("#btnLoadScan").click();
    await expect(page.locator("#stagedCountBadge")).toHaveText("2 / 5 files");
    await expect(page.locator(".file-preview-item")).toHaveCount(2);
    await page.locator("#submitIntakeBtn").click();

    await expect(page.locator("#step2View")).toBeVisible();
    const summary = page.locator("#investigationSummary");
    await expect(summary).toContainText("Evidence agrees. Staff review required.", {
      timeout: 120_000,
    });
    const steps = page.locator("#investigationSteps li");
    await expect(steps).toHaveCount(5);
    await expect(steps.nth(0)).toContainText("Packing list: 531 PKG");
    await expect(steps.nth(2)).toContainText("ocr pdf region · scan");
    await expect(steps.nth(3)).toContainText("531 PKG · page 1 · box");
    await expect(steps.nth(4)).toContainText("PASS");
    await page.locator("#btnToStep3").click();
    await expect(page.locator("#documentsSummaryGrid .doc-card")).toHaveCount(3);
  });

  test("keeps a genuine package-count mismatch visible", async ({ page }) => {
    await signIn(page);
    await page.locator("#btnLoadMismatch").click();
    await expect(page.locator("#stagedCountBadge")).toHaveText("2 / 5 files");
    await page.locator(".file-remove-btn").first().click();
    await expect(page.locator("#stagedCountBadge")).toHaveText("1 / 5 files");
    await page.locator("#btnLoadMismatch").click();
    await expect(page.locator("#stagedCountBadge")).toHaveText("2 / 5 files");
    await page.locator("#submitIntakeBtn").click();

    await expect(page.locator("#investigationSummary")).toContainText(
      "Source counts differ. Staff review required.",
      { timeout: 120_000 },
    );
    await expect(page.locator("#investigationSteps li").last()).toContainText("MISMATCH");
    await page.locator("#btnToStep3").click();
    await expect(page.locator("#documentsSummaryGrid")).toContainText("513");
    await expect(page.locator("#findingsTableBody")).toContainText("Bill of lading · packages");
  });

  test("loads every CDC page and leaves the mapping for staff to select", async ({ page }) => {
    await signIn(page);
    const origin = new URL(demo!).origin;
    const headers = { Origin: origin };
    const fixtureDir = process.env.SHIPPING_DEMO_FIXTURES ?? resolve("../../workflow_demo/.fixtures");
    const workbook = await readFile(resolve(fixtureDir, "cdc-paged.xlsx"));
    const checksum = createHash("sha256").update(workbook).digest("hex");
    const master = await page.request.post(`${origin}/api/v1/cdc/versions`, {
      headers,
      multipart: {
        company: "Harbor Demo Co., Ltd.",
        approval_ref: "DEMO-2026",
        year: "2026",
        verified: "true",
        file: {
          name: "cdc-paged.xlsx",
          mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          buffer: workbook,
        },
      },
    });
    let version;
    if (master.status() === 409) {
      // A prior run may have registered the identical fixture with a balance date.
      const versions = await page.request.get(`${origin}/api/v1/cdc/versions?limit=100`);
      expect(versions.ok(), await versions.text()).toBe(true);
      version = (await versions.json() as { id: string; sha256: string; year: number }[])
        .find((item) => item.sha256 === checksum && item.year === 2026);
      expect(version).toBeDefined();
    } else {
      expect(master.ok(), await master.text()).toBe(true);
      version = await master.json();
    }
    await page.locator("#btnLoadMismatch").click();
    await expect(page.locator("#stagedCountBadge")).toHaveText("2 / 5 files");
    const submit = page.waitForResponse((res) => res.url().endsWith("/intakes/simulate"));
    await page.locator("#submitIntakeBtn").click();
    const { case_id: caseId } = await (await submit).json();
    await expect(page.locator("#btnToStep3")).toBeEnabled();
    await page.locator('.wizard-step[data-step="4"]').click();
    await page.locator("#cdcVersionSelect").selectOption(version.id);
    await page.locator("#applyCdcBtn").click();
    await expect.poll(async () => {
      const res = await page.request.get(`${origin}/api/v1/intakes/${caseId}/analysis`);
      return (await res.json()).analyzed_master?.id;
    }, { timeout: 120_000 }).toBe(version.id);
    await page.locator("#refreshBtn").click();
    await expect(page.locator("#ctxRev")).toHaveText("2");
    const secondPage = page.waitForResponse((res) =>
      res.url().includes(`/cdc/versions/${version.id}/items?limit=100&offset=100`));
    await page.locator('.wizard-step[data-step="5"]').click();
    expect((await secondPage).status()).toBe(200);
    const mapping = page.locator(".cdc-row-select").first();
    await expect(mapping.locator("option", { hasText: "Synthetic item 121" })).toHaveCount(1);
    await expect(mapping).toHaveValue("");
    await expect(page.locator("#verifyCdcCheckbox")).not.toBeChecked();
    await expect(page.locator("#errorBanner")).toBeHidden();
    await page.locator("#saveReviewBtn").click();
    await expect(page.locator("#blockersList")).toContainText("transport.packages.packing_list");
    await expect(page.locator("#btnToStep6")).toBeDisabled();
  });
});
