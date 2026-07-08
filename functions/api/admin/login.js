import { json } from "../../_lib/ads.js";
import { createSession, sessionCookie } from "../../_lib/auth.js";

export async function onRequestPost({ request, env }) {
  const password = env.ADMIN_PASSWORD;
  if (!password) return json({ error: "ADMIN_PASSWORD is not configured" }, { status: 500 });

  const body = await request.json().catch(() => ({}));
  if (body.password !== password) {
    return json({ error: "Invalid password" }, { status: 401 });
  }

  const token = await createSession(password);
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": sessionCookie(token)
      }
    }
  );
}
