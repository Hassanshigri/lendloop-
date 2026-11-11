// HMAC-SHA256 request signing shared by both directions of the n8n integration.
//
// Signed string: `${timestamp}.${METHOD}.${path}.${body}`
// Headers:       X-LendLoop-Timestamp (unix seconds), X-LendLoop-Signature (hex)
//
// Including method, path and timestamp stops a valid signature from being
// replayed against another endpoint or after the 5 minute window.

export const MAX_SKEW_SECONDS = 300;

function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function signingSecret(): string {
  const secret = process.env.N8N_SHARED_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("N8N_SHARED_SECRET must be set to at least 32 characters.");
  }
  return secret;
}

export async function hmacHex(secret: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return toHex(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

export function canonical(timestamp: string, method: string, path: string, body: string): string {
  return `${timestamp}.${method.toUpperCase()}.${path}.${body}`;
}

/** Constant-time comparison so timing does not leak how much of a signature matched. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function signRequest(method: string, path: string, body: string) {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = await hmacHex(signingSecret(), canonical(timestamp, method, path, body));
  return { timestamp, signature };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

export async function verifyRequest(
  method: string,
  path: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
): Promise<VerifyResult> {
  if (!timestamp || !signature) return { ok: false, reason: "missing signature headers" };
  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "bad timestamp" };
  if (Math.abs(Date.now() / 1000 - ts) > MAX_SKEW_SECONDS) {
    return { ok: false, reason: "timestamp outside allowed window" };
  }
  const expected = await hmacHex(signingSecret(), canonical(timestamp, method, path, body));
  return safeEqual(expected, signature.toLowerCase())
    ? { ok: true }
    : { ok: false, reason: "signature mismatch" };
}
