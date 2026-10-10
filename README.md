# PromptCraft: Neon-Babylon 2099

A cyberpunk investigation RPG where NPCs want things, remember what you did, and answer to a game
engine they can't talk their way around.

A courier vanished in the Neon Slums with a memory shard nobody there should have. Find the trail,
bring the cargo back to Balthazar, and follow the signal through the Cyber-Bazaar toward Aether
Tower, guarded by the security intelligence VEX-404.

> **Status: Phase 2 of 3.** NPCs are voiced by a **local language model** (qwen3:8b in Ollama)
> through a LangGraph agent, with long-term memory in pgvector and an agent debugger. Everything
> runs on your machine, free, without API keys. A deterministic scripted mode (labelled
> "simulated") is used for tests. See [`docs/PHASE_STATUS.md`](docs/PHASE_STATUS.md).

## What's in it

- **Authoritative game engine**: credits, inventory, locations, quests and objectives, evidence,
  trust and suspicion, faction reputation, security alert and world events. Every change is
  validated on the server and applied in one transaction; rewards can't be claimed twice.
- **NPCs that propose, never decide**: each NPC has explicit permissions; every turn is recorded
  as a trace of proposed, rejected and executed actions.
- **Persistent save games** per player in PostgreSQL, with pgvector ready for NPC memory.
- **A playable opening**: "The Ghost Courier" (Balthazar) and "Follow the Signal" (Kira, VEX-404).
- **A premium dark neon interface**: landing page, HUD, chat terminal, quest journal, inventory,
  evidence board, city feed, phone layout.
- **AI NPCs (Phase 2)**: a LangGraph turn per message (interpret → plan → policy → engine → reply),
  ten typed tools the engine validates, story rules that keep the game playable, streaming replies.
- **Memory**: NPCs remember you across investigations (pgvector, nomic-embed-text), ranked by
  relevance, importance and recency, strictly per player and per NPC.
- **AgentDebugger**: every turn's graph, recalled memories, tool calls, policy decisions, state
  changes, tokens and latency, live while it streams.

## Tech stack

Next.js 16 (App Router, Cache Components) · React 19 · TypeScript (strict) · Tailwind CSS 4 ·
shadcn/ui (Base UI) · Lucide · Motion · PostgreSQL 16 + pgvector · Prisma 7 · Zod 4 ·
LangGraph.js + LangChain (Ollama) · Vitest · Playwright.

## Getting started

Requirements: Node.js 24, Docker, and [Ollama](https://ollama.com) for the AI NPCs.

```bash
ollama pull qwen3:8b              # dialogue (about 5 GB; 16 GB RAM recommended)
ollama pull nomic-embed-text      # NPC memory embeddings (about 270 MB)
cp .env.example .env              # then set POSTGRES_PASSWORD and the same password in both URLs
docker compose up -d              # PostgreSQL + pgvector on 127.0.0.1:5435 (+ a test database)
npm install                       # also generates the Prisma client
npm run db:deploy                 # apply the migrations
npm run db:seed                   # the Neon-Babylon scenario (safe to run again)
npm run dev                       # http://localhost:3100
```

Create an account, start an investigation, and talk to Balthazar. The HUD shows whether the local
AI is ready. A turn takes roughly 15–30 seconds with qwen3:8b on a laptop; the reply streams in
while the NPC thinks. Without Ollama, set `DIALOGUE_PROVIDER=mock` and `EMBEDDING_PROVIDER=hash`
in `.env` to play with the scripted NPCs.

The app uses port 3100 and the database 5435 so it can run next to other local projects.

## Scripts

| Script | What it does |
|---|---|
| `npm run dev` / `build` / `start` | Development server, production build, production server (port 3100) |
| `npm run typecheck` | Generate the Prisma client and run `tsc` |
| `npm run lint` | ESLint |
| `npm test` | Unit tests (no database) |
| `npm run test:integration` | Engine tests against `TEST_DATABASE_URL` |
| `npm run test:e2e` | Playwright against a production build on the test database |
| `OLLAMA_LIVE=1 npx vitest run --project integration tests/integration/ollama-live.test.ts` | One real turn with qwen3 (needs Ollama) |
| `npm run db:migrate` | Create a migration in development (`-- --name <name>`) |
| `npm run db:deploy` / `db:seed` / `db:generate` | Apply migrations / seed / regenerate the client |

The test commands use the separate `promptcraft_test` database (created by
`docker/postgres-init`) and refuse to run against anything else. First Playwright run:
`npx playwright install chromium`.

## Project structure

```text
prisma/                 schema, migrations, seed script
src/
  app/                  pages (landing, auth, play) and API route handlers
  components/           landing, auth, game UI; ui/ = shadcn components
  content/              the scenario as typed data + Zod schema and reference checks
  server/
    engine/             commands, effects, policy, quests, views
    agents/             LangGraph NPC turn, brains, tools, memory, story rules, traces
    ai/                 Ollama chat model and embedders, config, errors
    dialogue/           the deterministic mock script
    auth.ts, http.ts    sessions, Origin checks, rate limits, error mapping
tests/                  unit and integration tests (Vitest)
e2e/                    browser tests (Playwright)
docs/                   architecture, implementation plan, phase status
```

## Documentation

- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md): layers, data model, engine, policy, security.
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md): the three phases and the
  requirements checklist.
- [`docs/PHASE_STATUS.md`](docs/PHASE_STATUS.md): what is verified, test results, limitations,
  next steps.
- [`AGENTS.md`](AGENTS.md): rules for contributors and coding agents.
