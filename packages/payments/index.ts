import "server-only";
import Stripe from "stripe";
import { keys } from "./keys";

export const stripe = keys().STRIPE_SECRET_KEY
  ? new Stripe(keys().STRIPE_SECRET_KEY as string, {
      apiVersion: "2025-11-17.clover",
    })
  : null;

export type { Stripe } from "stripe";
