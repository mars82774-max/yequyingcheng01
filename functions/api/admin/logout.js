import { json } from "../../_lib/ads.js";
import { clearSessionCookie } from "../../_lib/auth.js";

export async function onRequestPost() {
  return json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": clearSessionCookie()
      }
    }
  );
}
