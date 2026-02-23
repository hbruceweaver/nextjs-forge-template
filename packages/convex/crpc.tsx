"use client";

import { createCRPCContext } from "better-convex/react";
import { api } from "./convex/functions/_generated/api";
import { meta } from "./convex/shared/meta";

export const { CRPCProvider, useCRPC, useCRPCClient } = createCRPCContext<
  typeof api
>({
  api,
  meta,
  convexSiteUrl: process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "",
});
