<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# PromptCraft: working agreement for agents and contributors

PromptCraft: Neon-Babylon 2099 is a cyberpunk investigation RPG. Read `docs/ARCHITECTURE.md` before
changing the engine, and keep `docs/PHASE_STATUS.md` and the checklist in
`docs/IMPLEMENTATION_PLAN.md` up to date when you finish something.

## Commands

| What | Command |
|---|---|
| Database (pgvector, port 5435) | `docker compose up -d` |
| Apply migrations / create one | `npm run db:deploy` / `npm run db:migrate -- --name <name>` |
| Regenerate the Prisma client | `npm run db:generate` (Prisma 7 does **not** do this after `migrate dev`) |
| Seed scenario content | `npm run db:seed` (idempotent; never touches player data) |
| Dev server | `npm run dev` → http://localhost:3100 |
| Checks | `npm run typecheck`, `npm run lint`, `npm test`, `npm run test:integration`, `npm run build`, `npm run test:e2e` |
| Live AI check | `OLLAMA_LIVE=1 npx vitest run --project integration tests/integration/ollama-live.test.ts` (needs Ollama) |

## Non-negotiable rules

1. **The engine is authoritative.** Game state changes only through `applyEffects`
   (`src/server/engine/apply.ts`), inside the transaction opened by `executeCommand`. Never write
   player-state tables from routes, components or dialogue code.
2. **NPCs propose, the engine decides.** Anything a dialogue provider (mock or model) suggests goes
   through `checkProposals` (`policy.ts`) and then `applyEffects`. Credits, items and locations are
   reserved for engine commands.
3. **Never trust the client.** Clients send commands (intent + content keys) and an idempotency
   key. Prices, rewards and permissions are computed on the server.
4. **Ownership everywhere.** Load save games with `loadSessionContext(db, sessionId, userId)`.
   Another player's session must look exactly like a missing one (404).
5. **Honesty about AI.** The mock provider is labelled simulated in the database (`isSimulated`)
   and in the UI. Never present scripted output as model output, and never silently fall back from
   a real model to the mock. A failed model call fails the run; no line is invented.
6. **No hidden reasoning in traces.** Agent steps store short decision summaries and structured
   data only.
7. **Secrets stay server-side.** `.env` is git-ignored; `.env.example` holds placeholders only.
   Don't log request bodies, passwords, tokens or cookies.
8. **Don't claim what you didn't verify.** Run the relevant checks and report their real output.
9. **Models never run inside a database transaction.** In the NPC turn graph only `execute`
   writes game state, after the model calls, and it re-checks every approved call.
10. **Local AI only.** The owner chose Ollama; don't add paid providers without asking.

## Data

- Scenario content is immutable per `ScenarioVersion`; save games are pinned to their version.
  To change content, raise `version` in `src/content/neon-babylon.ts` and seed again.
- Effects and scenario content are validated with Zod (`effects.ts`, `scenario-schema.ts`);
  `validateScenarioReferences` must report no errors.
- Bounds (trust −100…100, suspicion 0…100, alert 0…5, credits ≥ 0) live in `BOUNDS` and in CHECK
  constraints in the first migration. Change both together.
- The HNSW index `NPCMemory_embedding_hnsw_idx` can't be expressed in the Prisma schema, so
  `migrate dev` / `migrate diff` propose `DROP INDEX "NPCMemory_embedding_hnsw_idx"`. Delete that line
  from any new migration.
- `prisma migrate reset` deletes data; Prisma blocks it for agents without explicit user consent.
  Don't work around that.

## Tests

- Unit tests (`tests/unit`) need no database. Integration tests (`tests/integration`) and e2e
  (`e2e/`) run against `TEST_DATABASE_URL`, which must be a separate database with "test" in its
  name; the setup refuses anything else and wipes only that database's users.
- Every engine rule gets an integration test: rewards once, idempotency, ownership, bounds.

## Known tooling quirk

npm 11 can drop platform-specific optional packages (rolldown, lightningcss) from the lockfile
when you add or remove a package (npm/cli#4828). Vitest then fails with "Cannot find native
binding". Fix: `rm -rf node_modules package-lock.json && npm install`, and check that
`package-lock.json` contains `node_modules/@rolldown/binding-*` entries before committing.
