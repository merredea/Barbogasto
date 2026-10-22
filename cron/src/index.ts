import type { Env } from "../../functions/env";
import { sendMonthlyReminders } from "../../functions/lib/reminders";
import { secretsMatch } from "../../shared/password";

export default {
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(sendMonthlyReminders(env));
  },
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/run") return new Response("No encontrado", { status: 404 });
    if (!env.CRON_SECRET || !(await secretsMatch(request.headers.get("Authorization") ?? "", `Bearer ${env.CRON_SECRET}`))) {
      return new Response("No autorizado", { status: 401 });
    }
    return Response.json(await sendMonthlyReminders(env, { force: url.searchParams.get("force") === "1" }));
  },
};
