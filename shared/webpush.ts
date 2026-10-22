import { bytesToBase64Url, source } from "./password";

export interface PushKeys {
  p256dh: Uint8Array;
  auth: Uint8Array;
}

/** Cifra una notificación según RFC 8291 (aes128gcm). */
export async function encryptWebPush(payload: Uint8Array, subscription: PushKeys): Promise<Uint8Array> {
  const local = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const localPublic = new Uint8Array((await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer);
  const remote = await crypto.subtle.importKey("raw", source(subscription.p256dh), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await deriveShared(local.privateKey, remote));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const ikm = await hkdf(
    subscription.auth,
    shared,
    concat(text("WebPush: info\0"), subscription.p256dh, localPublic),
    32,
  );
  const contentKey = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", source(contentKey), "AES-GCM", false, ["encrypt"]);
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: source(nonce) }, aesKey, source(concat(payload, new Uint8Array([2])))),
  );
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096);
  return concat(salt, recordSize, new Uint8Array([localPublic.length]), localPublic, cipher);
}

export async function decryptWebPush(body: Uint8Array, receiverPrivatePkcs8: Uint8Array, auth: Uint8Array): Promise<Uint8Array> {
  const salt = body.slice(0, 16);
  const idLength = body[20];
  const serverPublic = body.slice(21, 21 + idLength);
  const cipher = body.slice(21 + idLength);
  const privateKey = await crypto.subtle.importKey("pkcs8", source(receiverPrivatePkcs8), { name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const remote = await crypto.subtle.importKey("raw", source(serverPublic), { name: "ECDH", namedCurve: "P-256" }, false, []);
  const shared = new Uint8Array(await deriveShared(privateKey, remote));
  const receiverPublic = new Uint8Array((await crypto.subtle.exportKey("raw", await publicFromPrivate(privateKey))) as ArrayBuffer);
  const ikm = await hkdf(auth, shared, concat(text("WebPush: info\0"), receiverPublic, serverPublic), 32);
  const contentKey = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const aesKey = await crypto.subtle.importKey("raw", source(contentKey), "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: source(nonce) }, aesKey, source(cipher)));
  if (padded[padded.length - 1] !== 2) throw new Error("relleno inválido");
  return padded.slice(0, -1);
}

export async function createVapidJwt(
  privateKeyPkcs8: Uint8Array,
  audience: string,
  subject: string,
  expiresAt: number,
): Promise<string> {
  const key = await crypto.subtle.importKey("pkcs8", source(privateKeyPkcs8), { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const header = bytesToBase64Url(text(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = bytesToBase64Url(text(JSON.stringify({ aud: audience, exp: expiresAt, sub: subject })));
  const unsigned = `${header}.${payload}`;
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, source(text(unsigned))),
  );
  return `${unsigned}.${bytesToBase64Url(signature)}`;
}

export async function generateSubscriptionKeys(): Promise<{
  publicRaw: Uint8Array;
  privatePkcs8: Uint8Array;
  auth: Uint8Array;
}> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  return {
    publicRaw: new Uint8Array((await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer),
    privatePkcs8: new Uint8Array((await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer),
    auth: crypto.getRandomValues(new Uint8Array(16)),
  };
}

async function publicFromPrivate(privateKey: CryptoKey): Promise<CryptoKey> {
  const jwk = (await crypto.subtle.exportKey("jwk", privateKey)) as JsonWebKey;
  delete jwk.d;
  jwk.key_ops = [];
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDH", namedCurve: "P-256" }, true, []);
}

function deriveShared(privateKey: CryptoKey, publicKey: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.deriveBits({ name: "ECDH", public: publicKey } as never, privateKey, 256);
}

async function hkdf(salt: Uint8Array, ikm: Uint8Array, info: Uint8Array, length: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", source(ikm), "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt: source(salt), info: source(info) }, key, length * 8);
  return new Uint8Array(bits);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const size = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

export function decodeKey(value: string): Uint8Array {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/") + "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
