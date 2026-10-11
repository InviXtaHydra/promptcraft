import { expect, test } from "@playwright/test";
import { registerNewPlayer, setRole, startInvestigation } from "./helpers";

test("the case board: evidence network, suspects and a pinned theory with its verdict", async ({ page }) => {
  await registerNewPlayer(page);
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("What happened to your courier?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();
  await page.getByRole("button", { name: "Investigate this area" }).click();
  await expect(page.getByText(/You find something: Scorched Courier Badge/)).toBeVisible();

  await page.getByRole("tab", { name: /Case/ }).click();
  await expect(page.getByRole("heading", { name: "Evidence network" })).toBeVisible();
  const suspects = page.getByRole("region", { name: "Suspects" });
  for (const name of ["Hale Imura", "Kira Okonkwo-Vale", "Balthazar"]) await expect(suspects.getByText(name, { exact: true })).toBeVisible();
  // The case can't be closed yet: that needs the Project Genesis investigation
  await expect(page.getByRole("button", { name: "Submit the case" })).toBeDisabled();

  await page.getByLabel("Who did it?").selectOption({ label: "Hale Imura" });
  await page.getByRole("button", { name: "Scorched Courier Badge" }).click();
  await page.getByLabel(/Note/).fill("Started with the badge");
  await page.getByRole("button", { name: "Pin theory to the board" }).click();
  const theories = page.getByRole("region", { name: "Your theories" });
  await expect(theories.getByText("Hale Imura")).toBeVisible();
  await expect(theories.getByText(/weak|plausible|strong|contradicted/)).toBeVisible();
  await expect(theories.getByText("Started with the badge")).toBeVisible();

  // It survives a reload, and can be discarded
  await page.reload();
  await page.getByRole("tab", { name: /Case/ }).click();
  await page.getByRole("button", { name: "Discard this theory" }).click();
  await expect(page.getByRole("region", { name: "Your theories" })).toHaveCount(0);
});

test("the debugger's metrics and simulation tabs; the controls are for creators in production", async ({ page }) => {
  const { email } = await registerNewPlayer(page);
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();

  await page.getByRole("button", { name: "Agent debugger" }).click();
  const panel = page.getByRole("dialog", { name: "Agent debugger" });
  await panel.getByRole("tab", { name: "Metrics" }).click();
  await expect(panel.getByText("Latency p50 / p95 (measured)")).toBeVisible();
  await expect(panel.getByText("Cost (estimate)")).toBeVisible();
  await expect(panel.getByRole("region", { name: "Tool call metrics" }).getByText("update_quest")).toBeVisible();

  // This e2e server runs in production mode: a plain player can't step the simulation
  await panel.getByRole("tab", { name: "Simulation" }).click();
  await panel.getByRole("button", { name: "Step one tick" }).click();
  await expect(panel.getByRole("alert")).toBeVisible();

  await setRole(email, "CREATOR");
  await panel.getByRole("button", { name: "Step one tick" }).click();
  const history = panel.getByRole("list", { name: "Simulation history" });
  await expect(history.getByText("tick 1")).toBeVisible();
  await expect(history.getByText("manual")).toBeVisible();
  await panel.getByRole("button", { name: "Pause" }).click();
  await expect(panel.getByText("paused", { exact: true })).toBeVisible();
});

test("Creator Mode: a player is turned away; a creator copies, edits, checks and previews a scenario", async ({ page }) => {
  const { email } = await registerNewPlayer(page);
  await page.goto("/creator");
  await expect(page.getByText("Creator Mode needs the creator role")).toBeVisible();

  await setRole(email, "CREATOR");
  await page.reload();
  await page.getByRole("button", { name: "Copy into a draft" }).first().click();
  await expect(page).toHaveURL(/\/creator\/[a-z0-9]+$/);
  await expect(page.getByText(/Valid: ready to preview or publish/)).toBeVisible();

  // A broken edit is saved but reported, and blocks the preview
  await page.getByRole("button", { name: "NPCs" }).click();
  await page.getByLabel("Starting trust").fill("500");
  await page.getByRole("button", { name: "Save & check" }).click();
  await expect(page.getByText(/problem\(s\)/).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Preview" })).toBeDisabled();

  await page.getByLabel("Starting trust").fill("15");
  await page.getByRole("button", { name: "Overview & simulation" }).click();
  await page.getByLabel("Title").fill("Rain Check");
  await page.getByLabel("Starting credits").fill("777");
  await page.getByRole("button", { name: "Save & check" }).click();
  await expect(page.getByText(/Valid: ready to preview or publish/)).toBeVisible();

  await page.getByRole("button", { name: "Preview" }).click();
  await expect(page).toHaveURL(/\/play\/[a-z0-9]+$/);
  await expect(page.getByText(/Preview run of a Creator Mode draft/)).toBeVisible();
  await expect(page.getByLabel("777 credits")).toBeVisible();

  // The preview isn't one of the player's investigations
  await page.goto("/play");
  await expect(page.getByText("No open cases yet")).toBeVisible();
});
