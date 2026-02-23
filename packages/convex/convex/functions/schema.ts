import {
  convexTable,
  defineRelations,
  defineSchema,
  id,
  index,
  text,
} from "better-convex/orm";

export const users = convexTable(
  "users",
  {
    name: text().notNull(),
    email: text(),
    imageUrl: text(),
    externalId: text().notNull(),
  },
  (t) => [index("byExternalId").on(t.externalId)]
);

export const subscriptions = convexTable(
  "subscriptions",
  {
    userId: id("users").notNull(),
    stripeCustomerId: text().notNull(),
    stripeSubscriptionId: text(),
    status: text().notNull(),
    plan: text(),
  },
  (t) => [
    index("byUserId").on(t.userId),
    index("byStripeCustomerId").on(t.stripeCustomerId),
  ]
);

export const pages = convexTable("pages", {
  name: text().notNull(),
});

const tables = { users, subscriptions, pages };
export default defineSchema(tables, { strict: false });

export const relations = defineRelations(tables, (r) => ({
  users: { subscriptions: r.many.subscriptions() },
  subscriptions: {
    user: r.one.users({
      from: r.subscriptions.userId,
      to: r.users.id,
    }),
  },
  pages: {},
}));
