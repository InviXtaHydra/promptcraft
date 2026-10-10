import { mockDialogueProvider } from "./mock";
import type { DialogueProvider } from "./types";

/**
 * Phase 1 ships one provider: the deterministic mock. Real model providers arrive in Phase 2 behind
 * the same interface. An unknown value fails loudly instead of silently falling back to the mock.
 */
export function getDialogueProvider(name = process.env.DIALOGUE_PROVIDER ?? "mock"): DialogueProvider {
  if (name === "mock") return mockDialogueProvider;
  throw new Error(`DIALOGUE_PROVIDER="${name}" is not available yet. Phase 1 only supports "mock".`);
}
