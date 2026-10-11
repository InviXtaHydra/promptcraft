import { expect, type Page } from "@playwright/test";
import pg from "pg";
import { testDatabaseUrl } from "../tests/support/test-database";

let counter = 0;
export async function registerNewPlayer(page: Page) {
  const id = `${Date.now().toString(36)}${counter++}`;
  await page.goto("/register");
  await page.getByLabel("Callsign").fill(`e2e_${id}`);
  await page.getByLabel("Email").fill(`e2e-${id}@test.invalid`);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/play$/);
  return { callsign: `e2e_${id}`, email: `e2e-${id}@test.invalid` };
}

export async function startInvestigation(page: Page) {
  await page.getByRole("button", { name: /New investigation/ }).click();
  await expect(page).toHaveURL(/\/play\/[a-z0-9]+$/);
  await expect(page.getByRole("heading", { name: "The Neon Slums" })).toBeVisible();
}

/** Gives a test player a role, as `npm run user:role` would (test database only). */
export async function setRole(email: string, role: "PLAYER" | "CREATOR" | "ADMIN") {
  const client = new pg.Client({ connectionString: testDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`UPDATE "User" SET role = $1 WHERE email = $2`, [role, email]);
  } finally {
    await client.end();
  }
}
