import { login, logout, me, register } from "../lib/auth";
import { createInvite, invitationPreview, listInvites, listMembers } from "../lib/group";
import { ApiError, type AppCtx, assertOrigin, fail, json } from "../lib/http";
import { dismissReminder, pushKey, reminder, subscribePush, unsubscribePush } from "../lib/notifications";
import { balances, createExpense, createSettlement, deleteExpense, deleteSettlement, getExpense, listExpenses, updateExpense } from "../lib/records";
import { runReminderHttp } from "../lib/reminders";
import { scanTicket } from "../lib/scan";
import type { Env } from "../env";

type Handler = (ctx: AppCtx, params: Record<string, string>) => Promise<Response> | Response;

const routes: [string, string, Handler][] = [
  ["POST", "/auth/register", (ctx) => register(ctx)],
  ["POST", "/auth/login", (ctx) => login(ctx)],
  ["POST", "/auth/logout", (ctx) => logout(ctx)],
  ["GET", "/auth/me", (ctx) => me(ctx)],
  ["GET", "/members", (ctx) => listMembers(ctx)],
  ["GET", "/invitations", (ctx) => listInvites(ctx)],
  ["POST", "/invitations", (ctx) => createInvite(ctx)],
  ["GET", "/invitations/:token", (ctx, params) => invitationPreview(ctx, params)],
  ["GET", "/expenses", (ctx) => listExpenses(ctx)],
  ["POST", "/expenses", (ctx) => createExpense(ctx)],
  ["GET", "/expenses/:id", (ctx, params) => getExpense(ctx, params)],
  ["PUT", "/expenses/:id", (ctx, params) => updateExpense(ctx, params)],
  ["DELETE", "/expenses/:id", (ctx, params) => deleteExpense(ctx, params)],
  ["GET", "/balances", (ctx) => balances(ctx)],
  ["POST", "/settlements", (ctx) => createSettlement(ctx)],
  ["DELETE", "/settlements/:id", (ctx, params) => deleteSettlement(ctx, params)],
  ["POST", "/tickets/scan", (ctx) => scanTicket(ctx)],
  ["GET", "/push/key", (ctx) => pushKey(ctx)],
  ["POST", "/push/subscribe", (ctx) => subscribePush(ctx)],
  ["DELETE", "/push/subscribe", (ctx) => unsubscribePush(ctx)],
  ["GET", "/reminder", (ctx) => reminder(ctx)],
  ["POST", "/reminder/dismiss", (ctx) => dismissReminder(ctx)],
  ["POST", "/internal/monthly-reminder", (ctx) => runReminderHttp(ctx)],
  ["GET", "/health", () => json({ ok: true })],
];

export const onRequest: PagesFunction<Env> = async (context) => {
  const url = new URL(context.request.url);
  const path = url.pathname.replace(/^\/api/, "").replace(/\/$/, "") || "/";
  const method = context.request.method;
  try {
    if (method === "OPTIONS") return new Response(null, { status: 204 });
    if (method !== "GET" && method !== "HEAD") assertOrigin(context.request);
    const match = routes.find(([routeMethod, pattern]) => routeMethod === method && Boolean(matchPath(path, pattern)));
    if (!match) throw new ApiError(404, "ruta", "No se ha encontrado la ruta.");
    const params = matchPath(path, match[1]) ?? {};
    let body: unknown = {};
    let rawBody = "";
    if ((method === "POST" || method === "PUT") && path !== "/tickets/scan") {
      const contentType = context.request.headers.get("Content-Type") ?? "";
      if (contentType && !contentType.includes("application/json")) throw new ApiError(415, "tipo", "Tipo de contenido no admitido.");
      rawBody = await context.request.text();
      if (rawBody.length > 1_000_000) throw new ApiError(413, "tamano", "La solicitud es demasiado grande.");
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          throw new ApiError(400, "json", "El cuerpo no es JSON válido.");
        }
      }
    }
    const ctx: AppCtx = { request: context.request, env: context.env, url, db: context.env.DB, body, rawBody };
    return await match[2](ctx, params);
  } catch (error) {
    return fail(error);
  }
};

function matchPath(path: string, pattern: string): Record<string, string> | null {
  const actual = path.split("/").filter(Boolean);
  const expected = pattern.split("/").filter(Boolean);
  if (actual.length !== expected.length) return null;
  const params: Record<string, string> = {};
  for (let index = 0; index < actual.length; index += 1) {
    if (expected[index].startsWith(":")) params[expected[index].slice(1)] = decodeURIComponent(actual[index]);
    else if (actual[index] !== expected[index]) return null;
  }
  return params;
}
