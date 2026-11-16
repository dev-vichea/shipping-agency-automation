import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const origin = process.env.SHIPPING_E2E_URL ?? "http://localhost:3000";

test("staff fills CDC registration from workbook evidence and confirms it explicitly", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");
  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();
  const headers = { Origin: origin };
  expect((await page.request.post("/api/v1/workspaces", { headers, data: { name: "CDC registration test" } })).ok()).toBe(true);
  const company = await page.request.post("/api/v1/companies", { headers, data: { name: "Harbor Demo Co., Ltd." } });
  expect(company.ok()).toBe(true);

  await page.goto("/cdc");
  await page.getByRole("button", { name: "Register workbook" }).click();
  const dialog = page.getByRole("dialog", { name: "Register Master List" });
  const workbook = resolve("../api/tests/fixtures/cdc-approval.xlsx");
  await dialog.getByLabel("Master List workbook").setInputFiles(workbook);
  await expect(dialog.getByText("1 item detected")).toBeVisible();
  await expect(dialog.getByText("Workbook · CDC cut stock!A1")).toBeVisible();

  const reference = dialog.getByLabel("Approval reference", { exact: true });
  await reference.fill("Manually entered");
  await dialog.getByRole("button", { name: "Apply suggestions" }).click();
  await expect(reference).toHaveValue("Manually entered");
  await expect(dialog.getByLabel("Company on approval", { exact: true })).toHaveValue("Harbor Demo Co., Ltd.");
  await expect(dialog.getByLabel("Linked company")).toHaveValue((await company.json()).id);
  await expect(dialog.getByLabel("Approval year", { exact: true })).toHaveValue("2026");
  await dialog.getByRole("button", { name: "Use suggestion for Approval reference" }).click();
  await expect(reference).toHaveValue("QIP # DEMO-2026");
  await expect(dialog.getByRole("button", { name: "Register workbook" })).toBeDisabled();
  expect(await (await page.request.get("/api/v1/cdc/versions")).json()).toEqual([]);

  await dialog.getByRole("checkbox", { name: /I checked this workbook/ }).check();
  await dialog.getByRole("button", { name: "Register workbook" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole("link", { name: "Download workbook" })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: "Woven label" })).toBeVisible();
});
