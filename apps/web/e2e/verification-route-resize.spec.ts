import { test, expect } from "@playwright/test";
import { execSync } from "node:child_process";
import { createHash } from "node:crypto";

const token = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJK012345";
const tokenHash = createHash("sha256").update(token).digest("hex");

test.beforeAll(() => {
  const sql = `INSERT INTO staff_sessions (token_hash, user_id, expires_at) VALUES ('${tokenHash}', '6a02c165-adae-4586-a79d-a38427b5e201', NOW() + INTERVAL '1 day') ON CONFLICT (token_hash) DO NOTHING;`;
  execSync(`docker exec shipping-agency-dev-postgres-1 psql -U shipping -d shipping -c "${sql}"`);
});

test("verification tab route persists across refresh and table column resize saves with toast", async ({ page, context }) => {
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

  // 1. Navigate to review case (Documents tab by default)
  await page.goto("/review/9ea52acc-7187-4af1-8b2b-e42b274c847a");
  await page.waitForLoadState("networkidle");
  const breadcrumb = page.getByRole("navigation", { name: "breadcrumb", exact: true });
  await expect(breadcrumb).toContainText("Document review");

  // 2. Click Verification tab
  const verifTabButton = page.getByRole("button", { name: /^Verification/ });
  await expect(verifTabButton).toBeVisible();
  await verifTabButton.click();
  await expect(page).toHaveURL(/tab=verification/);
  await expect(breadcrumb).toContainText("Document verification");

  // 3. Refresh page and verify it remains on Verification tab and breadcrumb stays "Document verification"
  await page.reload();
  await page.waitForLoadState("networkidle");
  const verifAfterReload = page.getByRole("button", { name: /^Verification/ });
  await expect(verifAfterReload).toHaveAttribute("aria-pressed", "true");
  await expect(breadcrumb).toContainText("Document verification");
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-tab-reloaded.png" });

  // 4. Line items table resize
  const tableRegion = page.getByLabel("Editable line items");
  await expect(tableRegion).toBeVisible();

  const descHead = tableRegion.locator("th").filter({ hasText: /Description/i });
  await expect(descHead).toBeVisible();
  await descHead.scrollIntoViewIfNeeded();
  const initialWidth = (await descHead.boundingBox())!.width;

  const separator = descHead.locator('[role="separator"]');
  await expect(separator).toBeVisible();
  const sepBox = (await separator.boundingBox())!;
  console.log("sepBox:", sepBox, "initialWidth:", initialWidth);

  page.on("console", (msg) => console.log("BROWSER CONSOLE:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.error("BROWSER PAGEERROR:", err));

  await separator.dispatchEvent("pointerdown", {
    clientX: sepBox.x + sepBox.width / 2,
    clientY: sepBox.y + sepBox.height / 2,
    button: 0,
    pointerId: 1,
    pointerType: "mouse",
  });

  // Give React a tick to mount window event listeners
  await page.waitForTimeout(100);

  const targetX = sepBox.x + 100;
  await page.evaluate((x) => {
    window.dispatchEvent(new PointerEvent("pointermove", {
      clientX: x,
      clientY: 300,
      pointerId: 1,
      pointerType: "mouse",
    }));
    window.dispatchEvent(new PointerEvent("pointerup", {
      clientX: x,
      clientY: 300,
      pointerId: 1,
      pointerType: "mouse",
    }));
  }, targetX);

  // 5. Check toast "Saved!" in Notifications region is displayed
  const toastSaved = page.locator('[aria-label="Notifications"] [role="status"]').filter({ hasText: "Saved!" });
  await expect(toastSaved).toBeVisible();
  // Wait for 360ms slide-in animation to settle
  await page.waitForTimeout(400);
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-col-resized-toast.png" });

  const resizedWidth = (await descHead.boundingBox())!.width;
  expect(resizedWidth).toBeGreaterThan(initialWidth);

  // 6. Reload page and verify customized column width persisted from localStorage
  await page.reload();
  await page.waitForLoadState("networkidle");
  const descHeadAfterReload = page.getByLabel("Editable line items").locator("th").filter({ hasText: /Description/i });
  const persistedWidth = (await descHeadAfterReload.boundingBox())!.width;
  expect(persistedWidth).toBeCloseTo(resizedWidth, -1);
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-col-persisted-after-refresh.png" });

  // 7. Direct /verification route
  await page.goto("/review/9ea52acc-7187-4af1-8b2b-e42b274c847a/verification");
  await page.waitForLoadState("networkidle");
  const directVerif = page.getByRole("button", { name: /^Verification/ });
  await expect(directVerif).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("navigation", { name: "breadcrumb", exact: true })).toContainText("Document verification");
  await page.screenshot({ path: "/Users/kiddd/.gemini/antigravity/brain/ba1917ea-7e41-4517-926c-2a19e1584dd1/verification-direct-route.png" });
});
