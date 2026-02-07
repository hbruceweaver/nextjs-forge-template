import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";

type ClerkUserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: { email_address: string }[];
  image_url?: string;
};

export const upsertFromClerk = internalMutation({
  args: {
    data: v.any(),
  },
  handler: async (ctx, { data }) => {
    const event = data as ClerkUserData;

    const name = [event.first_name, event.last_name]
      .filter(Boolean)
      .join(" ") || "Unknown";

    const existing = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", event.id))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        name,
        email: event.email_addresses?.[0]?.email_address,
        imageUrl: event.image_url,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      externalId: event.id,
      name,
      email: event.email_addresses?.[0]?.email_address,
      imageUrl: event.image_url,
    });
  },
});

export const deleteFromClerk = internalMutation({
  args: {
    clerkId: v.string(),
  },
  handler: async (ctx, { clerkId }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", clerkId))
      .unique();

    if (user) {
      await ctx.db.delete(user._id);
    }
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();

    if (!identity) {
      return null;
    }

    return await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) =>
        q.eq("externalId", identity.subject)
      )
      .unique();
  },
});
