import { expect, test } from "@playwright/test";
import { registerNewPlayer, startInvestigation } from "./helpers";

test("the agent debugger shows the live turn and every recorded run", async ({ page }) => {
  await registerNewPlayer(page);
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("What happened to your courier?");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("region", { name: /Balthazar/ }).getByText(/My courier, Juno/).first()).toBeVisible();

  await page.getByRole("button", { name: "Agent debugger" }).click();
  const panel = page.getByRole("dialog", { name: "Agent debugger" });
  // Live turn: graph nodes, the tool call and the simulated label
  const nodes = panel.getByRole("list", { name: "Graph nodes" });
  for (const label of ["Validate request", "Recall memories", "Interpret message", "Plan actions", "Policy check", "Engine executes", "Generate reply"]) {
    await expect(nodes.getByText(label, { exact: true })).toBeVisible();
  }
  await expect(panel.getByText("simulated").first()).toBeVisible();
  await expect(panel.getByText("update_quest").first()).toBeVisible();

  // History: the run opens with its steps, tool calls and state changes
  await panel.getByRole("tab", { name: "All runs" }).click();
  await panel.getByRole("button", { name: /Balthazar/ }).first().click();
  await expect(panel.getByRole("region", { name: "Graph steps" })).toBeVisible();
  await expect(panel.getByRole("region", { name: "Tool executions" }).getByText("update_quest")).toBeVisible();
  await expect(panel.getByRole("region", { name: "State changes" }).getByText(/New quest: The Ghost Courier/)).toBeVisible();
  await expect(panel.getByText("simulated script")).toBeVisible();
});
