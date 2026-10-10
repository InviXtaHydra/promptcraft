import { z } from "zod";

/**
 * AI settings from the environment, validated once. Only local providers exist: the deterministic
 * mock (tests, offline) and Ollama (free, runs on this machine). No API keys anywhere.
 */
const schema = z.object({
  DIALOGUE_PROVIDER: z.enum(["mock", "ollama"]).default("mock"),
  OLLAMA_URL: z.url().default("http://localhost:11434"),
  OLLAMA_MODEL: z.string().min(1).default("qwen3:8b"),
  EMBEDDING_PROVIDER: z.enum(["hash", "ollama"]).default("hash"),
  OLLAMA_EMBED_MODEL: z.string().min(1).default("nomic-embed-text"),
  /** Per model call */
  AI_CALL_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000).default(90_000),
  /** For a whole NPC turn, all calls together */
  AI_TURN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(900_000).default(180_000),
  /** Retries after a transient error (connection refused, 5xx); timeouts and cancellations aren't retried */
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(2),
  /** Prompt + output tokens one turn may use; optional calls are skipped when it would be exceeded */
  AI_TURN_TOKEN_BUDGET: z.coerce.number().int().min(500).max(200_000).default(16_000),
});

export type AiConfig = z.infer<typeof schema> & { embeddingDim: 768; maxTransitions: number; maxToolCalls: number };

/** The vector column is vector(768); both embedders produce exactly that. */
export const EMBEDDING_DIM = 768 as const;

export function readAiConfig(env: Record<string, string | undefined> = process.env): AiConfig {
  const parsed = schema.safeParse(env);
  if (!parsed.success) throw new Error(`Invalid AI configuration: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return { ...parsed.data, embeddingDim: EMBEDDING_DIM, maxTransitions: 14, maxToolCalls: 6 };
}
