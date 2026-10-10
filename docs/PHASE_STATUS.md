# Phase status

| Phase | Status |
|---|---|
| 1. The foundation | ✅ complete and verified on 2026-10-10 |
| 2. The intelligence | ⬜ waiting for authorization |
| 3. The living city | ⬜ not started |

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

## Exact next steps (Phase 2, after authorization)

1. Decide the model providers (see "Decisions" in `IMPLEMENTATION_PLAN.md`).
2. Add the provider abstraction next to the mock, with timeouts, retries, usage tracking and
   normalised errors, and no silent fallback.
3. Split an NPC turn into read → model call → short write transaction, and build it as a
   LangGraph graph with the nodes from the plan.
4. Embeddings for `NPCMemory` (fixed dimension, HNSW index), retrieval with recency/importance
   ranking, consolidation, and a deterministic test embedder.
5. Typed tools on top of the existing effects and policy.
6. AgentDebugger UI with SSE.
