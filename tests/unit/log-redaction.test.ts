import { afterEach, describe, expect, it, vi } from "vitest";
import { log, redact } from "@/server/log";

describe("log redaction", () => {
  afterEach(() => vi.restoreAllMocks());

  it("drops sensitive fields and scrubs credentials and emails from strings", () => {
    const out = redact({
      route: "/api/auth/login",
      password: "hunter2",
      headers: { cookie: "pc_session=abc", authorization: "Bearer xyz" },
      message: "the player's chat line",
      error: new Error("connect failed: postgresql://promptcraft:s3cret@db:5432/app for runner@example.com"),
      note: "token Bearer abc.def-123 and pc_session=deadbeef",
    }) as Record<string, unknown>;
    expect(out.password).toBe("[redacted]");
    expect(out.headers).toEqual({ cookie: "[redacted]", authorization: "[redacted]" });
    expect(out.message).toBe("[redacted]");
    expect(JSON.stringify(out)).not.toMatch(/s3cret|hunter2|runner@example|abc\.def|deadbeef/);
    expect((out.error as { message: string }).message).toBe("connect failed: postgresql://[redacted]@db:5432/app for [email]");
  });

  it("writes one JSON line per event", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    log("error", "boom", { route: "/x", password: "p" });
    const line = JSON.parse(spy.mock.calls[0][0] as string);
    expect(line).toMatchObject({ level: "error", event: "boom", route: "/x", password: "[redacted]" });
  });
});
