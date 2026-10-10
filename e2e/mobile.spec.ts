import { expect, test } from "@playwright/test";
import { registerNewPlayer, startInvestigation } from "./helpers";

test("the game is playable on a phone with the bottom navigation", async ({ page }) => {
  await registerNewPlayer(page);
  await startInvestigation(page);
  const nav = page.getByRole("navigation", { name: "Game sections" });
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: /Balthazar/ }).click();
  await page.getByLabel("Message to Balthazar").fill("hi");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText(/My courier, Juno/)).toBeVisible();
  await nav.getByRole("button", { name: "Journal" }).click();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();
  // No sideways scrolling on a small screen
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});
