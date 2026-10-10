import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { OllamaChatModel } from "@/server/ai/chat-model";
import { ProviderError } from "@/server/ai/errors";

/**
 * A fake Ollama /api/chat that plays back scripted responses, so the client's handling of
 * structured output, retries, timeouts, errors and streaming is tested without a real model.
 */
type Reply = { status?: number; body?: unknown; content?: string; chunks?: string[]; delayMs?: number; prompt?: number; output?: number };
let queue: Reply[] = [];
const requests: Record<string, unknown>[] = [];
let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", async () => {
      const body = JSON.parse(raw || "{}");
      requests.push(body);
      const reply = queue.shift() ?? { content: "{}" };
      if (reply.delayMs) await new Promise((r) => setTimeout(r, reply.delayMs));
      if (res.destroyed) return;
      if (reply.status && reply.status !== 200) {
        res.writeHead(reply.status, { "content-type": "application/json" });
        res.end(JSON.stringify(reply.body ?? { error: "boom" }));
        return;
      }
      const done = { done: true, done_reason: "stop", prompt_eval_count: reply.prompt ?? 11, eval_count: reply.output ?? 7 };
      const chunks = reply.chunks ?? [reply.content ?? ""];
      if (body.stream) {
        res.writeHead(200, { "content-type": "application/x-ndjson" });
        for (const c of chunks) res.write(JSON.stringify({ model: body.model, message: { role: "assistant", content: c }, done: false }) + "\n");
        res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: "" }, ...done }) + "\n");
      } else {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ model: body.model, message: { role: "assistant", content: chunks.join("") }, ...done }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));
beforeEach(() => {
  queue = [];
  requests.length = 0;
});

const model = (overrides: Partial<{ timeoutMs: number; maxRetries: number; baseUrl: string }> = {}) =>
  new OllamaChatModel({ baseUrl, model: "qwen3:8b", timeoutMs: 2_000, maxRetries: 2, ...overrides });
const schema = z.object({ intent: z.string(), needsAction: z.boolean() });
const msgs = [{ role: "user" as const, content: "hello" }];

describe("OllamaChatModel", () => {
  it("returns schema-validated JSON with token usage, thinking off and the JSON schema as format", async () => {
    queue.push({ content: '{"intent":"greet","needsAction":false}', prompt: 40, output: 9 });
    const r = await model().structured(schema, msgs, { maxTokens: 50 });
    expect(r.data).toEqual({ intent: "greet", needsAction: false });
    expect(r.usage).toEqual({ inputTokens: 40, outputTokens: 9 });
    expect(r).toMatchObject({ attempts: 1, retries: 0 });
    expect(requests[0]).toMatchObject({ model: "qwen3:8b", think: false });
    expect(requests[0].format).toMatchObject({ type: "object", required: ["intent", "needsAction"] });
  });

  it("asks once more when the JSON doesn't match, then gives up with bad_output", async () => {
    queue.push({ content: "not json" }, { content: '{"intent":"greet","needsAction":false}' });
    const repaired = await model().structured(schema, msgs, { maxTokens: 50 });
    expect(repaired.data.intent).toBe("greet");
    expect(requests).toHaveLength(2);

    queue.push({ content: '{"intent":1}' }, { content: '{"intent":2}' });
    await expect(model().structured(schema, msgs, { maxTokens: 50 })).rejects.toMatchObject({ code: "bad_output" });
  });

  it("retries a 5xx and counts the retry", async () => {
    queue.push({ status: 503, body: { error: "loading" } }, { content: '{"intent":"x","needsAction":true}' });
    const r = await model().structured(schema, msgs, { maxTokens: 50 });
    expect(r).toMatchObject({ attempts: 2, retries: 1 });
  });

  it("normalises a missing model, a timeout and an unreachable server", async () => {
    queue.push({ status: 404, body: { error: "model 'qwen3:8b' not found, try pulling it first" } });
    await expect(model().structured(schema, msgs, { maxTokens: 50 })).rejects.toMatchObject({ code: "model_missing" });

    queue.push({ delayMs: 800, content: "{}" });
    await expect(model({ timeoutMs: 200 }).structured(schema, msgs, { maxTokens: 50 })).rejects.toMatchObject({ code: "timeout" });

    const offline = model({ baseUrl: "http://127.0.0.1:9", maxRetries: 1 });
    const error = await offline.structured(schema, msgs, { maxTokens: 50 }).catch((e) => e);
    expect(error).toBeInstanceOf(ProviderError);
    expect(error.code).toBe("unreachable");
  });

  it("streams the reply in pieces and never shows a <think> block", async () => {
    queue.push({ chunks: ["<think>", "secret reasoning", "</think>", "Kid. ", "Find ", "the shard."], prompt: 100, output: 12 });
    const pieces: string[] = [];
    const r = await model().stream(msgs, { maxTokens: 80 }, (d) => pieces.push(d));
    expect(r.text).toBe("Kid. Find the shard.");
    expect(pieces.join("")).toBe("Kid. Find the shard.");
    expect(pieces.join("")).not.toContain("secret");
    expect(r.usage).toEqual({ inputTokens: 100, outputTokens: 12 });
  });

  it("stops when the caller cancels", async () => {
    queue.push({ delayMs: 1_000, content: "{}" });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    await expect(model().structured(schema, msgs, { maxTokens: 50, signal: controller.signal })).rejects.toMatchObject({ code: "cancelled" });
  });
});
