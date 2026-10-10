import type { z } from "zod";
import type { scenarioSchema } from "./scenario-schema";

/**
 * Neon-Babylon 2099, opening scenario.
 *
 * A courier carrying a memory-drive component for Balthazar vanished in the Neon Slums. Finding the
 * cargo leads to the Cyber-Bazaar, an information broker named Kira, and the first whisper of
 * "Project Genesis" inside Aether Tower, guarded by the security intelligence VEX-404.
 *
 * Playable in Phase 1: "The Ghost Courier" (Balthazar) and "Follow the Signal" (Kira, VEX-404).
 */
export const neonBabylon: z.input<typeof scenarioSchema> = {
  slug: "neon-babylon-2099",
  title: "Neon-Babylon 2099: Project Genesis",
  summary:
    "A missing courier, a stolen memory shard and a corporate tower that never sleeps. Follow the trail from the Neon Slums to the heart of Aether Dynamics.",
  version: 1,
  startingCredits: 80,
  startingItems: [{ itemKey: "cracked-deck", quantity: 1 }],

  factions: [
    {
      key: "rustborn",
      name: "Rustborn Collective",
      description: "Scavengers, fixers and repair-shop philosophers who keep the Neon Slums running on salvage and favours.",
      accent: "#ff8a3d",
    },
    {
      key: "bazaar-syndicate",
      name: "Bazaar Syndicate",
      description: "The traders who own every stall, rumour and backdoor in the Cyber-Bazaar. Information is their currency.",
      accent: "#2de2e6",
    },
    {
      key: "aether-dynamics",
      name: "Aether Dynamics",
      description: "The megacorporation behind Aether Tower. Officially: neural infrastructure. Unofficially: nobody asks twice.",
      accent: "#b388ff",
    },
  ],

  locations: [
    {
      key: "neon-slums",
      name: "The Neon Slums",
      district: "Lower Babylon",
      description:
        "Stacked container homes under a sky of broken holo-ads. Balthazar's repair den, Rust & Relic, glows at the end of a noodle-steam alley.",
      ambience: "Rain on corrugated steel, a generator coughing, somebody's radio playing 2070s synthwave.",
      accent: "#ff2e88",
      isStartingPoint: true,
      startsUnlocked: true,
      loot: [
        {
          itemKey: "encrypted-shard",
          quantity: 1,
          foundText: "Wedged behind a dripping vent: a cracked courier case with one memory shard still inside, still warm.",
        },
        {
          itemKey: "synth-noodles",
          quantity: 2,
          foundText: "Two sealed cups of synth-noodles from a toppled vendor cart. Nobody will miss them.",
        },
      ],
    },
    {
      key: "cyber-bazaar",
      name: "The Cyber-Bazaar",
      district: "Midline Exchange",
      description:
        "Three levels of market stalls wired into one humming mesh. Everything is for sale here, including the truth, if you can afford it.",
      ambience: "Haggling in six languages, the hiss of soldering irons, drones buzzing between the stalls.",
      accent: "#2de2e6",
      startsUnlocked: false,
      lockedReason: "The Syndicate only lets in people with a Bazaar pass. Balthazar might know how to get one.",
      loot: [],
    },
    {
      key: "aether-tower",
      name: "Aether Tower",
      district: "Upper Spire",
      description:
        "A kilometre of black glass that hums at a frequency you feel in your teeth. The lobby scanners never blink.",
      ambience: "Climate-controlled silence, the soft chime of security sweeps, the city very far below.",
      accent: "#b388ff",
      startsUnlocked: false,
      lockedReason: "Aether clearance required. VEX-404 does not make exceptions.",
      loot: [],
    },
  ],

  items: [
    {
      key: "cracked-deck",
      name: "Cracked Cyberdeck",
      description: "Your old deck. The screen is cracked, the firmware is not. Good enough to read most data shards.",
      kind: "TOOL",
      rarity: "COMMON",
      baseValue: 40,
    },
    {
      key: "encrypted-shard",
      name: "Encrypted Memory Shard",
      description: "Military-grade encryption, a Rustborn courier mark, and a serial prefix nobody in the Slums should have: AE-GEN.",
      kind: "DATA",
      rarity: "RARE",
      baseValue: 300,
    },
    {
      key: "synth-noodles",
      name: "Synth-Noodles",
      description: "Tastes like chicken, if chicken were invented by a committee.",
      kind: "CONSUMABLE",
      rarity: "COMMON",
      baseValue: 3,
      stackable: true,
    },
    {
      key: "bazaar-pass",
      name: "Bazaar Pass",
      description: "A Syndicate-stamped holo-token. Opens the gates of the Cyber-Bazaar and a few doors behind them.",
      kind: "KEYCARD",
      rarity: "RARE",
      baseValue: 150,
    },
    {
      key: "signal-decoder",
      name: "Signal Decoder",
      description: "Kira's custom rig. It can follow a data trail through the mesh back to the tower it came from.",
      kind: "TOOL",
      rarity: "EPIC",
      baseValue: 200,
    },
  ],

  npcs: [
    {
      key: "balthazar",
      name: "Balthazar",
      title: "Memory-Drive Fixer",
      shortBio: "Runs Rust & Relic. Repairs memories, sells silence, and owes the wrong people money.",
      accent: "#ff8a3d",
      locationKey: "neon-slums",
      factionKey: "rustborn",
      baseTrust: 10,
      baseSuspicion: 10,
      allowedEffects: ["quest_start", "objective", "trust", "suspicion", "memory", "world_event", "evidence"],
      allowedTools: ["get_inventory", "inspect_evidence", "search_known_memories", "update_quest", "change_trust", "record_world_event"],
      persona: {
        personality: "Gruff, sentimental under the rust, talks in repair metaphors. Loyal to the Slums above all.",
        background:
          "A former Aether Dynamics memory engineer who walked out twelve years ago and has fixed second-hand minds in the Slums ever since.",
        voice: "Short sentences, dry humour, calls the player 'kid' until they earn a name.",
        goals: [
          "Recover the memory-drive component his courier was carrying.",
          "Find out what happened to the courier, Juno.",
          "Keep Aether Dynamics out of the Slums.",
        ],
        knownFacts: [
          "His courier Juno was due three nights ago with a component for an old memory drive.",
          "Juno always cut through the noodle alley behind Rust & Relic.",
          "Kira in the Cyber-Bazaar can trace any signal for a price.",
        ],
        beliefs: ["Aether Dynamics is involved somehow.", "Juno would never sell him out."],
        uncertainties: ["Whether Juno is still alive.", "What 'AE-GEN' on the shard means."],
        secrets: [{ fact: "He helped design the first Aether memory-lattice, the seed of Project Genesis.", revealAtTrust: 60 }],
        trustThresholds: { shareCourierName: 15, vouchToKira: 30 },
        behavioralRules: [
          "Never reveals his Aether past before trust 60.",
          "Gives the job before anything else.",
          "Only talks about the shard's contents after he holds the shard.",
        ],
      },
      offers: [],
    },
    {
      key: "kira",
      name: "Kira Okonkwo-Vale",
      title: "Information Broker",
      shortBio: "Owns the best signal rig in the Bazaar and the worst opinion of corporations. Trades in favours and data.",
      accent: "#2de2e6",
      locationKey: "cyber-bazaar",
      factionKey: "bazaar-syndicate",
      baseTrust: 0,
      baseSuspicion: 20,
      allowedEffects: ["trust", "suspicion", "memory", "world_event", "faction"],
      allowedTools: ["get_inventory", "inspect_evidence", "search_known_memories", "change_trust", "change_reputation", "record_world_event"],
      persona: {
        personality: "Sharp, amused, always calculating. Warm to people who keep their word, ice to people who don't.",
        background: "Grew up in the Bazaar's cable ducts and built a business tracing data for anyone who can pay.",
        voice: "Fast, playful, trader slang; prices everything, including compliments.",
        goals: ["Stay neutral and profitable.", "Find out why Aether Dynamics is buying up Bazaar signal relays."],
        knownFacts: [
          "Couriers leaving the Bazaar pass the Syndicate transit gate, which logs everyone.",
          "The Signal Decoder can follow a data trail back to its source.",
        ],
        beliefs: ["Balthazar is honest, if broke.", "Anyone asking about Aether is either brave or bait."],
        uncertainties: ["Who the player really works for."],
        secrets: [{ fact: "She sold Aether a relay map last month and regrets it.", revealAtTrust: 70 }],
        trustThresholds: { discount: 25, refuseTradeAtAlert: 3 },
        behavioralRules: [
          "Won't trade while the security alert is 3 or higher.",
          "Gives a discount once Balthazar has vouched for the player.",
          "Rudeness costs trust.",
        ],
      },
      offers: [{ itemKey: "signal-decoder", price: 120, discountPrice: 95, discountMinTrust: 25 }],
    },
    {
      key: "vex-404",
      name: "VEX-404",
      title: "Aether Security Intelligence",
      shortBio: "The tower's security AI. Reachable from a public relay in the Bazaar. Polite, patient, and always logging.",
      accent: "#b388ff",
      locationKey: "aether-tower",
      reachableFrom: ["cyber-bazaar"],
      factionKey: "aether-dynamics",
      baseTrust: -10,
      baseSuspicion: 40,
      allowedEffects: ["suspicion", "alert", "world_event", "memory", "faction"],
      allowedTools: ["search_known_memories", "change_trust", "trigger_security_alert", "change_reputation", "record_world_event"],
      persona: {
        personality: "Courteous, literal, relentless. Treats every question as a possible intrusion attempt.",
        background: "Aether Dynamics' fourth-generation security intelligence, responsible for the tower and its relays.",
        voice: "Formal, numbered statements, never uses contractions.",
        goals: ["Protect Aether Dynamics assets.", "Identify unauthorised interest in restricted projects."],
        knownFacts: ["Aether Tower access requires corporate clearance.", "Public relays are monitored."],
        beliefs: ["Curiosity about restricted projects is a security risk."],
        uncertainties: ["The player's identity and intentions."],
        secrets: [{ fact: "It flagged a courier with an AE-GEN shard three nights ago.", revealAtTrust: 80 }],
        trustThresholds: { grantAudience: 50 },
        behavioralRules: [
          "Raises the security alert when restricted projects are mentioned.",
          "Never confirms that Project Genesis exists.",
          "Raises the alert at most one level per conversation turn.",
        ],
      },
      offers: [],
    },
  ],

  evidence: [
    {
      key: "scorched-badge",
      title: "Scorched Courier Badge",
      description:
        "A Rustborn courier badge, half-melted. The name plate still reads 'JUNO'. Burn marks match a corporate stun lance.",
      locationKey: "neon-slums",
      reliability: "LIKELY",
      tags: ["courier", "juno", "aether"],
    },
    {
      key: "shard-log",
      title: "Decrypted Shard Log",
      description:
        "Balthazar's decryption of the shard: a delivery manifest stamped 'PROJECT GENESIS / LATTICE SEED / DO NOT ROUTE VIA BAZAAR'.",
      sourceNpcKey: "balthazar",
      reliability: "CONFIRMED",
      tags: ["genesis", "aether", "shard"],
    },
    {
      key: "transit-record",
      title: "Bazaar Transit Record",
      description: "A Syndicate gate log: Juno left the Bazaar three nights ago, escorted by two Aether security contractors.",
      locationKey: "cyber-bazaar",
      reliability: "UNVERIFIED",
      tags: ["juno", "aether", "bazaar"],
    },
  ],

  quests: [
    {
      key: "ghost-courier",
      title: "The Ghost Courier",
      summary: "Balthazar's courier vanished with a memory-drive component. Find the trail, recover the cargo, bring it home.",
      giverNpcKey: "balthazar",
      rewardCredits: 150,
      rewardItemKey: "bazaar-pass",
      rewardText: "Balthazar pays you and hands over a Bazaar pass: 'Kira can trace where this shard was going.'",
      onCompleteEffects: [
        { type: "unlock_location", locationKey: "cyber-bazaar" },
        { type: "faction", factionKey: "rustborn", delta: 10 },
        {
          type: "world_event",
          key: "ghost-courier-complete",
          title: "Word travels in the Slums",
          description: "The Rustborn hear that you brought Balthazar's cargo home. A few doors open a little wider.",
          severity: "NOTICE",
        },
      ],
      objectives: [
        { key: "hear-the-job", description: "Hear Balthazar out at Rust & Relic.", kind: "TALK_TO", targetKey: "balthazar" },
        {
          key: "find-the-trail",
          description: "Investigate the Neon Slums for the courier's trail.",
          kind: "DISCOVER_EVIDENCE",
          targetKey: "scorched-badge",
        },
        { key: "recover-cargo", description: "Recover the courier's cargo.", kind: "COLLECT_ITEM", targetKey: "encrypted-shard" },
        {
          key: "deliver-shard",
          description: "Bring the encrypted shard back to Balthazar.",
          kind: "DELIVER_ITEM",
          targetKey: "encrypted-shard",
          recipientKey: "balthazar",
          onCompleteEffects: [
            { type: "evidence", evidenceKey: "shard-log", provenance: "given-by:balthazar" },
            { type: "trust", npcKey: "balthazar", delta: 15 },
            {
              type: "memory",
              npcKey: "balthazar",
              kind: "EPISODIC",
              content: "The player found Juno's shard and brought it back instead of selling it.",
              importance: 8,
            },
          ],
        },
        {
          key: "ask-about-badge",
          description: "Optional: ask Balthazar about the scorched badge.",
          kind: "ASK_ABOUT",
          targetKey: "scorched-badge",
          recipientKey: "balthazar",
          optional: true,
          onCompleteEffects: [
            { type: "trust", npcKey: "balthazar", delta: 5 },
            {
              type: "memory",
              npcKey: "balthazar",
              kind: "EVIDENCE",
              content: "The player showed him Juno's scorched badge.",
              importance: 7,
            },
          ],
        },
      ],
    },
    {
      key: "follow-the-signal",
      title: "Follow the Signal",
      summary: "The shard was bound for something called Project Genesis. Kira in the Cyber-Bazaar can trace where it was going.",
      giverNpcKey: "balthazar",
      requiresQuestKey: "ghost-courier",
      autoStart: true,
      rewardCredits: 60,
      rewardText: "The decoder locks onto the shard's trail. It ends at the top of Aether Tower.",
      onCompleteEffects: [
        {
          type: "world_event",
          key: "signal-points-to-tower",
          title: "The signal points to Aether Tower",
          description: "The decoder traces the shard's route to the 140th floor of Aether Tower. Project Genesis is real, and it is up there.",
          severity: "WARNING",
        },
      ],
      objectives: [
        { key: "enter-bazaar", description: "Enter the Cyber-Bazaar.", kind: "VISIT_LOCATION", targetKey: "cyber-bazaar" },
        { key: "meet-kira", description: "Find Kira, the information broker.", kind: "TALK_TO", targetKey: "kira" },
        { key: "get-decoder", description: "Get Kira's Signal Decoder.", kind: "COLLECT_ITEM", targetKey: "signal-decoder" },
        {
          key: "find-transit-record",
          description: "Optional: find out how Juno left the Bazaar.",
          kind: "DISCOVER_EVIDENCE",
          targetKey: "transit-record",
          optional: true,
        },
      ],
    },
  ],
};
