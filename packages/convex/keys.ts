import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const keys = () =>
  createEnv({
    server: {
      CONVEX_DEPLOY_KEY: z.string().optional(),
    },
    client: {
      NEXT_PUBLIC_CONVEX_URL: z.string().url().optional(),
      NEXT_PUBLIC_CONVEX_SITE_URL: z.string().url().optional(),
    },
    runtimeEnv: {
      CONVEX_DEPLOY_KEY: process.env.CONVEX_DEPLOY_KEY,
      NEXT_PUBLIC_CONVEX_URL: process.env.NEXT_PUBLIC_CONVEX_URL,
      NEXT_PUBLIC_CONVEX_SITE_URL: process.env.NEXT_PUBLIC_CONVEX_SITE_URL,
    },
    emptyStringAsUndefined: true,
  });
