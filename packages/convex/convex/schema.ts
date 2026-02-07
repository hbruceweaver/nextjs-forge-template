import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    name: v.string(),
    email: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    externalId: v.string(),
  }).index("byExternalId", ["externalId"]),

  subscriptions: defineTable({
    userId: v.id("users"),
    stripeCustomerId: v.string(),
    stripeSubscriptionId: v.optional(v.string()),
    status: v.string(),
    plan: v.optional(v.string()),
  })
    .index("byUserId", ["userId"])
    .index("byStripeCustomerId", ["stripeCustomerId"]),

  pages: defineTable({
    name: v.string(),
  }),
});
