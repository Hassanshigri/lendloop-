import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { CATEGORIES } from "./lib/constants";

export const category = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const condition = v.union(
  v.literal("new"),
  v.literal("good"),
  v.literal("fair"),
  v.literal("worn"),
);
export const loanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("returned"),
  v.literal("cancelled"),
);

export default defineSchema({
  users: defineTable({
    // Clerk identity, never exposed to other users or to n8n.
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.optional(v.string()),
    role: v.union(v.literal("admin"), v.literal("user")),
    trustedLender: v.boolean(),
  }).index("by_token", ["tokenIdentifier"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
    removedAt: v.optional(v.number()),
    removedBy: v.optional(v.id("users")),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    lenderId: v.id("users"),
    borrowerId: v.id("users"),
    // Calendar dates as YYYY-MM-DD; endDate is the day the tool is due back.
    startDate: v.string(),
    endDate: v.string(),
    status: loanStatus,
    updatedAt: v.number(),
  })
    .index("by_tool", ["toolId"])
    .index("by_lender", ["lenderId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Outgoing signed webhooks to n8n, so delivery is visible and retried.
  webhookDeliveries: defineTable({
    loanId: v.id("loans"),
    event: v.string(),
    eventId: v.string(),
    attempts: v.number(),
    status: v.union(v.literal("pending"), v.literal("delivered"), v.literal("failed")),
    lastError: v.optional(v.string()),
  })
    .index("by_event_id", ["eventId"])
    .index("by_status", ["status"]),

  // Results n8n writes back. idempotencyKey is unique, so retries never duplicate.
  automationEvents: defineTable({
    loanId: v.id("loans"),
    kind: v.union(v.literal("request_notification"), v.literal("overdue_reminder")),
    idempotencyKey: v.string(),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.optional(v.string()),
  })
    .index("by_key", ["idempotencyKey"])
    .index("by_loan", ["loanId"]),
});
