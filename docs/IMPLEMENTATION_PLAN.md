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
| LangChain.js / LangGraph.js (current APIs) | ⬜ | Phase 2 |

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

## Phase 2: the intelligence (not started)

| Requirement | Status |
|---|---|
| Provider abstraction (models, structured output, streaming, timeouts, retries, usage, errors, cost estimates); keys server-side; mock kept; no silent fallback | ⬜ |
| LangGraph graph: validation → state → NPC context → memory retrieval → intent → action plan → policy → engine → response → memory consolidation → traces, with conditional routing | ⬜ |
| Timeouts, bounded transitions, tool-call limits, token budgets, cancellation, idempotency, checkpoints | ⬜ |
| Structured personalities (already seeded as `NPC.persona`); behaviour from real state | 🟡 data in place; used by the mock only |
| pgvector memory: embeddings, semantic retrieval, recency/importance ranking, filtering, provenance, dedup, bounded context, consolidation, deterministic fallback, cross-session and isolation tests | 🟡 storage, dedup, provenance and per-session isolation exist; no embeddings or retrieval yet |
| Typed Zod tools (`get_inventory`, `inspect_evidence`, `search_known_memories`, `transfer_item`, `transfer_credits`, `unlock_location`, `update_quest`, `change_trust`, `trigger_security_alert`, `record_world_event`) through the engine with explicit permissions | 🟡 effects + policy are the foundation; tool layer not built |
| AgentDebugger with SSE streaming, filtering, expandable traces | 🟡 runs, steps and tool executions are recorded; no UI or streaming |

## Phase 3: the living city (not started)

| Requirement | Status |
|---|---|
| Bounded autonomous simulation with pause/resume/step in development | ⬜ |
| Multi-path Project Genesis investigation: evidence graph, suspects, contradictions, hypotheses, dependencies, optional objectives, faction consequences, multiple endings | ⬜ |
| Creator Mode with validation, separate permissions, isolated preview | 🟡 `UserRole.CREATOR`, immutable versions and `validateScenarioReferences` exist |
| Advanced observability (filters, comparison, metrics, replay) | ⬜ |
| Production hardening review and full test suite | ⬜ |
| Portfolio release docs, diagram, walkthrough, case study | ⬜ |

## Decisions to make before Phase 2

- **Model providers.** The plan names OpenAI and Anthropic. Both are paid. A local provider
  (Ollama) can sit behind the same interface for free, offline play. Which providers to support is
  the owner's decision; the mock stays for tests either way.
