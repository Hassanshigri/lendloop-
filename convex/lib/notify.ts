import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { internal } from "../_generated/api";

export type LoanEvent =
  | "loan.requested"
  | "loan.approved"
  | "loan.declined"
  | "loan.cancelled"
  | "loan.returned";

/**
 * Records an outgoing webhook and schedules delivery in the same transaction as
 * the status change, so a notification is never lost if the mutation commits.
 */
export async function enqueueLoanEvent(ctx: MutationCtx, loanId: Id<"loans">, event: LoanEvent) {
  const eventId = crypto.randomUUID();
  const deliveryId = await ctx.db.insert("webhookDeliveries", {
    loanId,
    event,
    eventId,
    attempts: 0,
    status: "pending",
  });
  await ctx.scheduler.runAfter(0, internal.n8n.deliver, { deliveryId });
}
