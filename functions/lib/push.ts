import { createVapidJwt, decodeKey, encryptWebPush } from "../../shared/webpush";
import type { Env } from "../env";

export async function deliverPush(
  env: Env,
  subscription: { endpoint: string; p256dh: string; authKey: string },
  payload: object,
): Promise<"sent" | "gone" | "failed"> {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return "failed";
  const encrypted = await encryptWebPush(new TextEncoder().encode(JSON.stringify(payload)), {
    p256dh: decodeKey(subscription.p256dh),
    auth: decodeKey(subscription.authKey),
  });
  const jwt = await createVapidJwt(
    decodeKey(env.VAPID_PRIVATE_KEY),
    new URL(subscription.endpoint).origin,
    env.VAPID_SUBJECT || "mailto:barbogasto@localhost",
    Math.floor(Date.now() / 1000) + 12 * 60 * 60,
  );
  const response = await fetch(subscription.endpoint, {
    method: "POST",
    headers: {
      Authorization: `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "43200",
      Topic: "fin-de-mes",
    },
    body: new Blob([encrypted]),
  });
  if (response.status === 404 || response.status === 410) return "gone";
  if (!response.ok) return "failed";
  return "sent";
}
