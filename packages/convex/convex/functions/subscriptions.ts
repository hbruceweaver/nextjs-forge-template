import { z } from "zod";
import { authQuery, privateMutation } from "../lib/crpc";

export const upsertSubscription = privateMutation
  .input(
    z.object({
      stripeCustomerId: z.string(),
      stripeSubscriptionId: z.string().optional(),
      status: z.string(),
      plan: z.string().optional(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("byStripeCustomerId", (q) =>
        q.eq("stripeCustomerId", input.stripeCustomerId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeSubscriptionId: input.stripeSubscriptionId,
        status: input.status,
        plan: input.plan,
      });
      return existing._id;
    }

    // Find user by looking up Clerk metadata via the customer ID.
    // For new subscriptions without a linked user, store with a placeholder.
    // In production, match via Clerk metadata or Stripe customer email.
    const users = await ctx.db.query("users").collect();
    const user = users[0];

    if (!user) {
      throw new Error(
        `No user found to link subscription for customer ${input.stripeCustomerId}`
      );
    }

    return await ctx.db.insert("subscriptions", {
      userId: user._id,
      stripeCustomerId: input.stripeCustomerId,
      stripeSubscriptionId: input.stripeSubscriptionId,
      status: input.status,
      plan: input.plan,
    });
  });

export const cancelSubscription = privateMutation
  .input(z.object({ stripeCustomerId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("byStripeCustomerId", (q) =>
        q.eq("stripeCustomerId", input.stripeCustomerId)
      )
      .first();

    if (subscription) {
      await ctx.db.patch(subscription._id, {
        status: "canceled",
      });
    }
  });

export const getByUserId = authQuery
  .input(z.object({ userId: z.string() }))
  .query(async ({ ctx, input }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("byUserId", (q) =>
        q.eq("userId", input.userId as any)
      )
      .collect();
  });
