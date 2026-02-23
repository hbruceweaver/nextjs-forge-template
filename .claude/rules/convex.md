---
paths:
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.js"
  - "**/*.jsx"
---

# Convex + better-convex Guidelines

This project uses **better-convex** (cRPC builders + ORM + TanStack Query) with **Clerk** auth.
See `packages/convex/CLAUDE.md` for project-specific patterns and file layout.
See `.llms-txt/better-convex/` for full better-convex docs.

## Zen of Convex (Core Principles)

### Performance
- **Queries for reads**: Use queries for nearly every app read - they're reactive, cacheable, consistent.
- **Keep functions fast**: Queries/mutations should work with <few hundred records and finish in <100ms.
- **Actions sparingly**: Never use an action if a query or mutation will work. Actions are slower, more expensive, with fewer guarantees.
- **Mutation returns aren't for UI state**: Don't use mutation return values to update UI - let queries and the sync engine do that.
- **TanStack Query handles client caching**: Convex pushes updates via WebSocket into TanStack Query's cache. `staleTime: Infinity` — no polling needed.

### Development Workflow
- **NEVER run `npx convex dev`, `npx convex codegen`, or any bare `convex` CLI command.** Always use `better-convex` via package scripts. Bare `convex` CLI skips `shared/meta.ts` generation, breaking cRPC proxy types.
- **`_generated/` is gitignored**: Run `pnpm --filter @repo/convex codegen` to generate types. Do NOT check in `_generated/`.
- **Keep `better-convex dev` running**: Use `pnpm --filter @repo/convex dev`. Wraps `convex dev` + generates `shared/meta.ts` for cRPC.
- **One-shot codegen**: Use `pnpm --filter @repo/convex codegen` (replaces `npx convex dev --once`).
- **Use dashboard for debugging**: `npx convex dashboard` opens logs, data browser, function stats.
- **Use `console.log`**: Standard debugging works - logs appear in dashboard.

### Architecture Anti-Patterns
- **DON'T call actions from browser**: Instead, call a mutation that writes a record AND schedules the action.
- **Think 'workflow' not 'background job'**: Chain effects as `action -> mutation -> action -> mutation`, letting apps follow via queries.
- **Record progress incrementally**: Do smaller batches, record progress with mutations.

### Avoiding Write Conflicts (OCC)
- **Don't read entire tables**: Use indexed queries with selective range expressions.
- **Don't write to same document rapidly**: Design data model to spread writes across documents.
```typescript
// BAD - reads entire table, conflicts with any insert
const tasks = await ctx.db.query("tasks").collect();

// GOOD - reads only needed documents via index
const tasks = await ctx.db.query("tasks")
  .withIndex("byUserId", q => q.eq("userId", userId))
  .collect();
```

### Avoiding Circular Imports
- **Keep schema pure**: Don't import from procedure files into `schema.ts`.
- **Detect cycles**: `npx madge convex/ --extensions ts --exclude api.d.ts --circular`

## Procedure Definitions (cRPC)

### ALWAYS use cRPC builders
NEVER use vanilla `query()`/`mutation()`/`action()` from `convex/server`. Use cRPC builders from `../lib/crpc`.

```typescript
// BAD - vanilla Convex
import { query } from "./_generated/server";
import { v } from "convex/values";
export const list = query({
  args: { limit: v.number() },
  handler: async (ctx, args) => { ... },
});

// GOOD - cRPC builder
import { z } from "zod";
import { publicQuery } from "../lib/crpc";
export const list = publicQuery
  .input(z.object({ limit: z.number() }))
  .query(async ({ ctx, input }) => { ... });
```

### Builder Reference

| Builder | Auth | Use For |
|---------|------|---------|
| `publicQuery` / `publicMutation` / `publicAction` | None | Public endpoints |
| `privateQuery` / `privateMutation` / `privateAction` | Internal only | Webhooks, scheduled jobs, server-to-server |
| `optionalAuthQuery` | `ctx.user` may be null | Public pages with optional personalization |
| `authQuery` / `authMutation` | `ctx.user` guaranteed | Authenticated endpoints |
| `publicRoute` / `router` | Varies | HTTP endpoints |

### Input Validation (Zod, not v.*)
ALWAYS use Zod for procedure inputs. NEVER use Convex `v.*` validators in cRPC procedures.

```typescript
// Zod equivalents of common Convex validators:
// v.string()           -> z.string()
// v.number()           -> z.number()
// v.boolean()          -> z.boolean()
// v.id("tableName")    -> z.string()   (use z.string() at procedure boundaries)
// v.optional(v.string()) -> z.string().optional()
// v.array(v.string())  -> z.array(z.string())
// v.object({...})      -> z.object({...})
// v.null()             -> z.null()

// .input() MUST be z.object() at root level
.input(z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  active: z.boolean().optional(),
}))
```

### Procedure Patterns

```typescript
// Query (read-only, real-time subscriptions)
export const list = publicQuery
  .input(z.object({ limit: z.number().optional() }))
  .query(async ({ ctx, input }) => {
    return ctx.db.query("items").take(input.limit ?? 50).collect();
  });

// Mutation (write, transactional)
export const create = authMutation
  .input(z.object({ name: z.string().min(1) }))
  .mutation(async ({ ctx, input }) => {
    return ctx.db.insert("items", { name: input.name, userId: ctx.userId });
  });

// Internal (webhooks, scheduled jobs)
export const processJob = privateMutation
  .input(z.object({ data: z.any() }))
  .mutation(async ({ ctx, input }) => {
    // Only callable via ctx.runMutation(internal.jobs.processJob, {...})
  });

// Paginated query
export const listPaginated = publicQuery
  .input(z.object({ userId: z.string().optional() }))
  .paginated({ limit: 20, item: ItemSchema })
  .query(async ({ ctx, input }) => {
    return ctx.orm.query.items.findMany({
      where: input.userId ? { userId: input.userId } : {},
      cursor: input.cursor,
      limit: input.limit,
    });
  });
```

### Error Handling
Use `CRPCError` for typed errors with HTTP status codes:
```typescript
import { CRPCError } from "better-convex/server";

throw new CRPCError({ code: "UNAUTHORIZED", message: "Not authenticated" });
throw new CRPCError({ code: "NOT_FOUND", message: "Resource not found" });
throw new CRPCError({ code: "BAD_REQUEST", message: "Invalid input" });
throw new CRPCError({ code: "FORBIDDEN", message: "Access denied" });
```

## Schema (ORM)

### ALWAYS use better-convex ORM schema
NEVER use `defineSchema`/`defineTable` from `convex/server`. Use ORM builders from `better-convex/orm`.

```typescript
// BAD - vanilla Convex schema
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export default defineSchema({
  users: defineTable({ name: v.string() }).index("byEmail", ["email"]),
});

// GOOD - ORM schema
import { convexTable, defineRelations, defineSchema, id, index, text } from "better-convex/orm";

export const users = convexTable("users", {
  name: text().notNull(),
  email: text(),
}, (t) => [index("byEmail").on(t.email)]);

const tables = { users };
export default defineSchema(tables, { strict: false });
export const relations = defineRelations(tables, (r) => ({
  users: {},
}));
```

### Column Types

| TypeScript Type | Builder | Notes |
|----------------|---------|-------|
| `string` | `text().notNull()` | |
| `string \| null` | `text()` | Nullable by default |
| `number` | `integer().notNull()` | |
| `boolean` | `boolean().notNull()` | |
| `Id<"users">` | `id("users").notNull()` | |
| `Date` | `timestamp().notNull().defaultNow()` | Point-in-time |

- Fields are **nullable by default**. Use `.notNull()` for required fields.
- `id` and `createdAt` are auto-generated by Convex. Do NOT define them manually.
- Table/index names must match existing Convex deployment exactly.

### Relations
```typescript
export const relations = defineRelations(tables, (r) => ({
  users: { posts: r.many.posts() },
  posts: {
    author: r.one.users({ from: r.posts.userId, to: r.users.id }),
  },
}));
```

### Indexes
```typescript
// Standard index
(t) => [index("byUserId").on(t.userId)]

// Search index
(t) => [searchIndex("byText").on(t.title).filter(t.authorId)]

// Vector index
(t) => [vectorIndex("embedding_vec").on(t.embedding).dimensions(1536).filter(t.authorId)]
```

## Context

Every cRPC procedure receives `ctx` with:
- `ctx.db` — vanilla Convex database access (always available)
- `ctx.orm` — ORM queries/mutations (attached via `withOrm` in crpc.ts)
- `ctx.auth` — Convex auth object
- `ctx.user` — user document (only in auth middleware procedures)
- `ctx.userId` — user ID (only in auth middleware procedures)

### ORM Queries
```typescript
// findMany with relations
const posts = await ctx.orm.query.posts.findMany({
  where: { published: true },
  orderBy: { createdAt: "desc" },
  limit: 10,
  with: { author: true },
});

// findFirst
const user = await ctx.orm.query.users.findFirst({
  where: { id: userId },
});
```

### ORM Mutations
```typescript
import { eq } from "better-convex/orm";
import { users } from "../functions/schema";

// Insert
await ctx.orm.insert(users).values({ name: "Alice", email: "alice@example.com" });

// Update
await ctx.orm.update(users).set({ name: "Bob" }).where(eq(users.id, userId));

// Delete
await ctx.orm.delete(users).where(eq(users.id, userId));
```

## Auth (Clerk)

This project uses **Clerk** for authentication. Do NOT use Better Auth patterns.

### How it works

Auth is handled by cRPC middleware in `lib/crpc.ts`. You don't write auth checks manually — pick the right builder:

| Builder | Auth Behavior |
|---------|---------------|
| `publicQuery` / `publicMutation` | No auth check |
| `optionalAuthQuery` | `ctx.user` is `User \| null`, `ctx.userId` is `Id<"users"> \| null` |
| `authQuery` / `authMutation` | `ctx.user` and `ctx.userId` guaranteed (throws `UNAUTHORIZED` if missing) |
| `privateQuery` / `privateMutation` | Internal only (webhooks, scheduled jobs) — no user context |

The middleware flow: `ctx.auth.getUserIdentity()` → lookup user by `externalId` in users table → attach to `ctx`.

### Client-side provider stack

```
ConvexProviderWithClerk    ← from "convex/react-clerk" — syncs Clerk JWT → Convex WebSocket
  └─ QueryClientProvider   ← TanStack Query cache
       └─ CRPCProvider     ← cRPC proxy
```

- `ConvexProviderWithClerk` from `convex/react-clerk` + `useAuth` from `@clerk/nextjs`
- Clerk manages the JWT lifecycle; Convex validates it on every WebSocket handshake
- Auth-aware queries (`authQuery`) automatically skip when the user isn't authenticated

### DON'T use (Better Auth patterns)
```typescript
// These are for Better Auth — NOT for Clerk projects:
import { getSession } from "better-convex/auth";           // ❌
import { ConvexAuthProvider } from "better-convex/auth-client"; // ❌
import { useAuthStore } from "better-convex/react";         // ❌
import { getAuth } from "better-convex/auth";               // ❌
```

## Next.js Integration (TanStack Query)

### Client Components — use TanStack Query + useCRPC
```tsx
"use client";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useCRPC } from "@repo/convex/client";

function MyComponent() {
  const crpc = useCRPC();

  // Real-time query (auto WebSocket subscription)
  const { data, isPending } = useQuery(crpc.pages.list.queryOptions({}));

  // With args
  const { data: user } = useQuery(crpc.users.current.queryOptions({}));

  // Auth-aware (skips when not logged in)
  const { data: settings } = useQuery(
    crpc.users.settings.queryOptions({}, { skipUnauth: true })
  );

  // Mutation
  const createPage = useMutation(crpc.pages.create.mutationOptions());
  createPage.mutate({ name: "New Page" });

  // Mutation with callbacks
  const updateUser = useMutation(
    crpc.users.update.mutationOptions({
      onSuccess: () => toast.success("Updated!"),
      onError: (err) => toast.error(err.message),
    })
  );
}
```

### Imperative Calls
```tsx
import { useCRPCClient } from "@repo/convex/client";

const client = useCRPCClient();
const user = await client.users.current.query({});
await client.pages.create.mutate({ name: "New" });
```

### DON'T use vanilla Convex React hooks
```tsx
// BAD
import { useQuery } from "convex/react";
const data = useQuery(api.pages.list, {});

// GOOD
import { useQuery } from "@tanstack/react-query";
import { useCRPC } from "@repo/convex/client";
const crpc = useCRPC();
const { data } = useQuery(crpc.pages.list.queryOptions({}));
```

## HTTP Endpoints

Existing webhooks (`http.ts`) use vanilla `httpRouter`. New HTTP endpoints should use cRPC's HTTP router:

```typescript
import { z } from "zod";
import { publicRoute, router } from "../lib/crpc";

export const health = publicRoute
  .get("/api/health")
  .output(z.object({ status: z.string() }))
  .query(async () => ({ status: "ok" }));

export const appRouter = router({ health });
```

## Low-Level Convex (ctx.db)

These guidelines apply when using `ctx.db` directly (webhooks, internal procedures, etc.).

### Query guidelines
- Do NOT use `.filter()`. Use `.withIndex()` instead.
- No `.delete()` on queries. Use `.collect()` then `ctx.db.delete(row._id)` per row.
- Use `.unique()` for single document (throws if multiple match).
- Order: `.order("asc")` or `.order("desc")`. Default ascending `_creationTime`.

### Mutation guidelines
- **Use explicit table names** (Convex 1.31.0+):
```typescript
await ctx.db.get("messages", messageId);       // GOOD
await ctx.db.patch("messages", messageId, {}); // GOOD
await ctx.db.delete("messages", messageId);    // GOOD
await ctx.db.get(messageId);                   // BAD (deprecated)
```

### Function calling
- `ctx.runQuery` / `ctx.runMutation` / `ctx.runAction` take `FunctionReference`, not the function itself.
- Minimize calls from actions to queries/mutations (each is a separate transaction = race condition risk).
- For same-file calls, add return type annotation to avoid TS circularity.

### Function references
- `api` object for public functions, `internal` object for internal functions.
- File-based routing: `functions/users.ts` export `list` = `api.users.list`.
- Internal: `functions/users.ts` export `upsertFromClerk` via `privateMutation` = `internal.users.upsertFromClerk`.

## Action guidelines
- Add `"use node";` at top of files using Node.js built-ins.
- Actions have NO `ctx.db` access. Use `ctx.runQuery`/`ctx.runMutation` instead.

## Scheduling

### Crons
- Use `crons.interval()` or `crons.cron()` only. NOT `crons.hourly`/`daily`/`weekly`.
- Takes `FunctionReference` (not the function directly).
```ts
import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();
crons.interval("cleanup", { hours: 2 }, internal.jobs.cleanup, {});
export default crons;
```

## File Storage
- `ctx.storage.getUrl()` returns signed URL (or `null` if missing).
- Query `_storage` system table for metadata: `ctx.db.system.get("_storage", fileId)`.
- Do NOT use deprecated `ctx.storage.getMetadata`.

## Full Text Search
```typescript
const results = await ctx.db
  .query("messages")
  .withSearchIndex("searchBody", (q) =>
    q.search("body", "hello hi").eq("channel", "#general"),
  )
  .take(10);
```

## TypeScript
- Use `Id<"tableName">` from `_generated/dataModel` for typed IDs.
- Add `@types/node` when using Node.js built-in modules.
- `strictFunctionTypes: false` is required in tsconfig for cRPC middleware inference.
