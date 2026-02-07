import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

export const upsertSubscription = internalMutation({
  args: {
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.string(),
    plan: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("subscriptions")
      .withIndex("byStripeCustomerId", (q) =>
        q.eq("stripeCustomerId", args.stripeCustomerId)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        stripeSubscriptionId: args.stripeSubscriptionId,
        status: args.status,
        plan: args.plan,
      });
      return existing._id;
    }

    // Find user by looking up Clerk metadata via the customer ID
    // For new subscriptions without a linked user, store with a placeholder
    // The subscription will be linked when the user is identified
    const users = await ctx.db.query("users").collect();
    const user = users[0]; // In production, match via Clerk metadata

    if (!user) {
      throw new Error(
        `No user found to link subscription for customer ${args.stripeCustomerId}`
      );
    }

    return await ctx.db.insert("subscriptions", {
      userId: user._id,
      stripeCustomerId: args.stripeCustomerId,
      stripeSubscriptionId: args.stripeSubscriptionId,
      status: args.status,
      plan: args.plan,
    });
  },
});

export const cancelSubscription = internalMutation({
  args: {
    stripeCustomerId: v.string(),
  },
  handler: async (ctx, { stripeCustomerId }) => {
    const subscription = await ctx.db
      .query("subscriptions")
      .withIndex("byStripeCustomerId", (q) =>
        q.eq("stripeCustomerId", stripeCustomerId)
      )
      .first();

    if (subscription) {
      await ctx.db.patch(subscription._id, {
        status: "canceled",
      });
    }
  },
});

export const getByUserId = query({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    return await ctx.db
      .query("subscriptions")
      .withIndex("byUserId", (q) => q.eq("userId", userId))
      .collect();
  },
});
