import { internalMutation } from "./_generated/server";

/** Local testing only: `npx convex run seed:reset`. Refuses to run unless ALLOW_RESET=true. */
export const reset = internalMutation({
  args: {},
  handler: async (ctx) => {
    if (process.env.ALLOW_RESET !== "true") throw new Error("Set ALLOW_RESET=true on this deployment first.");
    for (const table of ["automationEvents", "webhookDeliveries", "loans", "tools", "users"] as const) {
      for (const doc of await ctx.db.query(table).collect()) await ctx.db.delete(doc._id);
    }
  },
});
import { enqueueLoanEvent } from "./lib/notify";

/**
 * Demo data for local testing: `npx convex run seed:demo`.
 * Internal, so it cannot be called from the browser. Includes one overdue loan
 * so the reminder workflow has something to do.
 */
export const demo = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded = await ctx.db
      .query("users")
      .withIndex("by_token", (q) => q.eq("tokenIdentifier", "seed|ana"))
      .first();
    if (seeded) return { skipped: "already seeded; run seed:reset first" };
    const ana = await ctx.db.insert("users", {
      tokenIdentifier: "seed|ana",
      name: "Ana Lopez",
      email: "ana@example.com",
      role: "user",
      trustedLender: true,
    });
    const ben = await ctx.db.insert("users", {
      tokenIdentifier: "seed|ben",
      name: "Ben Carter",
      email: "ben@example.com",
      role: "user",
      trustedLender: false,
    });
    const drill = await ctx.db.insert("tools", {
      ownerId: ana,
      name: "Cordless drill",
      category: "power tools",
      condition: "good",
      description: "18V drill with two batteries and a bit set.",
    });
    await ctx.db.insert("tools", {
      ownerId: ben,
      name: "4-person tent",
      category: "camping",
      condition: "fair",
      description: "Easy setup, fits in a car trunk.",
    });
    const due = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
    const start = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);
    const loanId = await ctx.db.insert("loans", {
      toolId: drill,
      lenderId: ana,
      borrowerId: ben,
      startDate: start,
      endDate: due,
      status: "approved",
      updatedAt: Date.now(),
    });
    await enqueueLoanEvent(ctx, loanId, "loan.approved");
    return { loanId };
  },
});
