import "server-only";
import { PostHog } from "posthog-node";
import { keys } from "./keys";

const createAnalytics = () => {
  const { NEXT_PUBLIC_POSTHOG_KEY, NEXT_PUBLIC_POSTHOG_HOST } = keys();

  if (!NEXT_PUBLIC_POSTHOG_KEY) {
    return null;
  }

  return new PostHog(NEXT_PUBLIC_POSTHOG_KEY, {
    host: NEXT_PUBLIC_POSTHOG_HOST,

    // Don't batch events and flush immediately - we're running in a serverless environment
    flushAt: 1,
    flushInterval: 0,
  });
};

export const analytics = createAnalytics();
