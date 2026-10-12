# Deployment

**Status: not deployed.** PromptCraft runs locally, and that is the only setup that has been
tested. This page describes what a deployment needs; none of it has been carried out.

## What runs where

| Part | Requirement |
|---|---|
| App | Node.js 24, `npm run build && npm run start` (Next.js 16 production server; port 3100 by default) |
| Database | PostgreSQL 16 with the `vector` extension (pgvector). The repository's `docker-compose.yml` uses `pgvector/pgvector:pg16` |
| AI | An Ollama server with `qwen3:8b` and `nomic-embed-text`, reachable from the app at `OLLAMA_URL`. An 8B model needs roughly 6 GB of memory; a GPU makes turns much faster |

The app works without Ollama in scripted mode (`DIALOGUE_PROVIDER=mock`,
`EMBEDDING_PROVIDER=hash`), which is labelled *simulated* in the interface. That is a reasonable
mode for a public demo where no model server is available.

## Steps

1. Provision PostgreSQL with pgvector and create the database.
2. Set the environment (see `.env.example`): `DATABASE_URL`, `DIALOGUE_PROVIDER`,
   `EMBEDDING_PROVIDER`, `OLLAMA_URL`, and `APP_ORIGIN` if the app is behind a proxy whose
   public origin differs from the request URL (the CSRF Origin check compares against it).
3. `npm ci`, then `npm run db:deploy` (migrations) and `npm run db:seed` (scenario content;
   idempotent, never touches player data).
4. `npm run build`, then `npm run start` behind HTTPS (session cookies are `Secure` in production).
5. Give your own account the admin or creator role: `npm run user:role -- you@example.com ADMIN`.

## Before going public

- **Rate limits** are in memory, per process. With more than one instance, move them to a shared
  store (for example Redis).
- **Simulation controls** (pause, resume, step) are refused in production unless the user is a
  creator or admin.
- Add a **Content Security Policy** with nonces (see [SECURITY.md](SECURITY.md#open-items)).
- **Ollama has no authentication**. Keep it on a private network, reachable only by the app.
- Back up the database: save games and NPC memories live there.

## Serverless hosting

A serverless platform can host the Next.js app and a managed PostgreSQL with pgvector, but not the
model: Ollama needs a long-running machine (ideally with a GPU), reachable from the functions.
NPC turns stream for 15–30 seconds with qwen3:8b on a laptop, so the function duration limit must
allow that.
