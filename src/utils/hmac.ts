import { createHmac, timingSafeEqual } from "node:crypto";

export function signHmacSha256(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyHmacSha256(
  payload: string,
  signature: string,
  secret: string,
): boolean {
  const expected = signHmacSha256(payload, secret);
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}
