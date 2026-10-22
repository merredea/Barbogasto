import { isLastDayOfMonth, monthPeriod, REMINDER_TEXT } from "../../shared/dates";
import { secretsMatch } from "../../shared/password";
import type { Env } from "../env";
import { ApiError, type AppCtx, json } from "./http";
import { deliverPush } from "./push";

export async function sendMonthlyReminders(env: Env, options?: { now?: Date; force?: boolean }) {
  const group = await env.DB.prepare(`SELECT id, timezone FROM groups LIMIT 1`).first<{ id: string; timezone: string }>();
  if (!group) return { sent: 0, reason: "sin_grupo" };
  const now = options?.now ?? new Date();
  if (!options?.force && !isLastDayOfMonth(now, group.timezone)) return { sent: 0, reason: "not_last_day" };
  const period = monthPeriod(now, group.timezone);
  const users = await env.DB.prepare(
    `SELECT u.id FROM users u
     JOIN group_members gm ON gm.user_id = u.id AND gm.group_id = ?
     WHERE u.push_enabled = 1`,
  )
    .bind(group.id)
    .all<{ id: string }>();
  let sent = 0;
  for (const person of users.results) {
    const subscriptions = await env.DB.prepare(`SELECT id, endpoint, p256dh, auth_key FROM push_subscriptions WHERE user_id = ?`)
      .bind(person.id)
      .all<{ id: string; endpoint: string; p256dh: string; auth_key: string }>();
    if (subscriptions.results.length === 0) continue;
    if (!(await claimPush(env, person.id, period))) continue;
    let ok = false;
    for (const subscription of subscriptions.results) {
      const result = await deliverPush(env, { endpoint: subscription.endpoint, p256dh: subscription.p256dh, authKey: subscription.auth_key }, {
        title: "Fin de mes",
        body: REMINDER_TEXT,
        url: "/saldos",
      }).catch(() => "failed" as const);
      if (result === "gone") {
        await env.DB.prepare(`DELETE FROM push_subscriptions WHERE id = ?`).bind(subscription.id).run();
      }
      if (result === "sent") ok = true;
    }
    await env.DB.prepare(
      `UPDATE notification_logs SET status = ? WHERE user_id = ? AND kind = 'month_end' AND period = ? AND channel = 'push'`,
    )
      .bind(ok ? "sent" : "failed", person.id, period)
      .run();
    if (ok) sent += 1;
  }
  return { sent, period, reason: "ok" };
}

export async function runReminderHttp(ctx: AppCtx): Promise<Response> {
  if (!ctx.env.CRON_SECRET) throw new ApiError(503, "config", "El recordatorio no está configurado.");
  const header = ctx.request.headers.get("Authorization") ?? "";
  if (!(await secretsMatch(header, `Bearer ${ctx.env.CRON_SECRET}`))) throw new ApiError(401, "sesion", "No autorizado.");
  return json(await sendMonthlyReminders(ctx.env, { force: ctx.url.searchParams.get("force") === "1" }));
}

async function claimPush(env: Env, userId: string, period: string): Promise<boolean> {
  const now = new Date().toISOString();
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const result = await env.DB.prepare(
    `INSERT INTO notification_logs (id, user_id, kind, period, channel, status, created_at)
     VALUES (?, ?, 'month_end', ?, 'push', 'pending', ?)
     ON CONFLICT (user_id, kind, period, channel) DO UPDATE SET
       status = 'pending',
       created_at = excluded.created_at
     WHERE notification_logs.status = 'failed'
        OR (notification_logs.status = 'pending' AND notification_logs.created_at < ?)`,
  )
    .bind(crypto.randomUUID(), userId, period, now, stale)
    .run();
  return (result.meta.changes ?? 0) > 0;
}
