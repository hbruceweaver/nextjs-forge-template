import { CRPCError, initCRPC } from "better-convex/server";
import type { DataModel } from "../functions/_generated/dataModel";
import { withOrm } from "./orm";

type Meta = {
  auth?: "optional" | "required";
};

const c = initCRPC
  .dataModel<DataModel>()
  .context({
    query: (ctx) => withOrm(ctx),
    mutation: (ctx) => withOrm(ctx),
  })
  .meta<Meta>()
  .create();

// --- Auth middleware (Clerk) ---

async function lookupUserByIdentity(
  ctx: ReturnType<typeof withOrm>,
  subject: string
) {
  return ctx.db
    .query("users")
    .withIndex("byExternalId", (q) => q.eq("externalId", subject))
    .unique();
}

// --- Public (no auth) ---

export const publicQuery = c.query;
export const publicMutation = c.mutation;
export const publicAction = c.action;

// --- Internal (server-to-server) ---

export const privateQuery = c.query.internal();
export const privateMutation = c.mutation.internal();
export const privateAction = c.action.internal();

// --- Optional auth (ctx.user may be null) ---

export const optionalAuthQuery = c.query
  .meta({ auth: "optional" })
  .use(async ({ ctx, next }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return next({ ctx: { ...ctx, user: null, userId: null } });
    }

    const user = await lookupUserByIdentity(ctx, identity.subject);
    return next({
      ctx: { ...ctx, user, userId: user?._id ?? null },
    });
  });

// --- Required auth (ctx.user guaranteed) ---

export const authQuery = c.query
  .meta({ auth: "required" })
  .use(async ({ ctx, next }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new CRPCError({
        code: "UNAUTHORIZED",
        message: "Not authenticated",
      });
    }

    const user = await lookupUserByIdentity(ctx, identity.subject);
    if (!user) {
      throw new CRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    return next({ ctx: { ...ctx, user, userId: user._id } });
  });

export const authMutation = c.mutation
  .meta({ auth: "required" })
  .use(async ({ ctx, next }) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new CRPCError({
        code: "UNAUTHORIZED",
        message: "Not authenticated",
      });
    }

    const user = await lookupUserByIdentity(ctx, identity.subject);
    if (!user) {
      throw new CRPCError({
        code: "UNAUTHORIZED",
        message: "User not found",
      });
    }

    return next({ ctx: { ...ctx, user, userId: user._id } });
  });

// --- HTTP route builders ---

export const publicRoute = c.httpAction;
export const router = c.router;
