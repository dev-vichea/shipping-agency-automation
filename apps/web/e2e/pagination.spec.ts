import { expect, test } from "@playwright/test";

test("company pagination keeps filters and stops at the last full page", async ({ page, baseURL }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password || !baseURL) throw new Error("Configure the local E2E staff account.");
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  const headers = { Origin: new URL(baseURL).origin };
  expect((await page.request.post("/api/v1/workspaces", { headers, data: { name: "Pagination test" } })).ok()).toBe(true);
  for (let batch = 0; batch < 6; batch += 1) {
    const names = Array.from({ length: 10 }, (_, index) => `Page Factory ${String(batch * 10 + index + 1).padStart(2, "0")}`);
    const responses = await Promise.all(names.map((name) => page.request.post("/api/v1/companies", { headers, data: { name } })));
    expect(responses.every((response) => response.ok())).toBe(true);
  }
  expect((await page.request.post("/api/v1/companies", { headers, data: { name: "Other client" } })).ok()).toBe(true);

  await page.goto("/companies?q=Page+Factory&sort=name");
  const pager = page.getByRole("navigation", { name: "Pagination", exact: true });
  const table = page.getByRole("table");
  const rows = table.getByRole("row");
  await expect(rows).toHaveCount(31);
  await expect(table.getByRole("link", { name: "Page Factory 01", exact: true })).toBeVisible();
  await expect(pager.getByRole("button", { name: "Previous" })).toBeDisabled();
  await expect(pager.getByText("1–30", { exact: true })).toBeVisible();
  await pager.getByRole("link", { name: "Next" }).click();
  await expect(page).toHaveURL(/q=Page\+Factory&sort=name&offset=30$/);
  await expect(rows).toHaveCount(31);
  await expect(table.getByRole("link", { name: "Page Factory 31", exact: true })).toBeVisible();
  await expect(table.getByRole("link", { name: "Page Factory 60", exact: true })).toBeVisible();
  await expect(pager.getByText("31–60", { exact: true })).toBeVisible();
  await expect(pager.getByRole("button", { name: "Next" })).toBeDisabled();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect(pager.getByRole("link", { name: "Previous" })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);
  await pager.getByRole("link", { name: "Previous" }).click();
  await expect(table.getByRole("link", { name: "Page Factory 01", exact: true })).toBeVisible();

  await page.goto("/companies?q=Page+Factory+60&sort=name");
  await expect(rows).toHaveCount(2);
  await expect(pager).toHaveCount(0);
  await page.goto("/companies?q=Page+Factory&offset=60&sort=name");
  await expect(page.getByText("No companies on this page.")).toBeVisible();
  await pager.getByRole("link", { name: "Previous" }).click();
  await expect(rows).toHaveCount(31);
  await page.getByRole("searchbox", { name: "Search companies" }).fill("Other client");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).not.toHaveURL(/offset=/);
  await expect(rows).toHaveCount(2);
  await expect(pager).toHaveCount(0);
});
