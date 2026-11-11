// End-to-end check of the signed Convex <-> n8n contract, without Docker.
//
//   1. npx convex dev                       (local backend running)
//   2. npx convex env set N8N_BASE_URL http://127.0.0.1:5679
//   3. npx convex run seed:demo             (after this script starts listening)
//   LENDLOOP_SHARED_SECRET=... CONVEX_SITE_URL=http://127.0.0.1:3211 node scripts/test-integration.mjs
//
// A stand-in for n8n listens on :5679 and verifies Convex's signature exactly
// as the n8n "Verify HMAC signature" node does.
import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";

const SECRET = process.env.LENDLOOP_SHARED_SECRET;
const SITE = (process.env.CONVEX_SITE_URL || "http://127.0.0.1:3211").replace(/\/$/, "");
if (!SECRET) throw new Error("Set LENDLOOP_SHARED_SECRET");

let failures = 0;
const check = (ok, label) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
};
const sign = (method, path, body, ts = Math.floor(Date.now() / 1000)) => ({
  "X-LendLoop-Timestamp": String(ts),
  "X-LendLoop-Signature": createHmac("sha256", SECRET).update(`${ts}.${method}.${path}.${body}`).digest("hex"),
});

// ---- Convex -> n8n: receive the webhook and verify it like n8n does ----
const received = [];
const server = createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    const ts = req.headers["x-lendloop-timestamp"];
    const sig = String(req.headers["x-lendloop-signature"] || "");
    const reserialized = JSON.stringify(JSON.parse(raw)); // what the n8n node signs over
    const expected = createHmac("sha256", SECRET).update(`${ts}.POST.${req.url}.${reserialized}`).digest("hex");
    const valid = expected.length === sig.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
    received.push({ valid, path: req.url, body: JSON.parse(raw), sameBytes: raw === reserialized });
    res.writeHead(valid ? 200 : 401).end();
  });
});
await new Promise((r) => server.listen(5679, "127.0.0.1", r));
console.log("Mock n8n listening on 127.0.0.1:5679. Run `npx convex run seed:demo` now.");

const deadline = Date.now() + 60_000;
while (received.length === 0 && Date.now() < deadline) await new Promise((r) => setTimeout(r, 500));
check(received.length > 0, "Convex delivered the loan webhook to n8n");
const hook = received[0];
if (hook) {
  check(hook.valid, "webhook signature verifies with the shared secret");
  check(hook.sameBytes, "re-serialized JSON matches the signed bytes");
  check(hook.path === "/webhook/lendloop-request", "webhook path matches the n8n workflow");
  const keys = Object.keys(hook.body).sort().join(",");
  check(
    keys === "counterpartyFirstName,endDate,event,eventId,loanId,loanStatus,recipient,startDate,toolName",
    `payload holds only the needed fields (${keys})`,
  );
  check(!JSON.stringify(hook.body).includes("seed|"), "payload has no auth identifiers");
}

// ---- n8n -> Convex: overdue loans endpoint ----
const OVERDUE = "/n8n/overdue-loans";
let r = await fetch(SITE + OVERDUE, { headers: sign("GET", OVERDUE, "") });
const overdue = await r.json();
check(r.status === 200 && overdue.loans.length >= 1, `signed GET returns overdue loans (${overdue.loans?.length})`);
const loan = overdue.loans?.[0];

r = await fetch(SITE + OVERDUE);
check(r.status === 401, "unsigned GET is rejected");
r = await fetch(SITE + OVERDUE, { headers: { ...sign("GET", OVERDUE, ""), "X-LendLoop-Signature": "0".repeat(64) } });
check(r.status === 401, "wrong signature is rejected");
r = await fetch(SITE + OVERDUE, { headers: sign("GET", OVERDUE, "", Math.floor(Date.now() / 1000) - 3600) });
check(r.status === 401, "hour-old timestamp (replay) is rejected");
r = await fetch(SITE + OVERDUE, { headers: sign("GET", "/n8n/automation-events", "") });
check(r.status === 401, "signature for another endpoint is rejected");

// ---- n8n -> Convex: idempotent write-back ----
const EVENTS = "/n8n/automation-events";
const post = (body, headers = sign("POST", EVENTS, body)) =>
  fetch(SITE + EVENTS, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body });
const body = JSON.stringify({ idempotencyKey: loan.reminderKey, loanId: loan.loanId, kind: "overdue_reminder", status: "sent" });

r = await post(body);
check(r.status === 200 && (await r.json()).result === "created", "first write-back creates a record");
r = await post(body);
check(r.status === 200 && (await r.json()).result === "duplicate", "retried write-back is a no-op");
const tampered = body.replace("sent", "failed");
r = await post(tampered, sign("POST", EVENTS, body));
check(r.status === 401, "body changed after signing is rejected");
const badId = JSON.stringify({ idempotencyKey: "x", loanId: "not-an-id", kind: "overdue_reminder", status: "sent" });
r = await post(badId);
check(r.status === 400, "malformed loanId returns 400, not 500");

r = await fetch(SITE + OVERDUE, { headers: sign("GET", OVERDUE, "") });
const after = await r.json();
check(!after.loans.some((l) => l.loanId === loan.loanId), "loan reminded today is not returned again");

server.close();
console.log(failures ? `\n${failures} check(s) failed` : "\nAll checks passed");
process.exit(failures ? 1 : 0);
