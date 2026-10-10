import { createHash } from "node:crypto";
import type { DialogueContext, DialogueProvider, DialogueReply } from "./types";

/**
 * Deterministic development provider. It is NOT a language model: replies come from a small script
 * that reads the game state (quest progress, evidence, trust, alert level) and the player's words.
 * The same state and message always give the same reply, which keeps tests reproducible. Every reply
 * is stored and shown as simulated.
 */

type Topic = "greet" | "job" | "badge" | "shard" | "genesis" | "aether" | "kira" | "balthazar" | "vex" | "trade" | "transit" | "threat" | "thanks" | "bye";

const TOPICS: [Topic, RegExp][] = [
  ["threat", /\b(kill|hurt|threat|or else|idiot|stupid|shut up|i'?ll end you)\b/],
  ["genesis", /\b(genesis|lattice|ae-?gen|project)\b/],
  ["badge", /\b(badge|scorch\w*|burn\w*|juno)\b/],
  ["shard", /\b(shard|cargo|drive|component|case|memory)\b/],
  ["transit", /\b(transit|gate|log|leave|left|escort\w*)\b/],
  ["trade", /\b(buy|sell|price|decoder|trade|deal|cost|credits|offer)\b/],
  ["balthazar", /\b(balthazar|rust ?& ?relic|sent me)\b/],
  ["kira", /\b(kira|broker)\b/],
  ["vex", /\b(vex|vex-?404)\b/],
  ["aether", /\b(aether|tower|clearance|corp\w*|access|hack\w*|breach)\b/],
  ["job", /\b(job|work|help|task|happened|courier|missing|need|what'?s up)\b/],
  ["thanks", /\b(thanks|thank you|cheers)\b/],
  ["bye", /\b(bye|goodbye|later|see you)\b/],
  ["greet", /\b(hi|hello|hey|yo|greetings|evening|morning)\b/],
];

export function topicsOf(message: string): Set<Topic> {
  const text = message.toLowerCase();
  return new Set(TOPICS.filter(([, re]) => re.test(text)).map(([t]) => t));
}

/** Stable pick from a list of lines, so wording varies without breaking determinism. */
function pick(lines: string[], ...seed: (string | number)[]) {
  const n = createHash("sha256").update(seed.join("|")).digest().readUInt32BE(0);
  return lines[n % lines.length];
}

const reply = (intent: string, summary: string, text: string, proposals: unknown[] = []): DialogueReply => ({ intent, summary, text, proposals });

function balthazar(c: DialogueContext): DialogueReply {
  const t = topicsOf(c.message);
  const q1 = c.questStatus.get("ghost-courier");
  const hasBadge = c.evidence.has("scorched-badge");
  const hasShard = c.inventory.has("encrypted-shard");

  if (t.has("threat")) {
    return reply("threat", "Player was hostile; Balthazar trusts them less.", "Easy, kid. I've had worse people than you in that chair, and I fixed most of them.", [
      { type: "trust", npcKey: "balthazar", delta: -5 },
      { type: "suspicion", npcKey: "balthazar", delta: 5 },
    ]);
  }

  if (!q1) {
    return reply(
      "offer_job",
      "First meeting: Balthazar offers the Ghost Courier job.",
      "Kid. You've got the look of someone who finds things. My courier, Juno, was bringing me a memory-drive component three nights ago. Never showed. Juno always cut through the noodle alley out back. Find the trail, find the cargo, and there's 150 credits in it for you.",
      [
        { type: "quest_start", questKey: "ghost-courier" },
        { type: "memory", npcKey: "balthazar", kind: "PROMISE", content: "The player agreed to look for Juno and the missing cargo.", importance: 6 },
      ],
    );
  }

  if (q1 === "ACTIVE") {
    if (t.has("badge") && hasBadge) {
      const asked = c.objectivesDone.has("ghost-courier/ask-about-badge");
      return reply(
        "ask_about_badge",
        asked ? "Badge already discussed; Balthazar repeats what he knows." : "Player showed Juno's badge; Balthazar identifies the burn marks.",
        asked
          ? "Juno's badge. Stun-lance burns. I already told you who carries those, kid."
          : "...That's Juno's badge. See the burn pattern? Stun lance. Street crews can't afford those. Corporate security can. Aether security.",
        asked ? [] : [{ type: "objective", questKey: "ghost-courier", objectiveKey: "ask-about-badge" }],
      );
    }
    if (t.has("badge")) return reply("ask_about_juno", "Player asked about Juno before finding the badge.", "Juno wore a Rustborn courier badge, always. If you find one in that alley, bring it to me.");
    if (t.has("shard") && hasShard) return reply("shard_found", "Player has the shard; Balthazar asks for it.", "You found it? Don't wave it around. Hand it over and let me take a look.");
    if (t.has("genesis")) return reply("ask_genesis_unknown", "Balthazar doesn't know the name yet.", "Genesis? Never heard of it. Find my cargo first, then we'll talk about fairy tales.");
    if (hasShard) return reply("hint_deliver", "Player has the shard; hint to deliver it.", "Is that a courier case in your pocket? Give it here, kid.");
    if (hasBadge) return reply("hint_cargo", "Badge found, cargo not yet; hint to keep searching.", "If Juno dropped the badge, the cargo can't be far. Search that alley properly.");
    return reply(
      "hint_search",
      "Quest active, nothing found yet; hint to investigate the Slums.",
      pick(
        ["The alley behind the noodle stand. Look there. Properly, not with your eyes half shut.", "Juno's trail starts out back. Investigate the Slums, kid, and don't come back empty-handed."],
        "balthazar",
        c.message.toLowerCase(),
        c.previousPlayerMessages,
      ),
    );
  }

  // Ghost Courier completed
  if (t.has("genesis") || t.has("shard")) {
    const secret = c.npc.persona.secrets[0];
    const tellsSecret = secret !== undefined && c.trust >= secret.revealAtTrust;
    return reply(
      tellsSecret ? "reveal_secret" : "ask_genesis",
      tellsSecret ? "Trust is high enough: Balthazar reveals his past at Aether." : "Balthazar recognises the name but keeps his past to himself.",
      tellsSecret
        ? "Project Genesis. I built the first lattice for them, twelve years ago, before I understood what it was for. Now you know why I left."
        : "Project Genesis. Lattice seed. I haven't heard that name in twelve years, and I hoped I never would again. Go see Kira.",
    );
  }
  if (t.has("kira") || t.has("trade")) return reply("point_to_kira", "Balthazar sends the player to Kira.", "Kira's on the third level of the Bazaar. Tell her Balthazar sent you. She'll pretend not to care.");
  if (t.has("thanks")) return reply("thanks", "Player thanked Balthazar.", "Don't thank me. Bring me good news, that's thanks enough.");
  return reply("point_to_kira", "Quest done; Balthazar points to the next step.", "You've got the pass. The Bazaar is open to you now. Kira can trace where that shard was going.");
}

function kira(c: DialogueContext): DialogueReply {
  const t = topicsOf(c.message);
  const decoder = c.offers.get("signal-decoder");
  const vouched = c.memories.some((m) => m.includes("Balthazar vouched"));

  if (t.has("threat")) {
    return reply("threat", "Player threatened Kira; she trusts them less.", "Cute. Threats are extra, and you just doubled your price.", [
      { type: "trust", npcKey: "kira", delta: -10 },
      { type: "suspicion", npcKey: "kira", delta: 10 },
      { type: "memory", npcKey: "kira", kind: "BETRAYAL", content: "The player threatened Kira at her stall.", importance: 6 },
    ]);
  }
  if (c.alert >= (c.npc.persona.trustThresholds.refuseTradeAtAlert ?? 99)) {
    return reply("refuse_heat", "Security alert is high; Kira refuses to deal.", "Too much heat on you, runner. VEX has every relay lit up. Come back when it cools down.");
  }
  if (t.has("balthazar")) {
    if (c.questStatus.get("ghost-courier") === "COMPLETED" && !vouched) {
      return reply("vouched", "Balthazar's job is done, so his word counts: Kira trusts the player.", "Balthazar sent you? Then you're the one who brought Juno's shard home. Fine. Friends of Rust & Relic get the friend price.", [
        { type: "trust", npcKey: "kira", delta: 25 },
        { type: "memory", npcKey: "kira", kind: "RELATIONSHIP", content: "Balthazar vouched for the player.", importance: 7 },
      ]);
    }
    return reply("balthazar", vouched ? "Already vouched for." : "Balthazar's name alone isn't enough yet.", vouched ? "I heard you the first time. You're on the friend list." : "Everyone in the Slums says Balthazar sent them. Prove it.");
  }
  if (t.has("trade") && decoder) {
    if (c.inventory.has("signal-decoder")) return reply("trade_done", "Player already owns the decoder.", "You already have my decoder. Treat it well, it's prettier than you.");
    return reply(
      "offer_decoder",
      `Kira offers the decoder for ${decoder.price} credits${decoder.discounted ? " (friend price)" : ""}.`,
      `The Signal Decoder follows a data trail back to whatever it came from. ${decoder.price} credits${decoder.discounted ? ", friend price" : ""}. Pay at the stall when you're ready.`,
    );
  }
  if (t.has("transit") || t.has("badge")) {
    return reply("hint_transit", "Kira hints at the Syndicate gate logs.", "Every courier leaving the Bazaar passes the Syndicate gate, and the gate logs everyone. Have a look around, if you know where to look.");
  }
  if (t.has("genesis") || t.has("aether") || t.has("vex")) {
    return reply("warn_vex", "Player mentioned Aether openly; Kira grows wary.", "Keep your voice down. VEX listens to every public relay in this market.", [{ type: "suspicion", npcKey: "kira", delta: 5 }]);
  }
  if (c.previousPlayerMessages === 0) {
    return reply("greet_first", "First meeting with Kira.", "New face. Balthazar's pass, by the look of it. Everything here has a price, runner, including my time. What are you buying?");
  }
  return reply("small_talk", "Kira waits for a concrete question.", pick(["Talk is cheap. Data isn't.", "Ask a real question, runner. The meter's running."], "kira", c.message.toLowerCase(), c.previousPlayerMessages));
}

function vex(c: DialogueContext): DialogueReply {
  const t = topicsOf(c.message);
  if (t.has("genesis") || t.has("aether") || t.has("badge") || t.has("shard")) {
    const next = Math.min(5, c.alert + 1);
    return reply(
      "restricted_query",
      "Player referenced restricted material; VEX-404 raises the alert by one level.",
      c.alert >= 5
        ? "1. Lockdown is in effect. 2. All relays are recording. 3. Please remain where you are."
        : "1. Your query references restricted material. 2. This interaction has been logged. 3. Security alert level has been raised.",
      [
        { type: "suspicion", npcKey: "vex-404", delta: 15 },
        { type: "alert", delta: 1 },
        { type: "faction", factionKey: "aether-dynamics", delta: -5 },
        {
          type: "world_event",
          key: `vex-sweep-${next}`,
          title: `Aether security sweep (level ${next})`,
          description: "VEX-404 flags a public relay query about restricted material. Drones reroute over the Midline Exchange.",
          severity: next >= 4 ? "CRITICAL" : "WARNING",
        },
        { type: "memory", npcKey: "vex-404", kind: "SEMANTIC", content: "The player asked a public relay about restricted Aether material.", importance: 5 },
      ],
    );
  }
  if (t.has("greet") || c.previousPlayerMessages === 0) {
    return reply("greet", "VEX-404 answers a public query.", "Greetings, citizen. This is a public Aether Dynamics relay. State your query.");
  }
  return reply("not_understood", "Query outside VEX-404's public scope.", "1. Query not understood. 2. Aether Tower is closed to unaccredited visitors. 3. Have a productive day.");
}

const SCRIPTS: Record<string, (c: DialogueContext) => DialogueReply> = { balthazar, kira, "vex-404": vex };

export const mockDialogueProvider: DialogueProvider = {
  id: "mock",
  model: "deterministic-script-v1",
  isSimulated: true,

  async reply(context) {
    const script = SCRIPTS[context.npc.key];
    if (!script) return reply("no_script", "This NPC has no mock script.", `${context.npc.name} looks at you and says nothing.`);
    return script(context);
  },

  async reactToItem(context, itemKey) {
    if (context.npc.key === "balthazar" && itemKey === "encrypted-shard") {
      return reply(
        "receive_shard",
        "Balthazar decrypts the shard and pays the player.",
        "Let me see... *slots the shard into a rusted lattice reader* 'PROJECT GENESIS. LATTICE SEED.' Twelve years, and they're still at it. You did good, kid. Here, you earned this, and the pass.",
      );
    }
    return reply("receive_item", "NPC accepts the item.", `${context.npc.name} takes it without a word.`);
  },

  suggestions(c) {
    const q1 = c.questStatus.get("ghost-courier");
    switch (c.npc.key) {
      case "balthazar":
        if (!q1) return ["What happened to your courier?", "Need a hand?"];
        if (q1 === "ACTIVE") {
          return [
            ...(c.evidence.has("scorched-badge") && !c.objectivesDone.has("ghost-courier/ask-about-badge") ? ["Look at this scorched badge."] : []),
            "Where should I look?",
            "Tell me about Juno.",
          ];
        }
        return ["What is Project Genesis?", "Where do I find Kira?"];
      case "kira":
        return [
          ...(q1 === "COMPLETED" && !c.memories.some((m) => m.includes("Balthazar vouched")) ? ["Balthazar sent me."] : []),
          "What does the decoder cost?",
          "How did the courier leave the Bazaar?",
        ];
      case "vex-404":
        return ["Hello?", "What is Project Genesis?"];
      default:
        return [];
    }
  },
};
