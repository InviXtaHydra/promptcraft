/**
 * Structured JSON logs, one line per event, with secrets and personal data redacted before they are
 * written: sensitive keys are dropped wholesale, and strings are scrubbed of credentials in URLs,
 * bearer tokens, session cookies and email addresses. Player messages are never logged.
 */

const SENSITIVE_KEY = /pass(word)?|token|secret|cookie|authorization|api[-_]?key|session|message|content|prompt/i;

const SCRUBBERS: [RegExp, string][] = [
  [/(\w+:\/\/)[^\s:/@]+:[^\s@/]+@/g, "$1[redacted]@"], // postgres://user:pass@host
  [/\bBearer\s+[\w.~+/-]+=*/gi, "Bearer [redacted]"],
  [/\bpc_session=[^;\s]+/g, "pc_session=[redacted]"],
  [/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email]"],
];

export function redact(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return SCRUBBERS.reduce((s, [re, sub]) => s.replace(re, sub), value).slice(0, 2000);
  if (value instanceof Error) return { name: value.name, message: redact(value.message) };
  if (Array.isArray(value)) return depth > 4 ? "[…]" : value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value && typeof value === "object") {
    if (depth > 4) return "[…]";
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? "[redacted]" : redact(v, depth + 1)]));
  }
  return value;
}

type Level = "info" | "warn" | "error";

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, event, ...(redact(fields) as object) });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
