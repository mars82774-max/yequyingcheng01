const encoder = new TextEncoder();

export async function createSession(password) {
  const expires = Math.floor(Date.now() / 1000) + 60 * 60 * 12;
  const payload = `${expires}`;
  const signature = await sign(payload, password);
  return `${payload}.${signature}`;
}

export async function isAuthorized(request, env) {
  const password = env.ADMIN_PASSWORD;
  if (!password) return false;
  const cookie = request.headers.get("Cookie") || "";
  const token = cookie.match(/(?:^|;\s*)yc_admin=([^;]+)/)?.[1];
  if (!token) return false;
  const [expires, signature] = token.split(".");
  if (!expires || !signature) return false;
  if (Number(expires) < Math.floor(Date.now() / 1000)) return false;
  const expected = await sign(expires, password);
  return timingSafeEqual(signature, expected);
}

export function sessionCookie(token) {
  return `yc_admin=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`;
}

export function clearSessionCookie() {
  return "yc_admin=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0";
}

async function sign(payload, secret) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const raw = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return [...new Uint8Array(raw)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}
