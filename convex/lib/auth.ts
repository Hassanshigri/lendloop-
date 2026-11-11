import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

/** Returns the signed-in user's record, or null when signed out or not yet stored. */
export async function getCurrentUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  return await ctx.db
    .query("users")
    .withIndex("by_token", (q) => q.eq("tokenIdentifier", identity.tokenIdentifier))
    .unique();
}

/** Every protected function starts here: authorization is enforced on the server, not in the UI. */
export async function requireUser(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await getCurrentUser(ctx);
  if (!user) throw new ConvexError("You must be signed in.");
  return user;
}

export async function requireAdmin(ctx: QueryCtx | MutationCtx): Promise<Doc<"users">> {
  const user = await requireUser(ctx);
  if (user.role !== "admin") throw new ConvexError("Admins only.");
  return user;
}

/** First name only: the most a counterparty or a notification needs. */
export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || "Neighbor";
}
