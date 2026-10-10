import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { ChatOllama } from "@langchain/ollama";
import { z } from "zod";
import { normalizeProviderError, ProviderError } from "./errors";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export type Usage = { inputTokens: number; outputTokens: number };
export type CallMeta = { usage: Usage; latencyMs: number; attempts: number; retries: number };

export type CallOptions = {
  signal?: AbortSignal;
  /** Maximum output tokens */
  maxTokens: number;
  temperature?: number;
};

/** A language model the agent can use. Implementations normalise errors to ProviderError. */
export interface ChatModel {
  readonly provider: string;
  readonly model: string;
  /** JSON output validated against a Zod schema; one repair attempt when the output doesn't parse */
  structured<T extends z.ZodType>(schema: T, messages: ChatMessage[], options: CallOptions): Promise<{ data: z.infer<T> } & CallMeta>;
  /** Plain text, streamed piece by piece to onDelta */
  stream(messages: ChatMessage[], options: CallOptions, onDelta: (text: string) => void): Promise<{ text: string } & CallMeta>;
}

const toLangChain = (messages: ChatMessage[]): BaseMessage[] =>
  messages.map((m) => (m.role === "system" ? new SystemMessage(m.content) : m.role === "user" ? new HumanMessage(m.content) : new AIMessage(m.content)));

const usageOf = (message: { usage_metadata?: { input_tokens?: number; output_tokens?: number } }): Usage => ({
  inputTokens: message.usage_metadata?.input_tokens ?? 0,
  outputTokens: message.usage_metadata?.output_tokens ?? 0,
});

const textOf = (content: unknown) => (typeof content === "string" ? content : Array.isArray(content) ? content.map((c) => (typeof c === "string" ? c : (c?.text ?? ""))).join("") : "");

/** qwen3 can still emit an empty <think></think> block; it is never shown to anyone. */
const stripThinking = (text: string) => text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

/** What may be shown while streaming: everything except (still open) think blocks. */
function visibleText(raw: string) {
  const open = raw.lastIndexOf("<think>");
  return stripThinking(open > raw.lastIndexOf("</think>") ? raw.slice(0, open) : raw);
}

export type OllamaChatOptions = { baseUrl: string; model: string; timeoutMs: number; maxRetries: number; numCtx?: number };

/**
 * Ollama through LangChain's ChatOllama. Thinking mode is off (it's slow on a laptop and its text
 * must never reach players or traces), JSON output uses Ollama's schema-constrained `format`.
 */
export class OllamaChatModel implements ChatModel {
  readonly provider = "ollama";
  readonly model: string;

  constructor(private readonly options: OllamaChatOptions) {
    this.model = options.model;
  }

  /**
   * A client per call whose HTTP requests are bound to `signal`. ChatOllama only checks its own
   * signal between streamed chunks (so a timeout wouldn't interrupt model loading or prompt
   * processing); binding fetch makes timeouts and cancellations stop the request immediately.
   */
  private client(signal: AbortSignal, maxTokens: number, temperature: number, format?: Record<string, unknown>) {
    const boundFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal: init?.signal ? AbortSignal.any([init.signal, signal]) : signal });
    return new ChatOllama({
      fetch: boundFetch,
      baseUrl: this.options.baseUrl,
      model: this.options.model,
      think: false,
      temperature,
      numPredict: maxTokens,
      numCtx: this.options.numCtx ?? 8192,
      ...(format ? { format } : {}),
    });
  }

  /** Runs `call` with a per-call timeout, retrying transient errors with a short backoff. */
  private async withRetries<R>(signal: AbortSignal | undefined, call: (signal: AbortSignal) => Promise<R>): Promise<{ result: R; attempts: number; retries: number }> {
    let attempt = 0;
    for (;;) {
      attempt++;
      if (signal?.aborted) throw new ProviderError("cancelled", "Model call cancelled", false);
      const timeout = AbortSignal.timeout(this.options.timeoutMs);
      const combined = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
      const interrupted = () =>
        signal?.aborted
          ? new ProviderError("cancelled", "Model call cancelled", false)
          : timeout.aborted
            ? new ProviderError("timeout", `Model call timed out after ${this.options.timeoutMs} ms (${this.model})`, false)
            : null;
      try {
        const result = await call(combined);
        // ChatOllama returns quietly (with partial output) when aborted mid-stream: never accept that
        const stop = interrupted();
        if (stop) throw stop;
        return { result, attempts: attempt, retries: attempt - 1 };
      } catch (error) {
        const normalized = interrupted() ?? normalizeProviderError(error, this.model);
        if (!normalized.retryable || attempt > this.options.maxRetries) throw normalized;
        await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
      }
    }
  }

  async structured<T extends z.ZodType>(schema: T, messages: ChatMessage[], options: CallOptions) {
    const started = Date.now();
    const format = z.toJSONSchema(schema) as Record<string, unknown>;
    const usage: Usage = { inputTokens: 0, outputTokens: 0 };
    let attempts = 0;
    let retries = 0;
    let conversation = messages;

    for (let repair = 0; repair < 2; repair++) {
      const { result, attempts: a, retries: r } = await this.withRetries(options.signal, (signal) =>
        this.client(signal, options.maxTokens, options.temperature ?? 0.2, format).invoke(toLangChain(conversation), { signal }),
      );
      attempts += a;
      retries += r;
      const u = usageOf(result);
      usage.inputTokens += u.inputTokens;
      usage.outputTokens += u.outputTokens;
      const raw = stripThinking(textOf(result.content));
      try {
        const parsed = schema.safeParse(JSON.parse(raw));
        if (parsed.success) return { data: parsed.data, usage, latencyMs: Date.now() - started, attempts, retries };
        conversation = [...messages, { role: "assistant", content: raw }, { role: "user", content: `That JSON doesn't match the schema (${parsed.error.issues[0]?.message}). Answer again with valid JSON only.` }];
      } catch {
        conversation = [...messages, { role: "assistant", content: raw.slice(0, 500) }, { role: "user", content: "That wasn't valid JSON. Answer again with valid JSON only." }];
      }
    }
    throw new ProviderError("bad_output", "The model's JSON didn't match the expected schema after a repair attempt", false);
  }

  async stream(messages: ChatMessage[], options: CallOptions, onDelta: (text: string) => void) {
    const started = Date.now();
    let emitted = "";
    const { result, attempts, retries } = await this.withRetries(options.signal, async (signal) => {
      // A retry after partial output would duplicate text, so only retry before the first token
      if (emitted) throw new ProviderError("provider_error", "Stream interrupted", false);
      let raw = "";
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      for await (const chunk of await this.client(signal, options.maxTokens, options.temperature ?? 0.7).stream(toLangChain(messages), { signal })) {
        if (chunk.usage_metadata) usage = usageOf(chunk);
        const piece = textOf(chunk.content);
        if (!piece) continue;
        raw += piece;
        const visible = visibleText(raw);
        if (visible.length > emitted.length) {
          onDelta(visible.slice(emitted.length));
          emitted = visible;
        }
      }
      return { text: stripThinking(raw), usage };
    });
    if (!result.text) throw new ProviderError("bad_output", "The model returned an empty reply", false);
    return { text: result.text, usage: result.usage, latencyMs: Date.now() - started, attempts, retries };
  }
}

/**
 * Cost estimate in USD. Both providers in this project run locally, so the token cost is 0; the
 * electricity isn't counted. Shown as an estimate, never as a billed amount.
 */
export function estimateCostUsd(): number {
  return 0;
}
