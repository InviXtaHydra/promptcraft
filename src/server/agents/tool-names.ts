/** Every tool an NPC agent can call. Which NPC may call which is set per NPC in the scenario. */
export const TOOL_NAMES = [
  // read-only
  "get_inventory",
  "inspect_evidence",
  "search_known_memories",
  // state-changing: always executed through the game engine
  "transfer_item",
  "transfer_credits",
  "unlock_location",
  "update_quest",
  "change_trust",
  "change_reputation",
  "trigger_security_alert",
  "record_world_event",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
