import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

// -- Helpers for Web Crypto HMAC (Convex runtime = V8 isolate, no Node APIs) --

async function hmacSha256(key: Uint8Array, message: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key.buffer as ArrayBuffer,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
}

function bufToBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function base64Decode(str: string): Uint8Array {
  const bin = atob(str);
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    arr[i] = bin.charCodeAt(i);
  }
  return arr;
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// -- Svix (Clerk) webhook verification --

async function verifySvixSignature(
  secret: string,
  svixId: string,
  svixTimestamp: string,
  svixSignature: string,
  body: string,
): Promise<boolean> {
  // Secret format: whsec_<base64>
  const secretBytes = base64Decode(secret.replace("whsec_", ""));
  const signedContent = `${svixId}.${svixTimestamp}.${body}`;
  const sig = await hmacSha256(secretBytes, signedContent);
  const expected = bufToBase64(sig);

  // svix-signature header: "v1,<base64sig> v1,<base64sig2> ..."
  const signatures = svixSignature.split(" ");
  for (const versionedSig of signatures) {
    const [, sigValue] = versionedSig.split(",");
    if (sigValue && timingSafeEqual(expected, sigValue)) {
      return true;
    }
  }
  return false;
}

// -- Stripe webhook signature verification --

async function verifyStripeSignature(
  secret: string,
  stripeSignature: string,
  body: string,
): Promise<boolean> {
  const encoder = new TextEncoder();
  const parts = stripeSignature.split(",");
  const timestamp = parts.find((p) => p.startsWith("t="))?.slice(2);
  const v1Signature = parts.find((p) => p.startsWith("v1="))?.slice(3);

  if (!(timestamp && v1Signature)) return false;

  const signedPayload = `${timestamp}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(signedPayload));
  const expected = bufToHex(sig);

  return timingSafeEqual(expected, v1Signature);
}

// -- Clerk webhook: user sync --

http.route({
  path: "/clerk-users-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return new Response("Clerk webhook secret not configured", {
        status: 500,
      });
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!(svixId && svixTimestamp && svixSignature)) {
      return new Response("Missing svix headers", { status: 400 });
    }

    const payload = await request.text();

    const valid = await verifySvixSignature(
      webhookSecret,
      svixId,
      svixTimestamp,
      svixSignature,
      payload,
    );

    if (!valid) {
      return new Response("Invalid webhook signature", { status: 400 });
    }

    const event = JSON.parse(payload) as {
      type: string;
      data: Record<string, unknown>;
    };

    switch (event.type) {
      case "user.created":
      case "user.updated": {
        await ctx.runMutation(internal.users.upsertFromClerk, {
          data: event.data,
        });
        break;
      }
      case "user.deleted": {
        const clerkId = event.data.id as string | undefined;
        if (clerkId) {
          await ctx.runMutation(internal.users.deleteFromClerk, { clerkId });
        }
        break;
      }
      default:
        break;
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

// -- Stripe webhook: subscription tracking --

http.route({
  path: "/stripe-webhook",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (!webhookSecret) {
      return new Response("Stripe webhook secret not configured", {
        status: 500,
      });
    }

    const signature = request.headers.get("stripe-signature");

    if (!signature) {
      return new Response("Missing stripe-signature header", { status: 400 });
    }

    const payload = await request.text();

    const valid = await verifyStripeSignature(webhookSecret, signature, payload);

    if (!valid) {
      return new Response("Invalid signature", { status: 400 });
    }

    const event = JSON.parse(payload) as {
      type: string;
      data: { object: Record<string, unknown> };
    };

    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object;
        const customerId =
          typeof session.customer === "string"
            ? session.customer
            : (session.customer as { id: string } | null)?.id;

        if (customerId) {
          await ctx.runMutation(internal.subscriptions.upsertSubscription, {
            stripeCustomerId: customerId,
            status: "active",
          });
        }
        break;
      }
      case "customer.subscription.updated": {
        const subscription = event.data.object;
        const customerId =
          typeof subscription.customer === "string"
            ? subscription.customer
            : (subscription.customer as { id: string } | null)?.id;

        if (customerId) {
          await ctx.runMutation(internal.subscriptions.upsertSubscription, {
            stripeCustomerId: customerId,
            stripeSubscriptionId: subscription.id as string,
            status: subscription.status as string,
          });
        }
        break;
      }
      case "subscription_schedule.canceled": {
        const schedule = event.data.object;
        const customerId =
          typeof schedule.customer === "string"
            ? schedule.customer
            : (schedule.customer as { id: string } | null)?.id;

        if (customerId) {
          await ctx.runMutation(internal.subscriptions.cancelSubscription, {
            stripeCustomerId: customerId,
          });
        }
        break;
      }
      default:
        break;
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
