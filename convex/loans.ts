import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { firstName, requireAdmin, requireUser } from "./lib/auth";
import { enqueueLoanEvent } from "./lib/notify";
import { todayUtc } from "./lib/dates";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LOAN_DAYS = 30;

function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
}

function overlaps(a: { startDate: string; endDate: string }, b: { startDate: string; endDate: string }) {
  return a.startDate <= b.endDate && b.startDate <= a.endDate;
}

async function loanFor(ctx: MutationCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("Request not found.");
  return loan;
}

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate) || isNaN(Date.parse(startDate)) || isNaN(Date.parse(endDate))) {
      throw new ConvexError("Dates must be valid YYYY-MM-DD dates.");
    }
    if (startDate < todayUtc()) throw new ConvexError("Start date cannot be in the past.");
    if (endDate < startDate) throw new ConvexError("End date must be on or after the start date.");
    if (daysBetween(startDate, endDate) > MAX_LOAN_DAYS) {
      throw new ConvexError(`Loans can be at most ${MAX_LOAN_DAYS} days.`);
    }

    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw new ConvexError("Tool not found.");
    if (tool.ownerId === me._id) throw new ConvexError("You cannot borrow your own tool.");

    const existing = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    if (existing.some((l) => l.status === "approved" && overlaps(l, { startDate, endDate }))) {
      throw new ConvexError("The tool is already lent out for those dates.");
    }
    if (existing.some((l) => l.status === "pending" && l.borrowerId === me._id)) {
      throw new ConvexError("You already have a pending request for this tool.");
    }

    const loanId = await ctx.db.insert("loans", {
      toolId,
      lenderId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
      updatedAt: Date.now(),
    });
    await enqueueLoanEvent(ctx, loanId, "loan.requested");
    return loanId;
  },
});

export const approve = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await loanFor(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can approve this request.");
    if (loan.status !== "pending") throw new ConvexError("Only pending requests can be approved.");

    const others = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", loan.toolId))
      .collect();
    if (others.some((l) => l.status === "approved")) {
      throw new ConvexError("This tool is already lent out. Mark it returned first.");
    }

    await ctx.db.patch(loanId, { status: "approved", updatedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "loan.approved");

    // Overlapping pending requests can no longer be met, so decline them.
    for (const other of others) {
      if (other._id !== loanId && other.status === "pending" && overlaps(other, loan)) {
        await ctx.db.patch(other._id, { status: "declined", updatedAt: Date.now() });
        await enqueueLoanEvent(ctx, other._id, "loan.declined");
      }
    }
  },
});

export const decline = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await loanFor(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can decline this request.");
    if (loan.status !== "pending") throw new ConvexError("Only pending requests can be declined.");
    await ctx.db.patch(loanId, { status: "declined", updatedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "loan.declined");
  },
});

export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await loanFor(ctx, loanId);
    if (loan.borrowerId !== me._id) throw new ConvexError("Only the borrower can cancel this request.");
    if (loan.status !== "pending") throw new ConvexError("Only pending requests can be cancelled.");
    await ctx.db.patch(loanId, { status: "cancelled", updatedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "loan.cancelled");
  },
});

export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await loanFor(ctx, loanId);
    if (loan.lenderId !== me._id) throw new ConvexError("Only the tool's owner can mark it returned.");
    if (loan.status !== "approved") throw new ConvexError("Only active loans can be marked returned.");
    await ctx.db.patch(loanId, { status: "returned", updatedAt: Date.now() });
    await enqueueLoanEvent(ctx, loanId, "loan.returned");
  },
});

/** Shapes a loan for display: first names only, plus recent automation activity. */
async function present(ctx: QueryCtx, loan: Doc<"loans">) {
  const [tool, lender, borrower] = await Promise.all([
    ctx.db.get(loan.toolId),
    ctx.db.get(loan.lenderId),
    ctx.db.get(loan.borrowerId),
  ]);
  const events = await ctx.db
    .query("automationEvents")
    .withIndex("by_loan", (q) => q.eq("loanId", loan._id))
    .order("desc")
    .take(3);
  return {
    _id: loan._id,
    toolName: tool?.name ?? "Removed tool",
    lenderFirstName: lender ? firstName(lender.name) : "Neighbor",
    borrowerFirstName: borrower ? firstName(borrower.name) : "Neighbor",
    startDate: loan.startDate,
    endDate: loan.endDate,
    status: loan.status,
    overdue: loan.status === "approved" && loan.endDate < todayUtc(),
    activity: events.map((e) => ({ kind: e.kind, status: e.status, at: e._creationTime })),
  };
}

export const myRequests = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_borrower", (q) => q.eq("borrowerId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_lender", (q) => q.eq("lenderId", me._id))
      .order("desc")
      .take(100);
    return Promise.all(loans.map((l) => present(ctx, l)));
  },
});

export const allForAdmin = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const loans = await ctx.db.query("loans").order("desc").take(200);
    return Promise.all(loans.map((l) => present(ctx, l)));
  },
});
