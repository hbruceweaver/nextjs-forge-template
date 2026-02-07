import { database } from "@repo/database";

export const GET = async () => {
  if (!database) {
    return new Response("Database not configured", { status: 503 });
  }

  const newPage = await database.page.create({
    data: {
      name: "cron-temp",
    },
  });

  await database.page.delete({
    where: {
      id: newPage.id,
    },
  });

  return new Response("OK", { status: 200 });
};
