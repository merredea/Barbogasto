import { randomToken, sha256Text } from "../../shared/password";
import { ApiError, type AppCtx, json, requireUser } from "./http";

export async function listMembers(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const rows = await ctx.db
    .prepare(
      `SELECT u.id, u.name, u.email, gm.role
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY u.name COLLATE NOCASE`,
    )
    .bind(user.groupId)
    .all();
  return json({ members: rows.results });
}

export async function listInvites(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const rows = await ctx.db
    .prepare(
      `SELECT id, expires_at, used_at, created_at
       FROM invitations WHERE group_id = ? ORDER BY created_at DESC LIMIT 20`,
    )
    .bind(user.groupId)
    .all();
  return json({ invitations: rows.results });
}

export async function createInvite(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const now = new Date().toISOString();
  const active = await ctx.db
    .prepare(`SELECT COUNT(*) AS total FROM invitations WHERE group_id = ? AND used_at IS NULL AND expires_at > ?`)
    .bind(user.groupId, now)
    .first<{ total: number }>();
  if ((active?.total ?? 0) >= 20) throw new ApiError(429, "limite", "Hay demasiadas invitaciones abiertas.");
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  await ctx.db
    .prepare(
      `INSERT INTO invitations (id, group_id, token_hash, created_by, expires_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(crypto.randomUUID(), user.groupId, await sha256Text(token), user.id, expiresAt, now)
    .run();
  return json({ token, expiresAt }, 201);
}

export async function invitationPreview(ctx: AppCtx, params: Record<string, string>): Promise<Response> {
  const row = await ctx.db
    .prepare(
      `SELECT i.expires_at, i.used_at, g.name AS group_name, u.name AS inviter_name
       FROM invitations i
       JOIN groups g ON g.id = i.group_id
       JOIN users u ON u.id = i.created_by
       WHERE i.token_hash = ?`,
    )
    .bind(await sha256Text(params.token))
    .first<{ expires_at: string; used_at: string | null; group_name: string; inviter_name: string }>();
  if (!row || row.used_at || row.expires_at <= new Date().toISOString()) {
    throw new ApiError(404, "invitacion", "Esta invitación ya no es válida.");
  }
  return json({ groupName: row.group_name, inviterName: row.inviter_name, expiresAt: row.expires_at });
}
