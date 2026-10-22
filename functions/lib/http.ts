import { InputError } from "../../shared/expense";
import { sha256Text } from "../../shared/password";
import type { Env } from "../env";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AppCtx {
  request: Request;
  env: Env;
  url: URL;
  db: D1Database;
  body: unknown;
  rawBody: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: "owner" | "member";
  pushEnabled: boolean;
  groupId: string;
  groupName: string;
  currency: string;
  timezone: string;
}

export function json(data: unknown, status = 200, extra?: HeadersInit): Response {
  const headers = new Headers(extra);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  return new Response(JSON.stringify(data), { status, headers });
}

export function fail(error: unknown): Response {
  if (error instanceof ApiError) return json({ error: error.code, message: error.message }, error.status);
  if (error instanceof InputError) return json({ error: "datos", message: error.message }, 400);
  console.error(error instanceof Error ? error.message : "error");
  return json({ error: "interno", message: "No se ha podido completar la operación." }, 500);
}

export function assertOrigin(request: Request): void {
  const origin = request.headers.get("Origin");
  if (!origin) return;
  const target = new URL(request.url);
  if (origin === target.origin) return;
  const incoming = new URL(origin);
  const local = (host: string) => host === "localhost" || host === "127.0.0.1";
  if (local(incoming.hostname) && local(target.hostname)) return;
  throw new ApiError(403, "origen", "Origen no permitido.");
}

export async function requireUser(ctx: AppCtx): Promise<SessionUser> {
  const token = readCookie(ctx.request, "bg_session");
  if (!token) throw new ApiError(401, "sesion", "Inicia sesión para continuar.");
  const tokenHash = await sha256Text(token);
  const row = await ctx.db
    .prepare(
      `SELECT u.id, u.email, u.name, u.push_enabled, gm.role, g.id AS group_id, g.name AS group_name, g.currency, g.timezone
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN group_members gm ON gm.user_id = u.id
       JOIN groups g ON g.id = gm.group_id
       WHERE s.token_hash = ? AND s.expires_at > ?`,
    )
    .bind(tokenHash, new Date().toISOString())
    .first<{
      id: string;
      email: string;
      name: string;
      push_enabled: number;
      role: "owner" | "member";
      group_id: string;
      group_name: string;
      currency: string;
      timezone: string;
    }>();
  if (!row) throw new ApiError(401, "sesion", "La sesión ha caducado.");
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    pushEnabled: row.push_enabled === 1,
    groupId: row.group_id,
    groupName: row.group_name,
    currency: row.currency,
    timezone: row.timezone,
  };
}

export function publicUser(user: SessionUser) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    pushEnabled: user.pushEnabled,
    group: {
      id: user.groupId,
      name: user.groupName,
      currency: user.currency,
      timezone: user.timezone,
    },
  };
}

export function sessionCookie(token: string, request: Request, maxAge: number): string {
  const secure = new URL(request.url).protocol === "https:";
  return [
    `bg_session=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export async function withIdempotency(
  db: D1Database,
  userId: string,
  request: Request,
  requestHash: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const key = request.headers.get("Idempotency-Key")?.trim() ?? "";
  if (!/^[\w-]{8,80}$/.test(key)) throw new ApiError(400, "idempotencia", "Falta una clave de idempotencia válida.");
  const existing = await readIdempotent(db, userId, key);
  if (existing) {
    if (existing.request_hash !== requestHash) {
      throw new ApiError(409, "idempotencia", "Esta clave ya se usó con otra solicitud.");
    }
    return new Response(existing.response_body, {
      status: existing.response_status,
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }
  const response = await run();
  if (response.status >= 500) return response;
  const responseBody = await response.clone().text();
  const now = new Date().toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  try {
    await db.batch([
      db.prepare(`DELETE FROM idempotency_keys WHERE user_id = ? AND created_at < ?`).bind(userId, weekAgo),
      db
        .prepare(
          `INSERT INTO idempotency_keys (user_id, key, request_hash, response_status, response_body, created_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(userId, key, requestHash, response.status, responseBody, now),
    ]);
  } catch {
    const raced = await readIdempotent(db, userId, key);
    if (raced && raced.request_hash === requestHash) {
      return new Response(raced.response_body, {
        status: raced.response_status,
        headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
      });
    }
    throw new ApiError(409, "idempotencia", "No se ha podido confirmar la solicitud. Inténtalo de nuevo.");
  }
  return response;
}

export function cleanName(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "datos", "Escribe tu nombre.");
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 1 || name.length > 40) throw new ApiError(400, "datos", "El nombre debe tener entre 1 y 40 caracteres.");
  return name;
}

export function cleanEmail(value: unknown): string {
  if (typeof value !== "string") throw new ApiError(400, "datos", "Escribe un email.");
  const email = value.trim().toLowerCase();
  if (email.length > 120 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "datos", "El email no es válido.");
  }
  return email;
}

export function cleanPassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) {
    throw new ApiError(400, "datos", "La contraseña debe tener entre 10 y 128 caracteres.");
  }
  return value;
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function readIdempotent(db: D1Database, userId: string, key: string) {
  return db
    .prepare(`SELECT request_hash, response_status, response_body FROM idempotency_keys WHERE user_id = ? AND key = ?`)
    .bind(userId, key)
    .first<{ request_hash: string; response_status: number; response_body: string }>();
}
