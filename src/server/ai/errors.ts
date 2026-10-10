/** One error type for every provider, so the agent and the UI handle failures the same way. */
export type ProviderErrorCode = "unreachable" | "model_missing" | "timeout" | "cancelled" | "bad_output" | "provider_error";

export class ProviderError extends Error {
  constructor(
    readonly code: ProviderErrorCode,
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

const PLAYER_MESSAGES: Record<ProviderErrorCode, string> = {
  unreachable: "The local AI isn't reachable. Start Ollama (`ollama serve` or the Ollama app) and try again.",
  model_missing: "The AI model isn't installed in Ollama yet. Run `ollama pull qwen3:8b` (and `ollama pull nomic-embed-text`).",
  timeout: "The local AI took too long to answer. Try again; the first answer after a pause is the slowest.",
  cancelled: "The answer was cancelled.",
  bad_output: "The AI gave an answer the game couldn't use. Try rephrasing.",
  provider_error: "The local AI ran into an error. Try again.",
};

export const playerMessageFor = (code: ProviderErrorCode) => PLAYER_MESSAGES[code];

/** Maps fetch, abort and Ollama errors to a ProviderError. */
export function normalizeProviderError(error: unknown, model: string): ProviderError {
  if (error instanceof ProviderError) return error;
  const e = error as { name?: string; message?: string; status_code?: number; status?: number; cause?: { code?: string } };
  const message = String(e?.message ?? error);
  if (e?.name === "TimeoutError" || /timed? ?out/i.test(message)) return new ProviderError("timeout", `Model call timed out (${model})`, false);
  if (e?.name === "AbortError" || /aborted|cancel/i.test(message)) return new ProviderError("cancelled", "Model call cancelled", false);
  if (e?.cause?.code === "ECONNREFUSED" || /ECONNREFUSED|fetch failed|ENOTFOUND|socket hang up/i.test(message)) {
    return new ProviderError("unreachable", "Ollama is not reachable", true);
  }
  const status = e?.status_code ?? e?.status;
  if (status === 404 || /model .*not found|pull/i.test(message)) return new ProviderError("model_missing", `Model "${model}" is not installed in Ollama`, false);
  if (typeof status === "number" && status >= 500) return new ProviderError("provider_error", `Ollama returned ${status}`, true);
  return new ProviderError("provider_error", message.slice(0, 200), false);
}
