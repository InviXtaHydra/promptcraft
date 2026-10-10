import { OllamaChatModel } from "../ai/chat-model";
import { readAiConfig, type AiConfig } from "../ai/config";
import { HashEmbedder, OllamaEmbedder, type Embedder } from "../ai/embeddings";
import type { PrismaClient } from "../prisma-client";
import { MockBrain, OllamaBrain, type NpcBrain } from "./brain";
import type { TurnDeps } from "./npc-turn";

export { runNpcTurn, type TurnResult } from "./npc-turn";
export type { TurnEvent } from "./trace";

export function createBrain(config: AiConfig): NpcBrain {
  if (config.DIALOGUE_PROVIDER === "ollama") {
    return new OllamaBrain(new OllamaChatModel({ baseUrl: config.OLLAMA_URL, model: config.OLLAMA_MODEL, timeoutMs: config.AI_CALL_TIMEOUT_MS, maxRetries: config.AI_MAX_RETRIES }));
  }
  return new MockBrain();
}

export function createEmbedder(config: AiConfig): Embedder {
  return config.EMBEDDING_PROVIDER === "ollama" ? new OllamaEmbedder(config.OLLAMA_URL, config.OLLAMA_EMBED_MODEL) : new HashEmbedder();
}

/** The agent setup from the environment (DIALOGUE_PROVIDER, EMBEDDING_PROVIDER, OLLAMA_*). */
export function createAgentDeps(prisma: PrismaClient, env: Record<string, string | undefined> = process.env): TurnDeps {
  const config = readAiConfig(env);
  return { prisma, config, brain: createBrain(config), embedder: createEmbedder(config) };
}

export type AiStatus = {
  dialogue: { provider: string; model: string; simulated: boolean };
  embeddings: { model: string; simulated: boolean };
  ollama: { url: string; reachable: boolean; chatModelInstalled: boolean; embedModelInstalled: boolean } | null;
};

/** Whether the configured local AI is ready, for the UI's status badge. Never throws. */
export async function aiStatus(config: AiConfig = readAiConfig()): Promise<AiStatus> {
  const usesOllama = config.DIALOGUE_PROVIDER === "ollama" || config.EMBEDDING_PROVIDER === "ollama";
  let ollama: AiStatus["ollama"] = null;
  if (usesOllama) {
    ollama = { url: config.OLLAMA_URL, reachable: false, chatModelInstalled: false, embedModelInstalled: false };
    try {
      const response = await fetch(new URL("/api/tags", config.OLLAMA_URL), { signal: AbortSignal.timeout(2_000) });
      const data = (await response.json()) as { models?: { name: string }[] };
      const names = new Set((data.models ?? []).flatMap((m) => [m.name, m.name.replace(/:latest$/, "")]));
      ollama = { ...ollama, reachable: response.ok, chatModelInstalled: names.has(config.OLLAMA_MODEL), embedModelInstalled: names.has(config.OLLAMA_EMBED_MODEL) };
    } catch {
      // stays unreachable
    }
  }
  const brain = createBrain(config);
  const embedder = createEmbedder(config);
  return { dialogue: { provider: brain.provider, model: brain.model, simulated: brain.isSimulated }, embeddings: { model: embedder.model, simulated: embedder.isSimulated }, ollama };
}
