import { expect, test } from "@playwright/test";
import { registerNewPlayer, setRole, startInvestigation } from "./helpers";

/**
 * Captures the README screenshots from a real run of the app (scripted NPCs, labelled simulated).
 * Only runs when asked:  CAPTURE_SCREENSHOTS=1 npx playwright test screenshots --project desktop
 * The files land in docs/screenshots/. See docs/SCREENSHOTS.md.
 */
test.skip(!process.env.CAPTURE_SCREENSHOTS, "set CAPTURE_SCREENSHOTS=1 to capture");

const shot = (name: string) => ({ path: `docs/screenshots/${name}.png`, animations: "disabled" as const });

test("capture the portfolio screenshots", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.screenshot(shot("01-landing"));

  const { email } = await registerNewPlayer(page);
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("What happened to your courier?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();
  await page.getByRole("button", { name: "Investigate this area" }).click();
  await expect(page.getByText(/You find something: Scorched Courier Badge/)).toBeVisible();
  await page.screenshot(shot("02-game"));

  await page.getByRole("button", { name: "Agent debugger" }).click();
  const panel = page.getByRole("dialog", { name: "Agent debugger" });
  await expect(panel.getByRole("list", { name: "Graph nodes" })).toBeVisible();
  await page.screenshot(shot("03-agent-debugger"));
  await panel.getByRole("tab", { name: "Metrics" }).click();
  await expect(panel.getByText("Cost (estimate)")).toBeVisible();
  await page.screenshot(shot("04-metrics"));
  await page.keyboard.press("Escape");

  await page.getByLabel("Message to Balthazar").fill("Look at this scorched badge.");
  await page.getByRole("button", { name: "Send" }).click();
  await page.getByRole("button", { name: "Give Encrypted Memory Shard" }).click();
  await expect(page.getByLabel("230 credits")).toBeVisible();
  await page.getByRole("tab", { name: /Case/ }).click();
  await page.getByLabel("Who did it?").selectOption({ label: "Hale Imura" });
  await page.getByRole("button", { name: "Scorched Courier Badge" }).click();
  await page.getByRole("button", { name: "Pin theory to the board" }).click();
  await expect(page.getByRole("region", { name: "Your theories" })).toBeVisible();
  await page.getByRole("heading", { name: "Evidence network" }).scrollIntoViewIfNeeded();
  await page.screenshot(shot("05-case-board"));

  await setRole(email, "CREATOR");
  await page.goto("/creator");
  await page.getByRole("button", { name: "Copy into a draft" }).first().click();
  await expect(page.getByText(/Valid: ready to preview or publish/)).toBeVisible();
  await page.getByRole("button", { name: "NPCs" }).click();
  await page.screenshot(shot("06-creator-mode"));
});
