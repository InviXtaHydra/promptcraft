import { expect, test } from "@playwright/test";
import { registerNewPlayer, startInvestigation } from "./helpers";

test("a new player completes The Ghost Courier and the progress survives a reload", async ({ page }) => {
  await registerNewPlayer(page);
  await startInvestigation(page);
  await expect(page.getByLabel("80 credits")).toBeVisible();

  // Talk to Balthazar: the reply is labelled as simulated and the quest starts
  const chat = page.getByRole("region", { name: /Balthazar/ });
  await expect(chat.getByText("Simulated dialogue · scripted, not AI")).toBeVisible();
  await page.getByLabel("Message to Balthazar").fill("What happened to your courier?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(chat.getByText(/My courier, Juno/)).toBeVisible();
  await expect(chat.getByText("simulated", { exact: true }).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();

  // Explore and find the clue and the cargo
  await page.getByRole("button", { name: "Investigate this area" }).click();
  await expect(page.getByText(/You find something: Scorched Courier Badge/)).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText("Scorched Courier Badge", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: /Items/ }).click();
  await expect(page.getByText("Encrypted Memory Shard", { exact: true })).toBeVisible();

  // Hand the shard over: the quest completes, credits are paid, the Bazaar unlocks
  await page.getByRole("button", { name: "Give Encrypted Memory Shard" }).click();
  await expect(page.getByLabel("230 credits")).toBeVisible();
  await page.getByRole("tab", { name: /Quests/ }).click();
  await expect(page.getByRole("heading", { name: "Follow the Signal" })).toBeVisible();
  await expect(page.getByRole("button", { name: /The Cyber-Bazaar/ })).toBeEnabled();

  // Reload: everything is still there
  await page.reload();
  await expect(page.getByLabel("230 credits")).toBeVisible();
  await expect(page.getByRole("region", { name: /Balthazar/ }).getByText(/PROJECT GENESIS/)).toBeVisible();
  await page.getByRole("tab", { name: /Evidence/ }).click();
  await expect(page.getByText("Decrypted Shard Log", { exact: true })).toBeVisible();
});

test("the second quest: travel, a trust-based discount and the purchase", async ({ page }) => {
  await registerNewPlayer(page);
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Investigate this area" }).click();
  await page.getByRole("button", { name: "Give Encrypted Memory Shard" }).click();
  await expect(page.getByLabel("230 credits")).toBeVisible();

  await page.getByRole("button", { name: /The Cyber-Bazaar/ }).click();
  await expect(page.getByRole("heading", { name: "The Cyber-Bazaar" })).toBeVisible();
  await page.getByRole("button", { name: /Kira Okonkwo-Vale/ }).click();
  await expect(page.getByRole("button", { name: /Buy Signal Decoder · ¤120/ })).toBeVisible();
  await page.getByRole("button", { name: "Balthazar sent me." }).click();
  await expect(page.getByRole("button", { name: /Buy Signal Decoder · ¤95 friend price/ })).toBeVisible();
  await page.getByRole("button", { name: /Buy Signal Decoder/ }).click();
  await expect(page.getByLabel(`${230 - 95 + 60} credits`)).toBeVisible();
  await expect(page.getByRole("region", { name: "City feed" }).getByText("The signal points to Aether Tower", { exact: true })).toBeVisible();
});

test("signed-out visitors are sent to sign in, and can't open someone else's game", async ({ page, browser }) => {
  await page.goto("/play");
  await expect(page).toHaveURL(/\/login\?next=%2Fplay/);

  await registerNewPlayer(page);
  await startInvestigation(page);
  const gameUrl = page.url();

  const other = await browser.newContext();
  const intruder = await other.newPage();
  await registerNewPlayer(intruder);
  await intruder.goto(gameUrl);
  await expect(intruder.getByText("This investigation doesn't exist, or it isn't yours.")).toBeVisible();
  await other.close();
});
