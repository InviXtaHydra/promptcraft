// Shapes the API returns to the browser. Shared by server and client; no server code in here.

export type ItemKind = "TOOL" | "DATA" | "KEYCARD" | "CONSUMABLE" | "MISC";
export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
export type Reliability = "CONFIRMED" | "LIKELY" | "UNVERIFIED" | "DISPUTED";
export type Severity = "INFO" | "NOTICE" | "WARNING" | "CRITICAL";

export type GameView = {
  session: { id: string; status: "ACTIVE" | "COMPLETED" | "ABANDONED"; scenarioTitle: string; turn: number };
  player: { callsign: string };
  world: { credits: number; alert: number };
  location: {
    key: string;
    name: string;
    district: string;
    description: string;
    ambience: string;
    accent: string;
    investigated: boolean;
  };
  locations: {
    key: string;
    name: string;
    district: string;
    accent: string;
    unlocked: boolean;
    current: boolean;
    visited: boolean;
    lockedReason: string | null;
  }[];
  npcsHere: {
    key: string;
    name: string;
    title: string;
    shortBio: string;
    accent: string;
    trust: number;
    suspicion: number;
    /** Reached through a relay rather than standing here */
    remote: boolean;
    faction: string | null;
    offers: { itemKey: string; name: string; description: string; price: number; discounted: boolean; owned: boolean; refused: boolean }[];
    /** Items in the inventory this NPC is waiting for (quest deliveries) */
    wants: { itemKey: string; name: string }[];
  }[];
  inventory: { key: string; name: string; description: string; kind: ItemKind; rarity: Rarity; quantity: number; source: string }[];
  quests: {
    key: string;
    title: string;
    summary: string;
    status: "ACTIVE" | "COMPLETED" | "FAILED";
    isMain: boolean;
    giver: string | null;
    rewardCredits: number;
    rewardText: string | null;
    objectives: { key: string; description: string; optional: boolean; done: boolean }[];
  }[];
  evidence: { key: string; title: string; description: string; reliability: Reliability; tags: string[]; provenance: string; discoveredAt: string }[];
  factions: { key: string; name: string; accent: string; reputation: number }[];
  events: { id: string; title: string; description: string; severity: Severity; actor: "PLAYER" | "NPC" | "SYSTEM"; turn: number; createdAt: string }[];
};

export type ConversationView = {
  npc: { key: string; name: string; title: string; accent: string };
  provider: { id: string; model: string; isSimulated: boolean };
  reachable: boolean;
  messages: { id: string; role: "PLAYER" | "NPC" | "SYSTEM"; content: string; isSimulated: boolean; createdAt: string }[];
  suggestions: string[];
};

export type SessionSummary = {
  id: string;
  status: "ACTIVE" | "COMPLETED" | "ABANDONED";
  title: string;
  lastPlayedAt: string;
  createdAt: string;
  credits: number;
  location: string;
  questsCompleted: number;
  activeQuest: string | null;
};

export type OutcomeSummary = { type: string; status: "applied" | "skipped"; text: string };

export type CommandResponse = {
  result: { type: string; turn: number; narration: string[]; outcomes: OutcomeSummary[]; npcKey?: string; replayed: boolean };
  view: GameView;
};
