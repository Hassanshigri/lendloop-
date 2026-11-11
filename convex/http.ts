import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifyRequest } from "./lib/signing";

const http = httpRouter();

const OVERDUE_PATH = "/n8n/overdue-loans";
const EVENTS_PATH = "/n8n/automation-events";

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Every n8n call must carry a valid, fresh HMAC signature. Failures reveal nothing useful. */
async function authorize(request: Request, path: string, body: string) {
  const result = await verifyRequest(
    request.method,
    path,
    body,
    request.headers.get("X-LendLoop-Timestamp"),
    request.headers.get("X-LendLoop-Signature"),
  );
  if (!result.ok) console.warn(`Rejected n8n call to ${path}: ${result.reason}`);
  return result.ok;
}

http.route({
  path: OVERDUE_PATH,
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    if (!(await authorize(request, OVERDUE_PATH, ""))) return json(401, { error: "unauthorized" });
    const loans = await ctx.runQuery(internal.n8n.overdueLoans, {});
    return json(200, { loans });
  }),
});

http.route({
  path: EVENTS_PATH,
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const body = await request.text();
    if (body.length > 10_000) return json(413, { error: "payload too large" });
    if (!(await authorize(request, EVENTS_PATH, body))) return json(401, { error: "unauthorized" });

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(body);
    } catch {
      return json(400, { error: "invalid JSON" });
    }
    const { idempotencyKey, loanId, kind, status, detail } = data;
    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length === 0 ||
      idempotencyKey.length > 200 ||
      typeof loanId !== "string" ||
      (kind !== "request_notification" && kind !== "overdue_reminder") ||
      (status !== "sent" && status !== "failed") ||
      (detail !== undefined && typeof detail !== "string")
    ) {
      return json(400, { error: "invalid fields" });
    }

    try {
      const outcome = await ctx.runMutation(internal.n8n.recordAutomationEvent, {
        idempotencyKey,
        loanId: loanId as Id<"loans">,
        kind,
        status,
        detail: detail as string | undefined,
      });
      if (outcome.result === "unknown_loan") return json(404, { error: "unknown loan" });
      return json(200, outcome);
    } catch {
      // Malformed IDs fail argument validation; report a client error, not a crash.
      return json(400, { error: "invalid loanId" });
    }
  }),
});

export default http;
