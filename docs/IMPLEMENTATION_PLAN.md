# Implementation plan and requirements checklist

Three phases, each completed, tested and documented before the next starts. Status legend:
✅ done and verified · 🟡 partly done (see note) · ⬜ not started.

## Global rules

| Requirement | Status | Where |
|---|---|---|
| AGENTS.md, ARCHITECTURE.md, IMPLEMENTATION_PLAN.md, PHASE_STATUS.md | ✅ | `AGENTS.md`, `docs/` |
| TypeScript strict, Zod, Prisma, PostgreSQL, automated tests | ✅ | `tsconfig.json` (`strict`), `prisma/`, `tests/`, `e2e/` |
| Current, non-deprecated APIs (Next.js 16.4, Prisma 7, Zod 4) | ✅ | versions checked before installing; Next's bundled docs followed for Cache Components |
| Engine authoritative; AI can only propose | ✅ | `src/server/engine/apply.ts`, `policy.ts` |
| Secrets server-side; authorization on all player state | ✅ | `src/server/auth.ts`, `loadSessionContext` |
| Deterministic mock provider, clearly labelled | ✅ | `src/server/dialogue/mock.ts`, chat UI label |
| No hidden chain-of-thought in traces | ✅ | `AgentStep.summary` is a one-line decision summary |
| LangChain.js / LangGraph.js (current APIs) | ✅ | `@langchain/langgraph` 1.4, `@langchain/core` 1.2, `@langchain/ollama` 1.3 |

## Phase 1: the foundation

| Requirement | Status | Notes |
|---|---|---|
| Next.js App Router, React, strict TS, Tailwind, shadcn/ui, Lucide, Framer Motion (`motion`) | ✅ | |
| Prisma schema with all listed models and relations | ✅ | plus `AuthSession`, `LocationAccess`, `QuestState`, `ObjectiveProgress`, `DiscoveredEvidence`, `LocationLoot`, `CollectedLoot`, `MerchantOffer` for per-session state |
| Indexes, unique constraints, timestamps, ownership, deletion rules | ✅ | cascades from `User`/`GameSession`; `Restrict` on content referenced by saves |
| NPCMemory prepared for pgvector | ✅ | `vector` extension + `embedding vector` column, `contentHash`, `provenance` |
| Migrations, seed, documented setup | ✅ | 3 migrations; idempotent seed; README |
| Seed: Neon Slums, Cyber-Bazaar, Aether Tower, Balthazar, Kira, VEX-404, quests, items, evidence, opening scenario | ✅ | `src/content/neon-babylon.ts` |
| Engine: credits, inventory, locations, quests/objectives, evidence, trust/suspicion, reputation, alert, world events | ✅ | |
| Validated, authorized, persisted mutations in transactions; no duplicate rewards; no client state | ✅ | row lock + idempotency keys + `rewardGrantedAt` |
| UI: landing, dashboard, HUD, NPC selection, chat terminal, inventory, quest journal, evidence, navigation, responsive, design system | ✅ | |
| Mock dialogue; complete an intro quest with Balthazar | ✅ | "The Ghost Courier", then "Follow the Signal" |
| Start, explore, converse, discover a clue, collect an item, update quests, persist, reload | ✅ | covered by `e2e/opening-quest.spec.ts` |
| Verification: migrations, seed, typecheck, lint, unit, integration, build, Playwright | ✅ | results in `docs/PHASE_STATUS.md` |

## Phase 2: the intelligence

Decision by the owner: **Ollama (local, free) instead of the paid OpenAI/Anthropic APIs**. The
provider abstraction keeps the same shape, so another provider can be added later.

| Requirement | Status | Notes |
|---|---|---|
| Provider abstraction: model selection, structured output, streaming, timeouts, retries, usage, error normalisation, cost estimates; credentials server-side; mock kept; no silent fallback | ✅ | `src/server/ai/`; Ollama + mock; no credentials exist (local); cost estimate 0 (local) |
| OpenAI and Anthropic | ⛔ | replaced by Ollama at the owner's request |
| LangGraph graph with the eleven nodes and conditional routing | ✅ | `src/server/agents/npc-turn.ts`; small talk skips plan + policy |
| Timeouts, bounded transitions, tool-call limits, token budget, cancellation, idempotency | ✅ | per call / per turn timeouts, recursion limit 14, 6 tools, 16k tokens, AbortSignal, idempotency key per turn |
| Persist checkpoints and execution metadata | ✅ | one `AgentStep` per node with structured data; run metadata on `AgentRun`. No LangGraph checkpointer: a turn is short and not resumed, see PHASE_STATUS |
| Structured personalities; behaviour from real state; no access to other NPCs' private memories | ✅ | `NPC.persona`, `npc-context.ts`, secrets gated by trust |
| pgvector memory: embeddings, dimensions, parameterised vector queries, semantic retrieval, recency/importance ranking, NPC + session filtering, provenance, dedup, bounded context, validated consolidation, deterministic fallback | ✅ | `src/server/agents/memory.ts`, `HashEmbedder` |
| Memories survive restarts and follow the player across investigations; isolation tests | ✅ | integration tests |
| Typed Zod tools through the engine with explicit permissions; reject unauthorised, malformed, duplicate, impossible calls; no code, SQL, shell or external requests | ✅ | `tools.ts` + `policy.ts`; all ten tools |
| AgentDebugger: run id, nodes and transitions, status, memories with scores, tool proposals and validated args, policy decisions, results, state changes, tokens, latency, retries and errors, provider and model; expandable, filterable, streaming, empty and error states | ✅ | `agent-debugger.tsx`, SSE |
| Verification | ✅ | see PHASE_STATUS |

## Phase 3: the living city

| Requirement | Status | Notes |
|---|---|---|
| Bounded autonomous simulation: permission-checked, through the engine, recorded as world events, idempotent; pause/resume/step in development; no loops or model calls | ✅ | `simulation.ts`; every N turns, budget per tick, one action per actor |
| Multi-path Project Genesis: evidence provenance and links, suspects, contradictory testimony, hypotheses, quest dependencies, optional objectives, faction consequences, multiple endings | ✅ | `investigation.ts`, scenario v4; six endings |
| Solvable without an NPC's trust; NPCs don't reveal what they don't know; outcome from evidence and choices | ✅ | two routes into the tower; secrets gated by trust; `chooseEnding` |
| Creator Mode: NPCs, goals, locations, items, quests, evidence, tools, initial state, simulation parameters; validation first; separate permissions; isolated preview | ✅ | `src/server/creator/`, `/creator` |
| Advanced observability: run filters, comparison, tool metrics, retrieval quality, cost and latency (measured vs estimated), simulation history, safe replay | ✅ | `metrics.ts`, debugger tabs |
| Production hardening review; unit, integration, security, e2e tests | ✅ | `docs/SECURITY.md`; open items listed there |
| Portfolio release: README, `.env.example`, docs, seeded demo, diagram, checklist, screenshots, case study, walkthrough | ✅ | `README.md`, `docs/` |

## Decisions

- **Model providers (2026-10-10):** Ollama only (qwen3:8b for dialogue, nomic-embed-text for
  memory), free and local. The mock provider stays for tests and offline play.
- **Simulation without models (2026-10-11):** NPC autonomy is authored as data-driven
  intentions, not generated, so it stays bounded, testable and free.
- **Creator Mode as JSON definitions (2026-10-11):** a draft is the scenario's JSON; it is validated
  by the same schema as the seed and materialised into a new immutable version.
