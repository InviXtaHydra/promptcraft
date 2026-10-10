import { expect, type Page } from "@playwright/test";

let counter = 0;
export async function registerNewPlayer(page: Page) {
  const id = `${Date.now().toString(36)}${counter++}`;
  await page.goto("/register");
  await page.getByLabel("Callsign").fill(`e2e_${id}`);
  await page.getByLabel("Email").fill(`e2e-${id}@test.invalid`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/play$/);
  return { callsign: `e2e_${id}` };
}

export async function startInvestigation(page: Page) {
  await page.getByRole("button", { name: /New investigation/ }).click();
  await expect(page).toHaveURL(/\/play\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "The Neon Slums" })).toBeVisible();
}
