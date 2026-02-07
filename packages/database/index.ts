import "server-only";

import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import ws from "ws";
import { PrismaClient } from "./generated/client";
import { keys } from "./keys";

const globalForPrisma = global as unknown as { prisma: PrismaClient };

neonConfig.webSocketConstructor = ws;

const createDatabase = () => {
  const url = keys().DATABASE_URL;
  if (!url) {
    return null;
  }

  const adapter = new PrismaNeon({ connectionString: url });
  return new PrismaClient({ adapter });
};

export const database =
  globalForPrisma.prisma || createDatabase();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = database;
}

// biome-ignore lint/performance/noBarrelFile: re-exporting
export * from "./generated/client";
