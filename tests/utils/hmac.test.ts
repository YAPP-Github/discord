import { describe, it, expect } from "vitest";
import { signHmacSha256, verifyHmacSha256 } from "../../src/utils/hmac.js";

describe("hmac", () => {
  it("signs and verifies a payload", () => {
    const payload = '{"a":1}';
    const secret = "shhh";
    const sig = signHmacSha256(payload, secret);
    expect(verifyHmacSha256(payload, sig, secret)).toBe(true);
  });

  it("rejects tampered payload", () => {
    const sig = signHmacSha256("a", "secret");
    expect(verifyHmacSha256("b", sig, "secret")).toBe(false);
  });

  it("rejects wrong secret", () => {
    const sig = signHmacSha256("a", "secret");
    expect(verifyHmacSha256("a", sig, "other")).toBe(false);
  });

  it("rejects malformed signature", () => {
    expect(verifyHmacSha256("a", "deadbeef", "secret")).toBe(false);
  });
});
