import { v } from "convex/values";
import { internalAction, internalMutation, internalQuery } from "./_generated/server";
import { internal } from "./_generated/api";
import { firstName } from "./lib/auth";
import { signRequest } from "./lib/signing";
import { todayUtc } from "./lib/dates";

const MAX_ATTEMPTS = 5;
const REQUEST_WEBHOOK_PATH = "/webhook/lendloop-request";

/** Who should hear about each event. Each payload goes to exactly one person. */
const RECIPIENT: Record<string, "lender" | "borrower"> = {
  "loan.requested": "lender",
  "loan.cancelled": "lender",
  "loan.approved": "borrower",
  "loan.declined": "borrower",
  "loan.returned": "borrower",
};

/**
 * Data minimization: the notification workflow receives only what it needs to
 * write one message. No Clerk IDs, no tool descriptions, no counterparty email.
 */
export const buildPayload = internalQuery({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) return null;
    const loan = await ctx.db.get(delivery.loanId);
    if (!loan) return null;
    const [tool, lender, borrower] = await Promise.all([
      ctx.db.get(loan.toolId),
      ctx.db.get(loan.lenderId),
      ctx.db.get(loan.borrowerId),
    ]);
    const to = RECIPIENT[delivery.event] === "lender" ? lender : borrower;
    const other = RECIPIENT[delivery.event] === "lender" ? borrower : lender;
    return {
      status: delivery.status,
      attempts: delivery.attempts,
      payload: {
        eventId: delivery.eventId,
        event: delivery.event,
        loanId: loan._id,
        loanStatus: loan.status,
        toolName: tool?.name ?? "a tool",
        startDate: loan.startDate,
        endDate: loan.endDate,
        recipient: { firstName: firstName(to?.name ?? ""), email: to?.email ?? null },
        counterpartyFirstName: firstName(other?.name ?? ""),
      },
    };
  },
});

export const recordAttempt = internalMutation({
  args: {
    deliveryId: v.id("webhookDeliveries"),
    ok: v.boolean(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { deliveryId, ok, error }) => {
    const delivery = await ctx.db.get(deliveryId);
    if (!delivery) return;
    const attempts = delivery.attempts + 1;
    if (ok) {
      await ctx.db.patch(deliveryId, { attempts, status: "delivered", lastError: undefined });
      return;
    }
    const giveUp = attempts >= MAX_ATTEMPTS;
    await ctx.db.patch(deliveryId, {
      attempts,
      status: giveUp ? "failed" : "pending",
      lastError: error?.slice(0, 500),
    });
    if (!giveUp) {
      // Exponential backoff: 30s, 60s, 120s, 240s.
      await ctx.scheduler.runAfter(30_000 * 2 ** (attempts - 1), internal.n8n.deliver, { deliveryId });
    } else {
      console.error(`Webhook delivery ${deliveryId} failed after ${attempts} attempts: ${error}`);
    }
  },
});

/** Sends one signed notification webhook to n8n. Retries are scheduled by recordAttempt. */
export const deliver = internalAction({
  args: { deliveryId: v.id("webhookDeliveries") },
  handler: async (ctx, { deliveryId }) => {
    const data = await ctx.runQuery(internal.n8n.buildPayload, { deliveryId });
    if (!data || data.status !== "pending") return;

    const baseUrl = process.env.N8N_BASE_URL;
    if (!baseUrl) {
      await ctx.runMutation(internal.n8n.recordAttempt, {
        deliveryId,
        ok: false,
        error: "N8N_BASE_URL is not configured",
      });
      return;
    }

    const body = JSON.stringify(data.payload);
    try {
      const { timestamp, signature } = await signRequest("POST", REQUEST_WEBHOOK_PATH, body);
      const res = await fetch(baseUrl.replace(/\/$/, "") + REQUEST_WEBHOOK_PATH, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-LendLoop-Timestamp": timestamp,
          "X-LendLoop-Signature": signature,
          // n8n can use this to ignore duplicate deliveries of the same event.
          "X-LendLoop-Event-Id": data.payload.eventId,
        },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      await ctx.runMutation(internal.n8n.recordAttempt, {
        deliveryId,
        ok: res.ok,
        error: res.ok ? undefined : `HTTP ${res.status}`,
      });
    } catch (err) {
      await ctx.runMutation(internal.n8n.recordAttempt, {
        deliveryId,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  },
});

/** Approved loans past their due date that have not had today's reminder yet. */
export const overdueLoans = internalQuery({
  args: {},
  handler: async (ctx) => {
    const today = todayUtc();
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", today))
      .take(500);

    const result = [];
    for (const loan of loans) {
      const reminderKey = `overdue:${loan._id}:${today}`;
      const alreadySent = await ctx.db
        .query("automationEvents")
        .withIndex("by_key", (q) => q.eq("idempotencyKey", reminderKey))
        .unique();
      if (alreadySent?.status === "sent") continue;

      const [tool, borrower] = await Promise.all([ctx.db.get(loan.toolId), ctx.db.get(loan.borrowerId)]);
      result.push({
        loanId: loan._id,
        reminderKey,
        toolName: tool?.name ?? "a tool",
        dueDate: loan.endDate,
        daysOverdue: Math.round((Date.parse(today) - Date.parse(loan.endDate)) / 86_400_000),
        borrower: { firstName: firstName(borrower?.name ?? ""), email: borrower?.email ?? null },
      });
    }
    return result;
  },
});

/**
 * Idempotent write-back from n8n. The same idempotencyKey always maps to one
 * record: a retry updates it instead of inserting a duplicate.
 */
export const recordAutomationEvent = internalMutation({
  args: {
    idempotencyKey: v.string(),
    loanId: v.id("loans"),
    kind: v.union(v.literal("request_notification"), v.literal("overdue_reminder")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const loan = await ctx.db.get(args.loanId);
    if (!loan) return { result: "unknown_loan" as const };
    const existing = await ctx.db
      .query("automationEvents")
      .withIndex("by_key", (q) => q.eq("idempotencyKey", args.idempotencyKey))
      .unique();
    const detail = args.detail?.slice(0, 300);
    if (existing) {
      // A later "sent" may replace an earlier "failed", never the other way round.
      if (existing.status === "failed" && args.status === "sent") {
        await ctx.db.patch(existing._id, { status: "sent", detail });
        return { result: "updated" as const };
      }
      return { result: "duplicate" as const };
    }
    await ctx.db.insert("automationEvents", { ...args, detail });
    return { result: "created" as const };
  },
});
