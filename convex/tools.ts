import { ConvexError, v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { category, condition } from "./schema";
import { firstName, getCurrentUser, requireUser } from "./lib/auth";
import { enqueueLoanEvent } from "./lib/notify";

const MAX_NAME = 80;
const MAX_DESCRIPTION = 500;

function cleanText(value: string, field: string, max: number): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ConvexError(`${field} is required.`);
  if (trimmed.length > max) throw new ConvexError(`${field} must be ${max} characters or fewer.`);
  return trimmed;
}

async function isOnLoan(ctx: QueryCtx, toolId: Id<"tools">): Promise<boolean> {
  const loans = await ctx.db
    .query("loans")
    .withIndex("by_tool", (q) => q.eq("toolId", toolId))
    .collect();
  return loans.some((l) => l.status === "approved");
}

/** Public page: name and category only. No owner details, no descriptions. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const tools = await ctx.db.query("tools").order("desc").take(200);
    const visible = tools.filter((t) => !t.removedAt);
    const result = [];
    for (const t of visible) {
      if (!(await isOnLoan(ctx, t._id))) {
        result.push({ _id: t._id, name: t.name, category: t.category });
      }
    }
    return result;
  },
});

/** Signed-in browse view with availability, optionally filtered by category. */
export const listForMembers = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tools = args.category
      ? await ctx.db
          .query("tools")
          .withIndex("by_category", (q) => q.eq("category", args.category!))
          .take(200)
      : await ctx.db.query("tools").order("desc").take(200);

    const result = [];
    for (const t of tools.filter((t) => !t.removedAt)) {
      const owner = (await ctx.db.get(t.ownerId)) as Doc<"users"> | null;
      result.push({
        _id: t._id,
        name: t.name,
        category: t.category,
        condition: t.condition,
        description: t.description,
        available: !(await isOnLoan(ctx, t._id)),
        isMine: t.ownerId === me._id,
        ownerFirstName: owner ? firstName(owner.name) : "Neighbor",
        ownerTrusted: owner?.trustedLender ?? false,
      });
    }
    return result;
  },
});

export const myListings = query({
  args: {},
  handler: async (ctx) => {
    const me = await getCurrentUser(ctx);
    if (!me) return [];
    const tools = await ctx.db
      .query("tools")
      .withIndex("by_owner", (q) => q.eq("ownerId", me._id))
      .collect();
    const result = [];
    for (const t of tools.filter((t) => !t.removedAt)) {
      result.push({ ...t, available: !(await isOnLoan(ctx, t._id)) });
    }
    return result;
  },
});

export const create = mutation({
  args: { name: v.string(), category, condition, description: v.string() },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return await ctx.db.insert("tools", {
      ownerId: me._id,
      name: cleanText(args.name, "Name", MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", MAX_DESCRIPTION),
    });
  },
});

export const update = mutation({
  args: {
    toolId: v.id("tools"),
    name: v.string(),
    category,
    condition,
    description: v.string(),
  },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(args.toolId);
    if (!tool || tool.removedAt) throw new ConvexError("Tool not found.");
    // Owners edit their own listings. Admins can remove, but not rewrite, others' listings.
    if (tool.ownerId !== me._id) throw new ConvexError("You can only edit your own listings.");
    await ctx.db.patch(args.toolId, {
      name: cleanText(args.name, "Name", MAX_NAME),
      category: args.category,
      condition: args.condition,
      description: cleanText(args.description, "Description", MAX_DESCRIPTION),
    });
  },
});

/** Owners delete their own listings; admins can remove any listing. Soft delete keeps loan history intact. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool || tool.removedAt) throw new ConvexError("Tool not found.");
    if (tool.ownerId !== me._id && me.role !== "admin") {
      throw new ConvexError("You can only delete your own listings.");
    }
    if (await isOnLoan(ctx, toolId)) {
      throw new ConvexError("This tool is on loan. Mark it returned first.");
    }
    // Close any open requests so borrowers are not left waiting.
    const pending = await ctx.db
      .query("loans")
      .withIndex("by_tool", (q) => q.eq("toolId", toolId))
      .collect();
    for (const loan of pending.filter((l) => l.status === "pending")) {
      await ctx.db.patch(loan._id, { status: "cancelled", updatedAt: Date.now() });
      await enqueueLoanEvent(ctx, loan._id, "loan.cancelled");
    }
    await ctx.db.patch(toolId, { removedAt: Date.now(), removedBy: me._id });
  },
});
