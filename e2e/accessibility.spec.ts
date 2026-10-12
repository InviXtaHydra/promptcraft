import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { registerNewPlayer, setRole, startInvestigation } from "./helpers";

/** WCAG 2.1 A/AA checks with axe-core. Serious and critical violations fail the test. */
async function expectNoSeriousViolations(page: Page, label: string) {
  // Measure the settled screen, not a fade-in halfway through
  await page.evaluate(() => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined))));
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
  const serious = results.violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  const summary = serious.map((v) => `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join("\n  ")}`);
  expect(summary, `${label}: axe violations`).toEqual([]);
}

test("the main screens have no serious accessibility violations", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/");
  await expectNoSeriousViolations(page, "landing");
  await page.goto("/login");
  await expectNoSeriousViolations(page, "sign in");

  const { email } = await registerNewPlayer(page);
  await expectNoSeriousViolations(page, "investigations");
  await startInvestigation(page);
  await page.getByLabel("Message to Balthazar").fill("hello");
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByRole("heading", { name: "The Ghost Courier" })).toBeVisible();
  await expectNoSeriousViolations(page, "game");
  await page.getByRole("tab", { name: /Case/ }).click();
  await expectNoSeriousViolations(page, "case board");

  await setRole(email, "CREATOR");
  await page.goto("/creator");
  await page.getByRole("button", { name: "Copy into a draft" }).first().click();
  await expect(page.getByText(/Valid: ready to preview or publish/)).toBeVisible();
  await expectNoSeriousViolations(page, "creator editor");
});
