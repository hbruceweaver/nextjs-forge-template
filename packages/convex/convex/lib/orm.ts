import { createOrm } from "better-convex/orm";
import type { MutationCtx, QueryCtx } from "../functions/_generated/server";
import { relations } from "../functions/schema";

export const orm = createOrm({ schema: relations });

export const withOrm = <Ctx extends QueryCtx | MutationCtx>(ctx: Ctx) => ({
  ...ctx,
  orm: orm.db(ctx),
});
