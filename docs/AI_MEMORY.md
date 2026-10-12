# AI and memory

How the NPCs think, what they may know, and how they remember. For the full turn graph see
[ARCHITECTURE.md](ARCHITECTURE.md#the-npc-turn-graph-phase-2).

## Models

Everything runs locally through [Ollama](https://ollama.com); there are no API keys.

| Role | Model | Notes |
|---|---|---|
| Dialogue, interpretation, planning | `qwen3:8b` | thinking mode off; structured output through Ollama's JSON-schema `format`, validated with Zod |
| Memory embeddings | `nomic-embed-text` | 768 dimensions |
| Tests and offline play | deterministic script + hashing embedder | labelled *simulated*; never presented as model output |

Measured on the development Mac with qwen3:8b (Phase 2 live test): a turn with three model calls
took 15.8 s and used 2 201 input and 202 output tokens. Turns typically take 15–30 s; small talk
skips the planning call. The cost is reported as an estimate of $0, because local models have no
per-token price (electricity isn't counted).

## What an NPC may know

`buildNpcContext` (`src/server/agents/npc-context.ts`) assembles, per turn:

- the NPC's persona: personality, background, voice, goals, beliefs, *uncertainties* and
  behavioural rules;
- **secrets only above their trust threshold** (`revealAtTrust`), so a secret can't be talked out
  of an NPC that doesn't trust you yet;
- facts derived from the game state that concern this NPC (your standing, what you carry that it
  can see, quests it is part of), with content keys in `[brackets]`;
- its own memories of you (below), the last eight messages, its permitted tools and story hints.

Never: other NPCs' memories, other players' data, or evidence you haven't found. The persona's
`knownFacts` and `uncertainties` mark what the NPC does *not* know, so it can say so instead of
inventing. In the investigation the key evidence lies in locations, so the truth never depends on
an NPC choosing to tell it.

## The turn

```text
interpret (structured) → plan tool calls (structured, only when needed) → policy check (code)
  → execute (engine, one transaction) → respond (streamed, from the state after execute)
  → consolidate memory
```

The model never writes state. It proposes tool calls; code checks each one (tool known, permitted
for this NPC, arguments valid, no duplicates, within limits, allowed by the engine policy) and the
engine applies the effects. The reply is generated *after* the engine ran, from the resulting
state, so an NPC can't claim to have given you something it didn't.

## Long-term memory

`NPCMemory` rows belong to **one player and one NPC** and follow the player across
investigations. Each row has a kind (episodic, semantic, relationship, promise, betrayal,
evidence, negotiation), an importance 1–10, provenance (`run:<id>` or `engine:<event>`), a
content hash, and a `vector(768)` embedding with the name of the model that made it.

### Retrieval

1. Embed the player's message.
2. Parameterised `$queryRaw` with pgvector's cosine distance, filtered in SQL on player, NPC and
   embedding model; 24 nearest neighbours through the HNSW index.
3. Re-rank: `0.55·similarity + 0.25·importance/10 + 0.15·recency + 0.05·same investigation`,
   recency halving every 72 hours.
4. Keep the top 5 within 1 200 characters.

### Consolidation

The interpretation step may produce a memory note. Code validates it (8–300 characters), skips it
if an identical hash or a vector with similarity ≥ 0.92 exists, and stores at most two per turn.
Story beats from the scenario (a `memory` effect on a quest, objective or simulation intention)
are written by the engine in the same transaction and get their vector afterwards. The simulation reads memory *kinds* (for
example, Kira's `NEGOTIATION` or `BETRAYAL` memories) to decide what NPCs do on their own.

### Degradation

If the embedder fails, the NPC answers without memories, the trace says "Skipped", and new
memories wait for their vector. If the dialogue model fails, the run fails visibly: no line is
invented and the mock is never used as a silent fallback.

## Measuring it

The AgentDebugger's **Metrics** tab reports, per investigation, from stored traces: turns with
memories, average memories recalled, average top similarity and average score, plus the
"unavailable" count. Each run's detail shows the recalled memories with similarity and final score.

## Known limits

- An 8B model's judgement varies: it may raise trust less than a friend price needs, or add
  colour that isn't in its facts. Story rules and the engine keep the game playable either way.
- There is no LangGraph checkpointer: every node is stored as an `AgentStep`, but a failed turn
  is retried as a new turn rather than resumed.
