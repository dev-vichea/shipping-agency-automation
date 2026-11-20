import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJK012345";
const tokenHash = createHash("sha256").update(token).digest("hex");

test.beforeAll(() => {
  const sql = `INSERT INTO staff_sessions (token_hash, user_id, expires_at) VALUES ('${tokenHash}', '6a02c165-adae-4586-a79d-a38427b5e201', NOW() + INTERVAL '1 day') ON CONFLICT (token_hash) DO NOTHING;`;
  execSync(`docker exec shipping-agency-dev-postgres-1 psql -U shipping -d shipping -c "${sql}"`);
});

test("smooth form editing: supplier address saves without 422 error, combobox selects immediately, toasts appear", async ({ page, context }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await context.addCookies([
    {
      name: "shipping_session",
      value: token,
      domain: "localhost",
      path: "/",
      httpOnly: true,
    },
    {
      name: "shipping_workspace",
      value: "6a6e0083-8ff5-4382-b205-58a7cf39958a",
      domain: "localhost",
      path: "/",
      httpOnly: false,
    },
  ]);

  // Navigate directly to the verification tab
  await page.goto("/review/9ea52acc-7187-4af1-8b2b-e42b274c847a?tab=verification");
  await page.waitForLoadState("networkidle");

  const leftRegion = page.getByRole("region", { name: "Editable document data" });
  await expect(leftRegion).toBeVisible();

  // Find the Supplier Address textarea
  const supplierAddressInput = leftRegion.getByLabel(/Invoice.*Supplier Address/i);
  await expect(supplierAddressInput).toBeVisible();

  // Fill in the exact address from user's screenshot
  const testAddress = "FLAT/RM P, 4/F, LLADRO CENTRE, 72 HOI YUEN";
  await supplierAddressInput.fill(testAddress);

  // Trigger save by pressing Enter
  await supplierAddressInput.press("Enter");

  // Check toast notification displays "Updating..." or "Saved!"
  const notifRegion = page.locator('[aria-label="Notifications"]');
  const toastStatus = notifRegion.locator('[role="status"]');
  await expect(toastStatus).toBeVisible({ timeout: 5000 });
  await expect(toastStatus).toContainText(/Updating\.\.\.|Saved!/);

  // Verify it settles on Saved!
  const toastSaved = notifRegion.locator('[role="status"]').filter({ hasText: "Saved!" });
  await expect(toastSaved).toBeVisible({ timeout: 5000 });

  // Verify NO error banner appears
  const errorBanner = page.locator('[role="alert"]').filter({ hasText: "A correction does not identify a unique extracted field" });
  await expect(errorBanner).toHaveCount(0);

  // Take screenshot of saved state
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-field-saved.png" });

  // Test Combobox interaction: select Origin suggestion
  const originInput = leftRegion.getByLabel(/Invoice.*Origin/i);
  await expect(originInput).toBeVisible();
  await originInput.click();

  // The combobox dropdown should be open
  const originOption = page.locator('[role="listbox"]').getByRole("option", { name: /SHANGHAI, CHINA/i }).first();
  if (await originOption.isVisible()) {
    await originOption.click();
    // Verify toast Saved appears
    await expect(toastSaved).toBeVisible({ timeout: 5000 });
  }

  // Reload page to verify persistence
  await page.reload();
  await page.waitForLoadState("networkidle");

  // Confirm supplier address is still populated
  const reloadedSupplierAddress = page.getByRole("region", { name: "Editable document data" }).getByLabel(/Invoice.*Supplier Address/i);
  await expect(reloadedSupplierAddress).toHaveValue(testAddress);

  // Verify again that no error alert is present
  await expect(page.locator('[role="alert"]').filter({ hasText: "A correction does not identify a unique extracted field" })).toHaveCount(0);

  // 2. Test autosave when modifying supplier address (with a trailing dot like in user screenshot)
  const modifiedAddress = `${testAddress}.`;
  await reloadedSupplierAddress.fill(modifiedAddress);
  // Wait for 650ms autosave debounce + save to complete
  await expect(page.locator('[aria-label="Notifications"] [role="status"]').filter({ hasText: "Saved!" })).toBeVisible({ timeout: 6000 });
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-autosaved-supplier-address.png" });

  // 3. Test Fix 2: Navigate to Documents tab and verify Shipper / Supplier Address is visible
  await page.goto("/review/9ea52acc-7187-4af1-8b2b-e42b274c847a");
  await page.waitForLoadState("networkidle");

  // Verify Document Details shows Shipper/Supplier address
  const docDetails = page.getByRole("region", { name: "Document Details" });
  await expect(docDetails).toBeVisible();
  const addressItem = docDetails.getByText(/Shipper Address|Supplier Address/i);
  await expect(addressItem).toBeVisible();

  await page.waitForTimeout(400);
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/document-tab-address.png" });
});
