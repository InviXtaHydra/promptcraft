# Screenshots

The images in `docs/screenshots/` are captured from the running app by a Playwright script, not
drawn or edited. They use the scripted NPCs (`DIALOGUE_PROVIDER=mock`), so the chat shows the
*simulated* label; with Ollama the same screens show `qwen3:8b · local AI`.

## Capture them again

```bash
docker compose up -d
npx playwright install chromium        # first time only
npm run build
CAPTURE_SCREENSHOTS=1 npx playwright test screenshots --project desktop
```

Playwright starts the production build on port 3101 against the **test** database (never your own
save games), plays the opening, opens the debugger, pins a theory and opens Creator Mode, saving:

| File | Shows |
|---|---|
| `01-landing.png` | The landing page |
| `02-game.png` | The game after the first conversation and a search: HUD, city panel, chat, journal |
| `03-agent-debugger.png` | The live turn in the Agent debugger: graph nodes, tools, policy |
| `04-metrics.png` | Metrics: measured latency and tokens, estimated cost, tools, retrieval |
| `05-case-board.png` | The case board with the evidence network, suspects and a pinned theory |
| `06-creator-mode.png` | The Creator Mode editor with the NPC form and validation panel |

Viewport: 1440 × 900 (the `desktop` project in `playwright.config.ts`).

## Capturing by hand

For shots with the real model, run `npm run dev` with Ollama, play to the screen you want, and use
the browser's screenshot tool at a 1440 × 900 window. Keep the AI label visible so the image shows
honestly which mode produced it.
