import { sha256Hex } from "../../shared/password";
import { ApiError, type AppCtx, json, requireUser, withIdempotency } from "./http";
import { readTicket } from "./gemini";

const MAX_BYTES = 4 * 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function scanTicket(ctx: AppCtx): Promise<Response> {
  const user = await requireUser(ctx);
  const form = await ctx.request.formData();
  const file = form.get("image");
  if (!(file instanceof File)) throw new ApiError(400, "imagen", "Elige una fotografía del ticket.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniff(bytes);
  if (!mime) throw new ApiError(400, "imagen", "La imagen debe ser JPG, PNG, WebP o HEIC.");
  if (bytes.byteLength > MAX_BYTES) throw new ApiError(413, "imagen", "La imagen supera los 4 MB.");

  const since = new Date(Date.now() - DAY_MS).toISOString();
  const mine = await ctx.db
    .prepare(`SELECT COUNT(*) AS total FROM ai_requests WHERE user_id = ? AND created_at > ?`)
    .bind(user.id, since)
    .first<{ total: number }>();
  const group = await ctx.db
    .prepare(
      `SELECT COUNT(*) AS total FROM ai_requests ar
       JOIN group_members gm ON gm.user_id = ar.user_id
       WHERE gm.group_id = ? AND ar.created_at > ?`,
    )
    .bind(user.groupId, since)
    .first<{ total: number }>();
  if ((mine?.total ?? 0) >= 30 || (group?.total ?? 0) >= 150) {
    throw new ApiError(429, "limite", "Se ha alcanzado el límite diario de lecturas. Introduce el gasto manualmente.");
  }

  return withIdempotency(ctx.db, user.id, ctx.request, await sha256Hex(bytes), async () => {
    const now = new Date().toISOString();
    await ctx.db.prepare(`DELETE FROM ai_requests WHERE created_at < ?`).bind(new Date(Date.now() - 2 * DAY_MS).toISOString()).run();
    await ctx.db.prepare(`INSERT INTO ai_requests (id, user_id, created_at) VALUES (?, ?, ?)`).bind(crypto.randomUUID(), user.id, now).run();
    const draft = await readTicket(ctx.env, bytes, mime);
    return json(draft);
  });
}

function sniff(bytes: Uint8Array): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "image/png";
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return "image/webp";
  }
  if (bytes.length >= 12 && bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70) {
    const brand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
    if (["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(brand)) return "image/heic";
  }
  return null;
}
