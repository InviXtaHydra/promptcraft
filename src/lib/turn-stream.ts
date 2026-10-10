"use client";

import type { TurnStreamEvent } from "./game-types";
import { ApiError } from "./api-client";

/**
 * Sends one message to an NPC and reads the Server-Sent Events of the turn (POST, so it can't use
 * EventSource). Aborting the signal closes the connection, which cancels the turn on the server.
 */
export async function streamTurn(
  sessionId: string,
  body: { npcKey: string; message: string; idempotencyKey: string },
  onEvent: (event: TurnStreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`/api/sessions/${sessionId}/talk`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    credentials: "same-origin",
    signal,
  });
  if (!response.ok || !response.body) {
    const data = await response.json().catch(() => null);
    const error = (data as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? "unknown", error?.message ?? `Request failed (${response.status})`);
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    let boundary: number;
    while ((boundary = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data: "))
        .map((line) => line.slice(6))
        .join("\n");
      if (data) onEvent(JSON.parse(data) as TurnStreamEvent);
    }
  }
}
