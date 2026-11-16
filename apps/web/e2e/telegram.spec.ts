import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("a Telegram rejection link keeps the exact review and workspace through sign-in", async ({ page }) => {
  const caseId = randomUUID();
  const workspaceId = randomUUID();
  const reviewId = randomUUID();
  const deepLink = `/open/${caseId}?workspace=${workspaceId}&revision=2&review=${reviewId}&decision=reject`;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(deepLink);
  await expect(page.getByRole("heading", { name: "Staff sign in" })).toBeVisible();
  const signIn = new URL(page.url());
  expect(signIn.pathname).toBe("/login");
  expect(signIn.searchParams.get("next")).toBe(deepLink);
});
