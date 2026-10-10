import type { ScenarioContent } from "./context";

/**
 * The investigation's reasoning, as rules over data: which evidence links the player can see,
 * how strong a hypothesis is, and which ending a case file reaches. Endings depend on the evidence
 * the player selected and on recorded choices, never on a single line of dialogue.
 */

type Link = ScenarioContent["evidenceLinks"][number];

/** Links whose both ends the player knows (evidence discovered; suspects are always known). */
export function visibleLinks(content: ScenarioContent, evidence: ReadonlySet<string>): Link[] {
  return content.evidenceLinks.filter((l) => evidence.has(l.fromEvidenceKey) && (l.toEvidenceKey ? evidence.has(l.toEvidenceKey) : true));
}

export type Assessment = {
  /** −1 … 1: how well the selected evidence points at this suspect */
  score: number;
  verdict: "strong" | "plausible" | "weak" | "contradicted";
  reasons: string[];
};

/**
 * How strong a theory is, from the links among the selected evidence. Shown on the evidence
 * board; it never reveals an ending or evidence the player hasn't found.
 */
export function assessHypothesis(content: ScenarioContent, suspectKey: string, selected: string[]): Assessment {
  const chosen = new Set(selected);
  const reasons: string[] = [];
  let score = 0;
  for (const l of content.evidenceLinks) {
    if (!chosen.has(l.fromEvidenceKey)) continue;
    const from = content.evidence.get(l.fromEvidenceKey)?.title ?? l.fromEvidenceKey;
    if (l.toSuspectKey === suspectKey && l.relation === "IMPLICATES") {
      score += 1;
      reasons.push(`${from} implicates them: ${l.note}`);
    }
    if (l.toSuspectKey === suspectKey && l.relation === "EXONERATES") {
      score -= 2;
      reasons.push(`${from} clears them: ${l.note}`);
    }
    if (l.toEvidenceKey && chosen.has(l.toEvidenceKey)) {
      const to = content.evidence.get(l.toEvidenceKey)?.title ?? l.toEvidenceKey;
      if (l.relation === "SUPPORTS" || l.relation === "LEADS_TO") {
        score += 0.5;
        reasons.push(`${from} and ${to} fit together.`);
      }
      if (l.relation === "CONTRADICTS") {
        score -= 0.5;
        reasons.push(`${from} contradicts ${to}; one of them is wrong.`);
      }
    }
  }
  const normalised = Math.max(-1, Math.min(1, score / 3));
  const verdict = score <= -1 ? "contradicted" : score >= 2.5 ? "strong" : score >= 1 ? "plausible" : "weak";
  if (!reasons.length) reasons.push("Nothing in the selected evidence points at this suspect yet.");
  return { score: Number(normalised.toFixed(2)), verdict, reasons };
}

/** The first ending (by priority) whose conditions the case file meets. Content always has a fallback. */
export function chooseEnding(content: ScenarioContent, caseFile: { suspectKey: string; evidenceKeys: string[] }, choices: ReadonlyMap<string, string | null>) {
  const evidence = new Set(caseFile.evidenceKeys);
  for (const ending of content.endings) {
    const c = ending.parsedConditions;
    if (c.choice && choices.get(c.choice.choiceKey) !== c.choice.option) continue;
    if (c.suspectKeys.length && !c.suspectKeys.includes(caseFile.suspectKey)) continue;
    if (!c.requiredEvidence.every((k) => evidence.has(k))) continue;
    if (!c.anyOfEvidence.every((group) => group.some((k) => evidence.has(k)))) continue;
    return ending;
  }
  return null;
}
