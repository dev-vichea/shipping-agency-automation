import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("staff register a fleet vehicle and keep access to driver and dispatch forms", async ({ page }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password) throw new Error("Configure the local E2E staff account.");

  await page.goto("/login");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Operations overview" })).toBeVisible();

  await page.goto("/fleet");
  const plate = `TEST-${randomUUID().slice(0, 8)}`;
  const vehicle = page.getByRole("dialog", { name: "Register New Vehicle" });
  await page.getByRole("button", { name: "Add Vehicle" }).click();
  await vehicle.getByLabel("Truck Head Plate").fill(plate);
  const save = () => page.waitForResponse((response) =>
    new URL(response.url()).pathname === "/api/v1/fleet/vehicles" && response.request().method() === "POST",
  );
  const created = save();
  await vehicle.getByRole("button", { name: "Save Vehicle" }).click();
  expect((await created).status()).toBe(201);
  await expect(vehicle).toBeHidden();
  await expect(page.getByRole("row").filter({ hasText: plate })).toHaveCount(1);
  await page.reload();
  await expect(page.getByRole("row").filter({ hasText: plate })).toHaveCount(1);

  await page.getByRole("button", { name: "Add Vehicle" }).click();
  await vehicle.getByLabel("Truck Head Plate").fill(plate);
  const duplicate = save();
  await vehicle.getByRole("button", { name: "Save Vehicle" }).click();
  expect((await duplicate).status()).toBe(409);
  await expect(vehicle).toBeVisible();
  await expect(page.getByRole("alert", { includeHidden: true }).filter({ hasText: "already exists" })).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goto("/fleet/drivers");
  await expect(page.getByRole("heading", { name: "Drivers Directory" })).toBeVisible();
  await page.getByRole("button", { name: "Add Driver" }).click();
  await expect(page.getByRole("dialog").getByLabel("Full Name")).toBeVisible();

  await page.goto("/fleet/dispatches");
  await expect(page.getByRole("heading", { name: "Active Dispatch Trips" })).toBeVisible();
  await page.getByRole("button", { name: "New Dispatch" }).click();
  await expect(page.getByRole("dialog").getByLabel("Shipment / Invoice Ref")).toBeVisible();
});
