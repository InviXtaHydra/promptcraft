import { describe, expect, it } from "vitest";
import { HashEmbedder, toVectorLiteral } from "@/server/ai/embeddings";
import { rankScore } from "@/server/agents/memory";

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i], 0);

describe("memory ranking", () => {
  it("prefers relevant, important, recent memories from this investigation", () => {
    const relevant = rankScore(0.9, 5, 1, true).score;
    expect(relevant).toBeGreaterThan(rankScore(0.3, 5, 1, true).score);
    expect(rankScore(0.6, 9, 1, true).score).toBeGreaterThan(rankScore(0.6, 2, 1, true).score);
    expect(rankScore(0.6, 5, 1, true).score).toBeGreaterThan(rankScore(0.6, 5, 24 * 30, true).score);
    expect(rankScore(0.6, 5, 1, true).score).toBeGreaterThan(rankScore(0.6, 5, 1, false).score);
    expect(rankScore(1, 10, 0, true).score).toBeCloseTo(1, 5);
  });
});

describe("the deterministic test embedder", () => {
  const embedder = new HashEmbedder();

  it("is labelled simulated and produces 768 normalised dimensions, the same every time", async () => {
    const [a, b] = await embedder.embed(["Juno's scorched badge", "Juno's scorched badge"]);
    expect(embedder.isSimulated).toBe(true);
    expect(a).toHaveLength(768);
    expect(a).toEqual(b);
    expect(cosine(a, a)).toBeCloseTo(1, 6);
  });

  it("puts texts that share words closer together", async () => {
    const [q, near, far] = await embedder.embed(["what about the scorched badge", "The player showed him Juno's scorched badge.", "Kira sells a signal decoder"]);
    expect(cosine(q, near)).toBeGreaterThan(cosine(q, far));
  });

  it("only lets finite numbers into a vector literal", () => {
    expect(toVectorLiteral([0.5, -1])).toBe("[0.5,-1]");
    expect(() => toVectorLiteral([0.5, Number.NaN])).toThrow();
  });
});
