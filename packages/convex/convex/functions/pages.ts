import { z } from "zod";
import { publicMutation, publicQuery } from "../lib/crpc";

export const list = publicQuery.query(async ({ ctx }) => {
  return await ctx.db.query("pages").collect();
});

export const create = publicMutation
  .input(z.object({ name: z.string() }))
  .mutation(async ({ ctx, input }) => {
    return await ctx.db.insert("pages", { name: input.name });
  });
