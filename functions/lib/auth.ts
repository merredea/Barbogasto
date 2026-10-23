import { hashPassword, randomToken, sha256Text, verifyPassword } from "../../shared/password";

let cachedDummyHash: Promise<string> | null = null;
function dummyHash(): Promise<string> {
  cachedDummyHash ??= hashPassword("placeholder-no-usado");
  return cachedDummyHash;
}
import { isoDateInTimeZone } from "../../shared/dates";
import { ApiError, type AppCtx, cleanEmail, cleanName, cleanPassword, json, publicUser, requireUser, sessionCookie, type SessionUser } from "./http";

const SESSION_SECONDS = 60 * 60 * 24 * 30;

export async function register(ctx: AppCtx): Promise<Response> {
  const body = objectBody(ctx.body);
  const name = cleanName(body.name);
  const email = cleanEmail(body.email);
  const password = cleanPassword(body.password);
  const inviteToken = typeof body.inviteToken === "string" ? body.inviteToken.trim() : "";
  const existing = await ctx.db.prepare(`SELECT id FROM users WHERE email = ?`).bind(email).first();
  if (existing) throw new ApiError(409, "email", "Ya hay una cuenta con ese email.");
  const group = await ctx.db.prepare(`SELECT id, name, currency, timezone FROM groups LIMIT 1`).first<{
    id: string;
    name: string;
    currency: string;
    timezone: string;
  }>();
  if (!group && inviteToken) throw new ApiError(400, "invitacion", "Esta invitación no es válida.");

  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const token = randomToken();
  const tokenHash = await sha256Text(token);

  if (!group) {
    const groupId = crypto.randomUUID();
    const sessionId = crypto.randomUUID();
    try {
      await ctx.db.batch([
        ctx.db
          .prepare(`INSERT INTO users (id, email, name, password_hash, push_enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
          .bind(userId, email, name, passwordHash, now),
        ctx.db
          .prepare(
            `INSERT INTO groups (id, singleton, name, currency, timezone, created_at) VALUES (?, 1, 'Barbogastos', 'EUR', 'Europe/Madrid', ?)`,
          )
          .bind(groupId, now),
        ctx.db
          .prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'owner', ?)`)
          .bind(groupId, userId, now),
        ctx.db
          .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(sessionId, userId, tokenHash, expires(now), now),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("email")) throw new ApiError(409, "email", "Ya hay una cuenta con ese email.");
      throw new ApiError(403, "invitacion", "El grupo ya existe. Necesitas un enlace de invitación.");
    }
    return json(publicUser(sessionFrom(userId, email, name, "owner", groupId, "Barbogastos", "EUR", "Europe/Madrid")), 201, {
      "Set-Cookie": sessionCookie(token, ctx.request, SESSION_SECONDS),
    });
  }

  if (!inviteToken) {
    // Registro abierto: la cuenta entra directamente en la comunidad única.
    try {
      await ctx.db
        .prepare(`INSERT INTO users (id, email, name, password_hash, push_enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
        .bind(userId, email, name, passwordHash, now)
        .run();
      const sessionId = crypto.randomUUID();
      await ctx.db.batch([
        ctx.db
          .prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`)
          .bind(group.id, userId, now),
        ctx.db
          .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
          .bind(sessionId, userId, tokenHash, expires(now), now),
      ]);
    } catch (error) {
      await ctx.db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
      const message = error instanceof Error ? error.message : "";
      if (message.toLowerCase().includes("email")) throw new ApiError(409, "email", "Ya hay una cuenta con ese email.");
      throw error;
    }
    return json(publicUser(sessionFrom(userId, email, name, "member", group.id, group.name, group.currency, group.timezone)), 201, {
      "Set-Cookie": sessionCookie(token, ctx.request, SESSION_SECONDS),
    });
  }

  const tokenHashInvite = await sha256Text(inviteToken);
  const claimId = crypto.randomUUID();
  const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const claim = await ctx.db
    .prepare(
      `UPDATE invitations
       SET claim_id = ?, claimed_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?
         AND (claim_id IS NULL OR claimed_at < ?)`,
    )
    .bind(claimId, now, tokenHashInvite, now, stale)
    .run();
  if ((claim.meta.changes ?? 0) !== 1) throw new ApiError(400, "invitacion", "Esta invitación ya no es válida.");

  try {
    await ctx.db
      .prepare(`INSERT INTO users (id, email, name, password_hash, push_enabled, created_at) VALUES (?, ?, ?, ?, 0, ?)`)
      .bind(userId, email, name, passwordHash, now)
      .run();
    const sessionId = crypto.randomUUID();
    const joined = await ctx.db.batch([
      ctx.db
        .prepare(`INSERT INTO group_members (group_id, user_id, role, created_at) VALUES (?, ?, 'member', ?)`)
        .bind(group.id, userId, now),
      ctx.db
        .prepare(
          `UPDATE invitations SET used_by = ?, used_at = ?, claim_id = NULL WHERE token_hash = ? AND claim_id = ? AND used_at IS NULL`,
        )
        .bind(userId, now, tokenHashInvite, claimId),
      ctx.db
        .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
        .bind(sessionId, userId, tokenHash, expires(now), now),
    ]);
    if ((joined[1]?.meta.changes ?? 0) !== 1) throw new Error("invitacion");
  } catch (error) {
    await ctx.db
      .prepare(`UPDATE invitations SET used_by = NULL, used_at = NULL, claim_id = NULL, claimed_at = NULL WHERE claim_id = ? OR used_by = ?`)
      .bind(claimId, userId)
      .run();
    await ctx.db.prepare(`DELETE FROM users WHERE id = ?`).bind(userId).run();
    const message = error instanceof Error ? error.message : "";
    if (message.toLowerCase().includes("email")) throw new ApiError(409, "email", "Ya hay una cuenta con ese email.");
    throw new ApiError(400, "invitacion", "No se ha podido usar la invitación.");
  }

  return json(publicUser(sessionFrom(userId, email, name, "member", group.id, group.name, group.currency, group.timezone)), 201, {
    "Set-Cookie": sessionCookie(token, ctx.request, SESSION_SECONDS),
  });
}

export async function login(ctx: AppCtx): Promise<Response> {
  const body = objectBody(ctx.body);
  const email = cleanEmail(body.email);
  const password = cleanPassword(body.password);
  const now = new Date();
  const since = new Date(now.getTime() - 15 * 60 * 1000).toISOString();
  const old = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  await ctx.db.prepare(`DELETE FROM auth_attempts WHERE email = ? AND created_at < ?`).bind(email, old).run();
  const attempts = await ctx.db
    .prepare(`SELECT COUNT(*) AS total FROM auth_attempts WHERE email = ? AND created_at > ?`)
    .bind(email, since)
    .first<{ total: number }>();
  if ((attempts?.total ?? 0) >= 8) throw new ApiError(429, "limite", "Demasiados intentos. Espera unos minutos.");

  const user = await ctx.db
    .prepare(`SELECT id, email, name, password_hash FROM users WHERE email = ?`)
    .bind(email)
    .first<{ id: string; email: string; name: string; password_hash: string }>();
  const valid = await verifyPassword(password, user?.password_hash ?? (await dummyHash()));
  if (!user || !valid) {
    await ctx.db
      .prepare(`INSERT INTO auth_attempts (id, email, created_at) VALUES (?, ?, ?)`)
      .bind(crypto.randomUUID(), email, now.toISOString())
      .run();
    throw new ApiError(401, "credenciales", "Email o contraseña incorrectos.");
  }
  const membership = await ctx.db
    .prepare(
      `SELECT gm.role, g.id AS group_id, g.name AS group_name, g.currency, g.timezone, u.push_enabled
       FROM group_members gm
       JOIN groups g ON g.id = gm.group_id
       JOIN users u ON u.id = gm.user_id
       WHERE gm.user_id = ?`,
    )
    .bind(user.id)
    .first<{ role: "owner" | "member"; group_id: string; group_name: string; currency: string; timezone: string; push_enabled: number }>();
  if (!membership) throw new ApiError(403, "grupo", "Tu cuenta no pertenece al grupo.");

  await ctx.db.prepare(`DELETE FROM auth_attempts WHERE email = ?`).bind(email).run();
  const token = randomToken();
  const createdAt = now.toISOString();
  await ctx.db
    .prepare(`INSERT INTO sessions (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`)
    .bind(crypto.randomUUID(), user.id, await sha256Text(token), expires(createdAt), createdAt)
    .run();
  const session = sessionFrom(user.id, user.email, user.name, membership.role, membership.group_id, membership.group_name, membership.currency, membership.timezone);
  session.pushEnabled = membership.push_enabled === 1;
  return json(publicUser(session), 200, { "Set-Cookie": sessionCookie(token, ctx.request, SESSION_SECONDS) });
}

export async function logout(ctx: AppCtx): Promise<Response> {
  const token = readSessionToken(ctx.request);
  if (token) {
    await ctx.db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256Text(token)).run();
  }
  return json({ ok: true }, 200, { "Set-Cookie": sessionCookie("", ctx.request, 0) });
}

export async function me(ctx: AppCtx): Promise<Response> {
  return json(publicUser(await requireUser(ctx)));
}

export function todayFor(user: SessionUser, now = new Date()): string {
  return isoDateInTimeZone(now, user.timezone);
}

function objectBody(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "datos", "La solicitud no es válida.");
  return body as Record<string, unknown>;
}

function expires(fromIso: string): string {
  return new Date(new Date(fromIso).getTime() + SESSION_SECONDS * 1000).toISOString();
}

function sessionFrom(
  id: string,
  email: string,
  name: string,
  role: "owner" | "member",
  groupId: string,
  groupName: string,
  currency: string,
  timezone: string,
): SessionUser {
  return { id, email, name, role, pushEnabled: false, groupId, groupName, currency, timezone };
}

function readSessionToken(request: Request): string | null {
  const header = request.headers.get("Cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === "bg_session") return decodeURIComponent(rest.join("="));
  }
  return null;
}
