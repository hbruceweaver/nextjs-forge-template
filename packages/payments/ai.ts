import { StripeAgentToolkit } from "@stripe/agent-toolkit/ai-sdk";
import { keys } from "./keys";

export const paymentsAgentToolkit = keys().STRIPE_SECRET_KEY
  ? new StripeAgentToolkit({
      secretKey: keys().STRIPE_SECRET_KEY as string,
      configuration: {
        actions: {
          paymentLinks: {
            create: true,
          },
          products: {
            create: true,
          },
          prices: {
            create: true,
          },
        },
      },
    })
  : null;
