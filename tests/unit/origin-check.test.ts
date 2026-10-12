import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { assertSameOrigin } from "@/server/auth";

const post = (headers: Record<string, string>) => new NextRequest("http://localhost:3100/api/sessions", { method: "POST", headers });

describe("CSRF Origin check", () => {
  it("accepts requests from the app's own origin", () => {
    expect(() => assertSameOrigin(post({ origin: "http://localhost:3100" }))).not.toThrow();
  });

  it("refuses other origins and requests without one", () => {
    expect(() => assertSameOrigin(post({ origin: "https://evil.example" }))).toThrow(expect.objectContaining({ status: 403, code: "bad_origin" }));
    expect(() => assertSameOrigin(post({ origin: "http://localhost:3100.evil.example" }))).toThrow(expect.objectContaining({ code: "bad_origin" }));
    expect(() => assertSameOrigin(post({}))).toThrow(expect.objectContaining({ code: "bad_origin" }));
  });
});
