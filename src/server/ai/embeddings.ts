import { createHash } from "node:crypto";
import { OllamaEmbeddings } from "@langchain/ollama";
import { EMBEDDING_DIM } from "./config";
import { normalizeProviderError } from "./errors";

/** Turns text into vectors for the NPC memory (pgvector, 768 dimensions). */
export interface Embedder {
  /** Stored with every vector; retrieval only compares vectors from the same model */
  readonly model: string;
  readonly dim: number;
  /** True for the deterministic test embedder, which has no understanding of meaning */
  readonly isSimulated: boolean;
  embed(texts: string[], purpose: "query" | "document", signal?: AbortSignal): Promise<number[][]>;
}

/**
 * Deterministic feature-hashing embedder for tests and offline development. Texts that share words
 * end up close together; it knows nothing about synonyms. Labelled as simulated in traces.
 */
export class HashEmbedder implements Embedder {
  readonly model = "hash-768-v1";
  readonly dim = EMBEDDING_DIM;
  readonly isSimulated = true;

  async embed(texts: string[]) {
    return texts.map((text) => {
      const v = new Array<number>(this.dim).fill(0);
      const words = text.toLowerCase().match(/[a-z0-9]+/g) ?? [];
      const features = [...words, ...words.slice(1).map((w, i) => `${words[i]}_${w}`)];
      for (const f of features) {
        const h = createHash("sha256").update(f).digest();
        const index = h.readUInt32BE(0) % this.dim;
        v[index] += h[4] & 1 ? 1 : -1;
      }
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / norm);
    });
  }
}

/** nomic-embed-text through Ollama. Its task prefixes improve retrieval quality. */
export class OllamaEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  readonly isSimulated = false;
  private readonly client: OllamaEmbeddings;

  constructor(
    baseUrl: string,
    readonly model: string,
  ) {
    this.client = new OllamaEmbeddings({ baseUrl, model });
  }

  async embed(texts: string[], purpose: "query" | "document") {
    const prefix = this.model.includes("nomic") ? (purpose === "query" ? "search_query: " : "search_document: ") : "";
    try {
      const vectors = await this.client.embedDocuments(texts.map((t) => prefix + t));
      for (const v of vectors) {
        if (v.length !== this.dim) throw new Error(`Embedding model ${this.model} returned ${v.length} dimensions, expected ${this.dim}`);
      }
      return vectors;
    } catch (error) {
      if (error instanceof Error && error.message.includes("dimensions")) throw error;
      throw normalizeProviderError(error, this.model);
    }
  }
}

/** pgvector literal for a parameterised query: '[0.1,0.2,…]'. Only finite numbers get through. */
export function toVectorLiteral(vector: number[]): string {
  if (!vector.every((x) => Number.isFinite(x))) throw new Error("Embedding contains non-finite values");
  return `[${vector.join(",")}]`;
}
