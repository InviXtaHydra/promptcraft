# Security review

The production-hardening review of Phase 3. Every row names the measure and where it is tested.
"Open" rows are known gaps, not oversights.

## Threat model in one paragraph

Players are untrusted, and so is everything a language model produces. A player can send any
HTTP request, replay or race requests, and write messages designed to make an NPC misbehave
(prompt injection). The model can be fully talked into proposing anything. The design answer is
that neither the client nor the model ever writes state: they send *intents* (commands, tool
calls) that server code validates against the player's own save game and the scenario's rules.

## Review

| Area | Measure | Verified by |
|---|---|---|
| Authentication | bcrypt (cost 12), dummy-hash comparison for unknown emails, 256-bit session tokens in an httpOnly SameSite=Lax cookie (Secure in production), only the SHA-256 hash stored, 14-day expiry | `tests/integration/engine-rules.test.ts`, e2e sign-in redirects |
| Authorization | Every save-game read resolves through `loadSessionContext(db, sessionId, userId)`; another player's session, run, trace or metrics are a 404. Creator routes require `CREATOR`/`ADMIN` (`assertCreator`) and drafts are filtered by author | engine-rules, observability, creator tests; e2e "someone else's game" |
| Creator vs player permissions | Separate role; simulation controls only outside production or for creators/admins; previews are separate `PREVIEW` versions and `isPreview` sessions a player can't start | `creator.test.ts`, `investigation.spec.ts` (403 for players in production) |
| CSRF | SameSite=Lax plus an Origin check (`assertSameOrigin`) on every mutating route; `APP_ORIGIN` behind a proxy | `tests/unit/origin-check.test.ts` |
| Rate limits | Register, login (email + IP), commands, talk, new sessions, simulation steps, creator fork/save/preview/publish | `http.ts`; limits per route |
| Input validation | Zod on every body; content keys `[a-z0-9-]`, messages 1–500 characters, theories ≤ 8 evidence, drafts ≤ 400 KB; strict tool argument schemas (extra fields rejected) | unit `tools.test.ts`, creator test (too large, not an object) |
| Prompt injection | NPCs propose tool calls; code checks tool name, per-NPC permission, arguments, duplicates, counts, per-turn totals and the engine policy. Credits, items and locations are engine-only. The player message is only ever a `user` message, never part of the system prompt | `security.test.ts` (a fully hijacked brain: all seven calls refused), live test with qwen3 |
| Tool enforcement | No tool runs code, SQL, shell commands or network requests; read tools only return this NPC's view | `tools.test.ts`, `security.test.ts` (`run_sql` → unknown tool) |
| Transactions | One transaction per command with `SELECT … FOR UPDATE` on the session's world state; models never run inside a transaction; `execute` re-checks every approved call | engine-rules (simultaneous deliveries) |
| Duplicates / idempotency | Idempotency key per command, per turn and per simulation tick (`SimulationTick` unique on session + key and session + tick); rewards flip `rewardGrantedAt` once; one case file per session; a choice can be made once | engine-rules, simulation, investigation tests |
| Memory isolation | Vector queries filter on player, NPC and embedding model in SQL; another player's memories never reach a prompt or a trace | agent-graph and `security.test.ts` |
| Log redaction | `src/server/log.ts`: sensitive keys dropped, credentials in URLs, bearer tokens, session cookies and emails scrubbed; player messages never logged | `tests/unit/log-redaction.test.ts` |
| Secrets | `.env` git-ignored; `.env.example` holds placeholders; there are no API keys (local models only) | repository |
| Cancellation | Closing the stream aborts the turn; the abort reaches the HTTP request to Ollama; nothing changes before `execute` | agent-graph tests (cancellation) |
| Budgets | Per-call and per-turn timeouts, 16 000 tokens per turn, 6 tool calls, LangGraph recursion limit, at most N simulation actions per tick and one per actor, no model calls in the simulation | agent-graph, simulation tests |
| Hidden reasoning | qwen3 thinking off; any `<think>` text is held back from players and traces; traces store one-line summaries | unit `ollama-chat.test.ts` |
| Honest AI labels | The mock is labelled simulated in the database and UI; no silent fallback from the model to the mock | e2e, agent-graph tests |
| HTTP headers | `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, no `X-Powered-By` | `next.config.ts`; `curl -I` against the production build |
| Accessibility | Labels on all controls, focus outlines, live regions for loading and results, dialogs for confirmations, axe-core WCAG 2.1 AA checks | `e2e/accessibility.spec.ts` |
| Mobile | Bottom navigation, no horizontal scroll | `e2e/mobile.spec.ts` |
| Loading and error states | Skeletons, `aria-busy`, explicit errors with a next step (sign in, retry, "AI offline") | e2e, manual |

## Open items

- **Content Security Policy**: not set. Next.js inline scripts need per-request nonces, which
  would make every page dynamic. Worth adding for a public deployment.
- **Rate limits are per process** (in memory). Several instances need a shared store (Redis).
- **No password reset or email verification.**
- **`npm audit`** reports findings in the Prisma CLI's dependency tree (development tooling, not
  shipped to the browser).
- **Creator content is trusted text**: creators write NPC personas that go into prompts. A
  malicious creator could write a persona that misbehaves, but the engine checks still apply to
  everything that NPC proposes, so it can't do more than its permissions allow.
