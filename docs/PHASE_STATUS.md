# Phase status

| Phase | Status |
|---|---|
| 1. The foundation | ✅ complete and verified on 2026-10-10 |
| 2. The intelligence | ✅ complete and verified on 2026-10-10 (with Ollama instead of paid APIs) |
| 3. The living city | ⬜ waiting for authorization |

## Phase 2: implemented features

- **Local AI**: qwen3:8b for dialogue and nomic-embed-text for memory, both through Ollama
  (LangChain `ChatOllama` / `OllamaEmbeddings`). Structured output, streaming, real timeouts and
  cancellation, retries, usage tracking, normalised errors. No API keys; estimated cost 0.
- **NPC turn graph** (LangGraph): validate → load state → NPC context → memory retrieval →
  interpret → (plan) → (policy) → execute → respond → consolidate memory → finalize, with
  conditional routing, recursion limit, timeouts, token budget, tool limit, cancellation and
  idempotent replay. The engine is the only writer, after the model calls, in one short
  transaction that re-checks every approved call.
- **Tools**: ten typed Zod tools on top of the engine effects, explicit per-NPC permissions,
  rejection of unknown, unauthorised, malformed, duplicate, excessive and impossible calls.
- **Memory**: pgvector `vector(768)` with HNSW, scoped to player + NPC across investigations,
  similarity/importance/recency ranking, dedup, bounded context, provenance, graceful degradation
  when only embeddings fail, deterministic test embedder.
- **Story rules** that keep the game playable whatever the model proposes; data-driven hints.
- **UI**: streaming replies with the agent's current step and a stop button, honest labels
  (*simulated* or *qwen3:8b · local AI*), AI status in the HUD, and the AgentDebugger (live turn
  and all runs: graph, memories with scores, tool calls and policy, state changes, tokens,
  retries, errors).

## Phase 2: tests executed (2026-10-10)

| Check | Command | Result |
|---|---|---|
| Migrations | `npx prisma migrate status` | 4 migrations, schema up to date |
| Seed | `npm run db:seed` | scenario v2 published next to v1 |
| Typecheck / lint | `npm run typecheck`, `npm run lint` | exit 0, no warnings |
| Unit tests | `npm test` | 33 passed (5 files) |
| Integration tests | `npm run test:integration` | 26 passed, 1 skipped (the live test) |
| Live turn with Ollama | `OLLAMA_LIVE=1 npx vitest run --project integration tests/integration/ollama-live.test.ts` | passed: 15.8 s, 3 model calls, 2 201 + 202 tokens; prompt injection refused, credits unchanged |
| Production build | `npm run build` | exit 0 |
| End-to-end | `npm run test:e2e` | 5 passed (4 desktop incl. the AgentDebugger, 1 phone) |

Also checked by hand in the browser with qwen3:8b: the full Ghost Courier, the reaction to the
shard, Kira, VEX-404's alert, recall in a second investigation (4 memories via nomic-embed-text),
and Ollama unreachable (clear error after 1.9 s, no invented reply, message kept, HUD "AI
offline").

### Found and fixed by playing with the real model

- The reply described the state before the engine ran ("You got a shard") → written from the
  state after `execute`; inventory and evidence are spelled out.
- qwen3 called tools with titles instead of keys (validation correctly refused them) → keys in
  `[brackets]` in the prompt, exact titles normalised to keys.
- The embedding client had no timeout and could hang a turn → bound fetch with timeout and
  cancellation; LangChain's own retries off.
- `ChatOllama` ignores its abort signal until the first chunk and returns partial output quietly →
  requests bound to the signal, interrupted calls never accepted.
- VEX-404 quoted a wrong alert level; Balthazar mixed an earlier case with the present → prompt
  rules for numbers and earlier-case memories.

## Phase 2: known limitations (non-critical)

- **Speed**: 15–30 s per turn on the development Mac (3 calls to an 8B model). Small talk is faster
  (2 calls). A smaller or faster model lowers it; the first turn after a pause also loads the model.
- **The model's judgement varies**: Kira raised her trust for "Balthazar sent me" by 5, not the 25
  her friend price needs, so the discount isn't reliable with qwen3 (it is with the mock). The
  quests don't depend on it. NPCs sometimes add colour that isn't in their facts; Phase 3 adds
  stricter knowledge boundaries for the investigation.
- **No LangGraph checkpointer**: every node is persisted as an `AgentStep` with its data, but a
  turn can't be resumed half-way; a failed or cancelled turn is retried as a new turn.
- **Cancelling after `execute`** keeps the committed state change (it is in the `GameEvent`) and
  stores no reply.
- **Reactions to handed-over items** with a model are a separate short run after the give command.
- Rate limits are still in memory per process.

## Phase 2: outstanding issues

- The `npm audit` findings from Phase 1 (via the Prisma CLI) are unchanged.
- `prisma migrate dev` proposes dropping the HNSW index (see AGENTS.md).

## Exact next steps (Phase 3, after authorization)

1. Bounded simulation loop (pause / resume / step) for NPC goals and faction reactions.
2. The Project Genesis investigation: evidence graph, suspects, contradictions, hypotheses,
   multiple endings, solvable without a given NPC's trust.
3. Creator Mode with validation and isolated preview.
4. Debugger: comparison, metrics, retrieval quality, replay.
5. Hardening review and the portfolio release documents.

## Phase 1: implemented features

- **Database**: PostgreSQL 16 with pgvector (docker compose, `127.0.0.1:5435`); Prisma 7 schema with
  scenario content separated from player state; 3 migrations including CHECK constraints and the
  `vector` extension; idempotent seed of the Neon-Babylon opening scenario (3 locations, 3 NPCs,
  3 factions, 5 items, 3 pieces of evidence, 2 quests with 9 objectives).
- **Game engine**: five commands (`travel`, `investigate`, `talk`, `give`, `buy`) in one
  transaction each, with a row lock, idempotency keys, effect validation, data-driven quest
  completion effects, rewards granted exactly once, and server-side prices with a trust discount.
- **NPC turns**: deterministic, clearly labelled mock dialogue; per-NPC policy for proposals;
  every turn stored as an `AgentRun` with seven steps and its tool executions (executed or rejected
  with a reason); NPC memories written for story beats.
- **Accounts**: registration and sign-in with bcrypt, hashed cookie sessions, Origin checks, rate
  limits, audit log entries for sign-ups, sign-ins, failed sign-ins and new investigations.
- **Interface**: cinematic landing page, sign-in and registration, investigations hub, and the
  game dashboard (HUD with credits and a five-step alert meter, location and travel, people here
  with trust and suspicion, chat terminal with suggestions and give/buy actions, quest journal,
  inventory, evidence with provenance, city feed). Phone layout with bottom navigation.

## Playable flow (verified in the browser)

1. Register, start an investigation in the Neon Slums (80 credits, a cyberdeck).
2. Talk to Balthazar: he offers "The Ghost Courier".
3. Investigate the Slums: evidence "Scorched Courier Badge", items "Encrypted Memory Shard" and
   synth-noodles. Optionally show Balthazar the badge (+5 trust).
4. Give him the shard: quest complete, +150 credits, Bazaar Pass, the Cyber-Bazaar unlocks,
   Rustborn reputation +10, evidence "Decrypted Shard Log", next quest "Follow the Signal".
5. Travel to the Cyber-Bazaar, tell Kira "Balthazar sent me." (trust +25, price 120 → 95), buy the
   Signal Decoder: quest complete, +60 credits, world event "The signal points to Aether Tower".
6. Talking to VEX-404 about restricted topics raises the security alert (bounded at 5); from
   alert 3 Kira refuses to trade.
7. Reload at any point: everything is restored from the database.

## Tests executed (2026-10-10)

| Check | Command | Result |
|---|---|---|
| Migrations on an empty database | `prisma migrate deploy` on a temporary `promptcraft_verify` database (removed afterwards) | 3 migrations applied, schema up to date |
| Seed, twice | `tsx prisma/seed.ts` | first run seeded v1, second run left it unchanged |
| `prisma generate` without `DATABASE_URL` | `env -u DATABASE_URL npx prisma generate` | exit 0 |
| Typecheck | `npm run typecheck` | exit 0 |
| Lint | `npm run lint` | exit 0, no warnings |
| Unit tests | `npm test` | 15 passed (2 files) |
| Integration tests | `npm run test:integration` | 11 passed (2 files) |
| Production build | `npm run build` | exit 0 |
| End-to-end | `npm run test:e2e` | 4 passed (3 desktop, 1 phone) |
| Fresh clone | `git clone`, `npm ci`, typecheck, lint, unit, integration, build, e2e | all passed; found that `typecheck` needed `next typegen` first (fixed) |

The integration and e2e tests run against `promptcraft_test`, never against the development
database.

## Known limitations (non-critical)

- **Dialogue is a script.** The mock recognises topics by keywords and game state. It is
  deterministic by design and labelled as simulated everywhere; free-form understanding comes
  with Phase 2.
- **No AgentDebugger UI yet.** Runs, steps and tool executions are stored but only visible in the
  database (Phase 2).
- **No streaming.** Chat replies arrive with the command response (Phase 2: SSE).
- **Rate limits are in memory** per server process; multiple instances need a shared store.
- **No password reset or email verification**, and no way to delete or abandon an investigation
  from the UI yet.
- **Only two quests.** The story stops at the teaser "The signal points to Aether Tower"; Aether
  Tower stays locked until Phase 3.

## Outstanding issues

- `npm audit --omit=dev` reports 4 high findings, all in packages that `@prisma/client` pulls in
  through the Prisma CLI: `deepmerge-ts` (only used when the CLI loads our own `prisma.config.ts`)
  and `mysql2` (a MySQL driver the app never loads; it uses the PostgreSQL adapter). npm's
  suggested fix is a downgrade to Prisma 6, which isn't appropriate. Re-check on the next Prisma
  release. The prisma and shadcn CLIs were moved to devDependencies, which removed 7 other
  findings.
- npm 11 can drop platform-specific optional packages from the lockfile when packages are added
  or removed (npm/cli#4828); see `AGENTS.md` for the fix.

## Phase 1: next steps at the time (done in Phase 2)

1. Decide the model providers (see "Decisions" in `IMPLEMENTATION_PLAN.md`).
2. Add the provider abstraction next to the mock, with timeouts, retries, usage tracking and
   normalised errors, and no silent fallback.
3. Split an NPC turn into read → model call → short write transaction, and build it as a
   LangGraph graph with the nodes from the plan.
4. Embeddings for `NPCMemory` (fixed dimension, HNSW index), retrieval with recency/importance
   ranking, consolidation, and a deterministic test embedder.
5. Typed tools on top of the existing effects and policy.
6. AgentDebugger UI with SSE.
