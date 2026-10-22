const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
const privateKey = new Uint8Array(await crypto.subtle.exportKey("pkcs8", pair.privateKey));
console.log(`VAPID_PUBLIC_KEY=${base64Url(publicKey)}`);
console.log(`VAPID_PRIVATE_KEY=${base64Url(privateKey)}`);

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}
