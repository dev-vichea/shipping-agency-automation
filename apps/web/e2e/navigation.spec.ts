import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("staff manage a client company and navigate the responsive workspace", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();

  const nav = page.getByRole("navigation", { name: "Workspace" });
  const sidebar = page.locator("#desktop-sidebar");
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  const expand = page.getByRole("button", { name: "Expand sidebar" });
  await expect(expand).toHaveAttribute("aria-expanded", "false");
  await expect(sidebar).toHaveCSS("width", "66px");
  await nav.getByRole("link", { name: "Companies" }).hover();
  await expect(page.getByRole("tooltip")).toHaveText("Companies");
  await page.reload();
  await expect(expand).toBeVisible();
  await expand.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-expanded", "true");
  await expect(sidebar).toHaveCSS("width", "232px");
  await nav.getByRole("link", { name: "Companies" }).click();
  await page.getByRole("button", { name: "Add company" }).click();
  const name = `Fixture Factory ${randomUUID().slice(0, 8)}`;
  await page.getByLabel("Company name").fill(name);
  await page.getByLabel("Contact email").fill("factory@example.com");
  await page.getByRole("button", { name: "Create company" }).click();
  await expect(page.getByRole("heading", { name })).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").at(-1)!;
  await page.getByRole("button", { name: "Edit company" }).click();
  await page.getByLabel("Company identifier").fill("SYNTHETIC-QIP");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Company saved" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("SYNTHETIC-QIP")).toBeVisible();
  await page.getByRole("link", { name: "Intake & documents" }).click();
  const companyFilter = page.getByRole("combobox", { name: "Company filter" });
  await expect(companyFilter).toHaveText(name);
  await expect(page).toHaveURL(new RegExp(`/review\\?company_id=${id}$`));
  await companyFilter.click();
  await page.getByRole("option", { name: "All companies" }).click();
  await expect(companyFilter).toHaveText("All companies");
  await expect(page.getByRole("heading", { level: 1, name: "Intake cases" })).toBeVisible();

  for (const [link, title] of [
    ["Home", "Operations overview"], ["Inbox", "Inbox"], ["Import records", "Import records"],
    ["Approvals", "Approvals"], ["CDC Master Lists", "CDC Master Lists"], ["Automation runs", "Automation runs"],
    ["Reports", "Reports"], ["Integrations", "Integrations"], ["Settings", "Settings"],
  ] as const) {
    await nav.getByRole("link", { name: link, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  }
  await nav.getByRole("link", { name: "Home", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("dashboard-desktop.png") });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("dashboard-mobile.png") });
  const openNavigation = page.getByRole("button", { name: "Open navigation" });
  const drawer = page.getByRole("dialog", { name: "Navigation" });
  await openNavigation.click();
  await expect(drawer).toBeVisible();
  await page.screenshot({ animations: "disabled", path: test.info().outputPath("navigation-mobile.png") });
  await page.keyboard.press("Escape");
  await expect(drawer).toBeHidden();
  await expect(openNavigation).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNavigation.click();
  await expect(drawer).toHaveCSS("animation-name", "none");
  await drawer.getByRole("link", { name: "Inbox" }).click();
  await expect(drawer).toBeHidden();
  await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();
});
