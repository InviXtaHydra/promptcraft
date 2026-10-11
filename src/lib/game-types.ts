// Shapes the API returns to the browser. Shared by server and client; no server code in here.

export type ItemKind = "TOOL" | "DATA" | "KEYCARD" | "CONSUMABLE" | "MISC";
export type Rarity = "COMMON" | "RARE" | "EPIC" | "LEGENDARY";
export type Reliability = "CONFIRMED" | "LIKELY" | "UNVERIFIED" | "DISPUTED";
export type Severity = "INFO" | "NOTICE" | "WARNING" | "CRITICAL";

export type GameView = {
  session: { id: string; status: "ACTIVE" | "COMPLETED" | "ABANDONED"; scenarioTitle: string; turn: number; isPreview: boolean };
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
  investigation: {
    suspects: { key: string; name: string; title: string; description: string; motive: string }[];
    links: { from: string; to: string; toType: "evidence" | "suspect"; relation: "SUPPORTS" | "CONTRADICTS" | "LEADS_TO" | "IMPLICATES" | "EXONERATES"; note: string }[];
    hypotheses: { id: string; suspectKey: string; evidenceKeys: string[]; note: string; assessment: { score: number; verdict: "strong" | "plausible" | "weak" | "contradicted"; reasons: string[] } }[];
    /** True when the case can be submitted (the CLOSE_CASE objective is open) */
    canSubmit: boolean;
    ending: { key: string; title: string; description: string; tone: string; suspectKey: string; evidenceKeys: string[] } | null;
  };
  choices: { key: string; title: string; prompt: string; options: { key: string; label: string; description: string }[] }[];
  simulation: { tick: number; paused: boolean; everyTurns: number; nextTickInTurns: number };
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
  result: { type: string; turn: number; narration: string[]; outcomes: OutcomeSummary[]; npcKey?: string; replayed: boolean; reactionError?: string; simulation?: SimulationTickView | null };
  view: GameView;
};

export type RunSummary = {
  id: string;
  npc: { key: string; name: string } | null;
  provider: string;
  model: string;
  simulated: boolean;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED";
  startedAt: string;
  latencyMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  modelCalls: number;
  retries: number;
  transitions: number;
  tools: { total: number; rejected: number };
  error: string | null;
  playerMessage: string | null;
};

export type RunDetail = RunSummary & {
  estimatedCostUsd: number | null;
  steps: { index: number; node: string; status: string; summary: string; durationMs: number | null; data: unknown }[];
  toolExecutions: { id: string; tool: string; status: string; arguments: unknown; result: unknown; rejectionReason: string | null }[];
  messages: { role: "PLAYER" | "NPC" | "SYSTEM"; content: string; simulated: boolean }[];
};

/** Events of the live turn stream (POST /api/sessions/{id}/talk) */
export type TurnStreamEvent =
  | { type: "run_started"; runId: string; npcKey: string; provider: string; model: string; simulated: boolean }
  | { type: "node"; node: string; status: "started" | "succeeded" | "failed" | "skipped"; summary?: string; durationMs?: number; data?: unknown }
  | { type: "memories"; items: { content: string; score: number; similarity: number; thisInvestigation: boolean }[]; embeddingModel: string; simulatedEmbeddings: boolean }
  | { type: "tool"; tool: string; source: string; status: "proposed" | "rejected" | "executed"; args?: unknown; reason?: string; result?: unknown }
  | { type: "outcome"; text: string; status: "applied" | "skipped" }
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; modelCalls: number; retries: number }
  | { type: "view"; view: GameView }
  | { type: "simulation"; tick: SimulationTickView }
  | { type: "done"; messageId: string | null; reply: string | null; turn: number | null; replayed: boolean }
  | { type: "error"; code: string; message: string };

export type AiStatusView = {
  dialogue: { provider: string; model: string; simulated: boolean };
  embeddings: { model: string; simulated: boolean };
  ollama: { url: string; reachable: boolean; chatModelInstalled: boolean; embedModelInstalled: boolean } | null;
};

export type SimulationTickView = {
  tick: number;
  trigger: "TURN" | "MANUAL" | "SCHEDULE";
  actions: { intention: string; actor: string; title: string; status: "executed" | "rejected" | "skipped"; reason?: string; outcomes: { status: string; text: string }[] }[];
  replayed: boolean;
};

export type ScenarioSummary = { slug: string; title: string; summary: string };
