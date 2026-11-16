import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

test("staff manage multiple watched folders and see their arrivals in the Inbox", async ({ page, baseURL }) => {
  const email = process.env.SHIPPING_E2E_EMAIL;
  const password = process.env.SHIPPING_E2E_PASSWORD;
  if (!email || !password || !baseURL) throw new Error("Configure the local E2E staff account.");
  const origin = new URL(baseURL).origin;
  const headers = { Origin: origin };
  expect((await page.request.post("/api/v1/auth/login", { headers, data: { email, password } })).ok()).toBe(true);
  expect((await page.request.post("/api/v1/workspaces", { headers, data: { name: "Watched folder test" } })).ok()).toBe(true);
  const company = await page.request.post("/api/v1/companies", { headers, data: { name: "Folder Fixture Factory" } });
  expect(company.ok()).toBe(true);
  await page.goto("/inbox");
  await page.getByRole("link", { name: "Manage intake sources" }).click();
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();
  const dialog = page.getByRole("dialog");
  const api = "/api/v1/integrations/folders/agent";

  async function createFolder(name: string) {
    await page.getByRole("button", { name: "Add source" }).click();
    await expect(dialog.getByRole("button", { name: "Gmail", exact: true })).toBeVisible();
    await dialog.getByRole("button", { name: "Watched folder" }).click();
    await dialog.getByLabel("Source name").fill(name);
    await dialog.getByLabel("Linked company").selectOption({ label: "Folder Fixture Factory" });
    await dialog.getByRole("button", { name: "Create source" }).click();
    await expect(dialog.getByRole("heading", { name: "Choose a folder on your Mac" })).toBeVisible();
    const href = await dialog.getByRole("link", { name: "Choose folder" }).getAttribute("href");
    const link = new URL(href!);
    expect(link.protocol).toBe("harborway-folder:");
    expect(link.searchParams.get("server")).toBe(origin);
    expect(link.searchParams.has("key")).toBe(false);
    await dialog.getByRole("button", { name: "Close", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: name })).toContainText("Awaiting setup");
    return { source_id: link.searchParams.get("source"), code: link.searchParams.get("code") };
  }

  const pairing = await createFolder("Original Docs");
  await createFolder("Broker Documents");
  const pairingResponse = await page.request.post(`${api}/pair`, { data: pairing });
  expect(pairingResponse.ok()).toBe(true);
  const agent = { Authorization: `Bearer ${(await pairingResponse.json()).key}` };
  expect((await page.request.post(`${api}/check`, { headers: agent, data: { status: "ok" } })).status()).toBe(204);
  const source = page.getByRole("row").filter({ hasText: "Original Docs" });
  await page.reload();
  await expect(source).toContainText("Monitoring");
  await source.getByRole("button", { name: "Actions for Original Docs" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await dialog.getByLabel("Source name").fill("Shipment originals");
  await dialog.getByRole("button", { name: "Save changes" }).click();
  const renamed = page.getByRole("row").filter({ hasText: "Shipment originals" });
  await expect(renamed).toContainText("Monitoring");
  await renamed.getByRole("button", { name: "Pause" }).click();
  await expect(renamed).toContainText("Paused");
  await renamed.getByRole("button", { name: "Resume" }).click();
  await expect(renamed).toContainText("Monitoring");

  const file = await readFile(resolve("../api/tests/fixtures/supplier-review.xlsx"));
  const uploaded = await page.request.post(`${api}/upload`, { headers: agent, multipart: {
    subject: "Shipment 47",
    group: createHash("sha256").update("Shipment 47").digest("hex"),
    file: { name: "supplier.xlsx", mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", buffer: file },
  } });
  expect(uploaded.status()).toBe(201);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/inbox");
  await page.getByLabel("Intake source").selectOption("folder");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page).toHaveURL(/source=folder/);
  await expect(page.getByRole("row").filter({ hasText: "Shipment originals" })).toContainText("Watched folder");
  await page.getByLabel("Intake source").selectOption("manual");
  await page.getByRole("button", { name: "Apply" }).click();
  await expect(page.getByText("No cases match these filters.")).toBeVisible();
});
