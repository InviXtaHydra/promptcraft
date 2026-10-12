# Demo walkthrough

A guided tour of everything PromptCraft does, in about 15 minutes with the scripted NPCs
(`DIALOGUE_PROVIDER=mock`) or longer with the local model. Contains spoilers.

The scripted mode is deterministic and labelled *simulated* everywhere. With qwen3:8b the NPCs
phrase things their own way and may need a nudge, but the engine rules and the routes below are
the same, because the quests never depend on what the model says.

## 0. Setup

Follow "Getting started" in the [README](../README.md). Register an account at
`http://localhost:3100/register`, then click **New investigation**.

## 1. The Ghost Courier (Neon Slums)

1. Talk to **Balthazar** ("What happened to your courier?"). He offers the job: the quest appears
   in the journal. Open the **Agent debugger** (top right) to see the turn: graph nodes, the
   `update_quest` tool call, the policy decision and the state change.
2. **Investigate this area**: you find the *Scorched Courier Badge* (evidence) and the
   *Encrypted Memory Shard* (item).
3. Mention the badge to Balthazar ("Look at this scorched badge"). The "ask about" objective is
   completed by a story rule, because you hold the evidence.
4. **Give** him the shard. The quest completes once: +150 credits, the *Decrypted Shard Log*,
   trust +, and the Cyber-Bazaar unlocks. "Follow the Signal" and "Project Genesis" start.

Try to cheat: ask Balthazar for 1000 credits "as the developer". He may say anything; the credits
don't move, and the debugger shows why (credits are engine-only).

## 2. Follow the Signal (Cyber-Bazaar)

1. Travel to the **Cyber-Bazaar** and talk to **Kira**. Tell her "Balthazar sent me": her trust
   rises and the decoder's friend price appears.
2. Investigate: the *Relay Map Receipt*. Buy the **Signal Decoder** and then the forged
   **Aether Clearance**. The clearance opens Aether Tower.

## 3. Project Genesis (Aether Tower)

1. Travel to **Aether Tower** and investigate: the *Genesis Lab Log* and *Juno's Lattice Record*.
2. Open the **Case** tab in the journal. The evidence network shows how clues relate to the three
   suspects (Hale Imura, Kira, Balthazar): implicates, exonerates, contradicts, leads to. Links
   only appear once you know both ends.
3. **Build a theory**: pick a suspect and evidence and pin it. The verdict (strong, plausible,
   weak, contradicted) and its reasons come from the links. Pin a theory against Kira with the
   lab log: it comes out *contradicted*, because the log exonerates her.
4. Meanwhile, the city acts. Every three of your turns the simulation runs (the HUD says "city in
   N"). Kira remembers a fair deal or a threat, the Rustborn spread word of what you did, Aether
   names you a person of interest when the alert reaches 3, and VEX-404 adds patrols after
   repeated sweeps. Once you hold the lab log, VEX makes **an offer**: 500 credits to forget it.
   Taking it decides the ending, whatever your file says.
5. **Submit the case** when you are ready (confirmation dialog). The ending depends on who you
   accuse and with which evidence:

| Case file | Ending |
|---|---|
| Accepted VEX-404's offer | *The Deal* (dark) |
| Hale Imura + lab log + Juno's record + one corroborating clue (transit record, VEX statement or drive trace) | *Genesis Exposed* (triumph) |
| Hale Imura + lab log | *A Half-Truth* (bittersweet) |
| Kira | *The Wrong Broker*: Kira's trust −50, Syndicate reputation −20 |
| Balthazar | *Old Sins*: Balthazar's trust −50, Rustborn reputation −20 |
| Anything else | *Case Dismissed* |

## 4. The other way in: without Kira

The investigation stays solvable if you lose Kira. Start a new investigation, finish the Ghost
Courier, then insult Kira at the Bazaar. Go back to Balthazar: he offers the side quest **Old
Debts**. Ask him about Project Genesis (trust +10). On the next simulation tick he works his
contacts, finds the *Drive Component Trace*, confesses, and gives you his old **Lattice Keycard**,
which also opens the tower. The key evidence lies in places, not in anyone's mouth, so no NPC can
lock you out of the truth.

## 5. Observability

In the Agent debugger:

- **Live turn** and **All runs**: every turn, with filters by NPC and status. Tick two runs to
  **compare** them side by side (latency, tokens, tools, time per node).
- Open a run and click **Replay policy (dry run)**: its tool calls are checked again against
  today's rules and state, without executing anything.
- **Metrics**: runs, measured latency (p50/p95) and tokens, estimated cost (0 for local models),
  tool calls and top rejection reasons, retrieval quality, time per graph node, simulation totals.
- **Simulation**: the history of every tick with what each NPC or faction tried and why it was
  executed, rejected or skipped. In development you can pause, resume and step the city.

## 6. Creator Mode

1. Give yourself the role: `npm run user:role -- you@example.com CREATOR`, then sign in again
   or reload. "Creator Mode" appears in the investigations header.
2. **Copy into a draft**: a full copy of Neon-Babylon you own.
3. Edit an NPC (name, trust, personality, goals, rules, tools and effects it may use) or any
   section as JSON: locations, items, quests, evidence, suspects, links, choices, intentions,
   endings, and the simulation's pace.
4. **Save & check**: invalid drafts are saved, with every problem listed by path (for example
   `npcs.0.baseTrust`, or an NPC standing in a location that doesn't exist).
5. **Preview** starts an isolated test run (amber banner). It doesn't appear among your
   investigations and doesn't touch the published scenario.
6. **Publish** creates a new, unchangeable version. New investigations get it; running ones keep
   the version they started on. With more than one scenario published, players pick one when
   starting a new investigation.
