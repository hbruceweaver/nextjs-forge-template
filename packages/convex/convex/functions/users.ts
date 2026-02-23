import { z } from "zod";
import { optionalAuthQuery, privateMutation } from "../lib/crpc";

type ClerkUserData = {
  id: string;
  first_name?: string | null;
  last_name?: string | null;
  email_addresses?: { email_address: string }[];
  image_url?: string;
};

export const upsertFromClerk = privateMutation
  .input(z.object({ data: z.any() }))
  .mutation(async ({ ctx, input }) => {
    const event = input.data as ClerkUserData;

    const name =
      [event.first_name, event.last_name].filter(Boolean).join(" ") ||
      "Unknown";

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
  });

export const deleteFromClerk = privateMutation
  .input(z.object({ clerkId: z.string() }))
  .mutation(async ({ ctx, input }) => {
    const user = await ctx.db
      .query("users")
      .withIndex("byExternalId", (q) => q.eq("externalId", input.clerkId))
      .unique();

    if (user) {
      await ctx.db.delete(user._id);
    }
  });

export const current = optionalAuthQuery.query(async ({ ctx }) => {
  return ctx.user;
});
