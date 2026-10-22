import { reminderPeriodIfDue, REMINDER_TEXT } from "../../shared/dates";
import { ApiError, type AppCtx, json, requireUser } from "./http";

export async function pushKey(ctx: AppCtx): Promise<Response> {
  await requireUser(ctx);
  return json({ publicKey: ctx.env.VAPID_PUBLIC_KEY || null });
}

export async function subscribePush(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const body = objectBody(ctx.body);
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "";
  const keys = body.keys && typeof body.keys === "object" ? (body.keys as Record<string, unknown>) : {};
  const p256dh = typeof keys.p256dh === "string" ? keys.p256dh : "";
  const auth = typeof keys.auth === "string" ? keys.auth : "";
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    throw new ApiError(400, "datos", "La suscripción no es válida.");
  }
  if (parsed.protocol !== "https:" || p256dh.length < 20 || p256dh.length > 200 || auth.length < 10 || auth.length > 200) {
    throw new ApiError(400, "datos", "La suscripción no es válida.");
  }
  const now = new Date().toISOString();
  await ctx.db.batch([
    ctx.db
      .prepare(
        `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_key, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth_key = excluded.auth_key`,
      )
      .bind(crypto.randomUUID(), user.id, endpoint, p256dh, auth, now),
    ctx.db.prepare(`UPDATE users SET push_enabled = 1 WHERE id = ?`).bind(user.id),
  ]);
  return json({ ok: true });
}

export async function unsubscribePush(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  await ctx.db.batch([
    ctx.db.prepare(`DELETE FROM push_subscriptions WHERE user_id = ?`).bind(user.id),
    ctx.db.prepare(`UPDATE users SET push_enabled = 0 WHERE id = ?`).bind(user.id),
  ]);
  return json({ ok: true });
}

export async function reminder(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const period = reminderPeriodIfDue(new Date(), user.timezone);
  if (!period) return json({ show: false, message: REMINDER_TEXT });
  const logs = await ctx.db
    .prepare(`SELECT channel, status FROM notification_logs WHERE user_id = ? AND kind = 'month_end' AND period = ?`)
    .bind(user.id, period)
    .all<{ channel: string; status: string }>();
  const dismissed = logs.results.some((row) => row.channel === "in_app");
  const pushed = logs.results.some((row) => row.channel === "push" && row.status === "sent");
  return json({ show: !dismissed && !pushed, period, message: REMINDER_TEXT });
}

export async function dismissReminder(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const period = reminderPeriodIfDue(new Date(), user.timezone);
  if (!period) return json({ ok: true });
  await ctx.db
    .prepare(
      `INSERT INTO notification_logs (id, user_id, kind, period, channel, status, created_at)
       VALUES (?, ?, 'month_end', ?, 'in_app', 'dismissed', ?)
       ON CONFLICT (user_id, kind, period, channel) DO NOTHING`,
    )
    .bind(crypto.randomUUID(), user.id, period, new Date().toISOString())
    .run();
  return json({ ok: true });
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "datos", "La solicitud no es válida.");
  return body as Record<string, unknown>;
}
