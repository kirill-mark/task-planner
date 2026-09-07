import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

async function hmacSha256(key: Uint8Array | string, message: string): Promise<Uint8Array> {
  const keyData = typeof key === "string" ? new TextEncoder().encode(key) : key;
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(message));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
const MAX_AGE_SEC = 86400;

// URLSearchParams also turns "+" into a space, which corrupts any value that
// legitimately contains one (query_id is base64 and often does) and makes the
// HMAC fail. Decode each pair ourselves so values survive byte-for-byte.
function parseInitData(initData: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const pair of initData.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq === -1) continue;
    const key = decodeURIComponent(pair.slice(0, eq));
    const value = decodeURIComponent(pair.slice(eq + 1));
    out.set(key, value);
  }
  return out;
}

async function verifyInitData(
  initData: string
): Promise<{ ok: boolean; telegramId?: number; reason?: string }> {
  const params = parseInitData(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, reason: "no_hash" };

  // Both `hash` and `signature` are excluded from the data-check-string.
  // `signature` is the newer Ed25519 field for third-party validation, and
  // newer clients (Telegram Desktop especially) send it - leaving it in makes
  // every one of those launches fail the HMAC check.
  params.delete("hash");
  params.delete("signature");

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");

  const secretKey = await hmacSha256(TELEGRAM_BOT_TOKEN, "WebAppData");
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));
  if (computed !== hash) {
    // Field names only - enough to spot an unexpected payload shape without
    // writing the user's Telegram profile into the logs.
    console.error(
      `telegram-miniapp-auth: hash mismatch; fields=[${keys.join(",")}] ` +
        `len=${dataCheckString.length} got=${hash.slice(0, 8)} computed=${computed.slice(0, 8)}`
    );
    return { ok: false, reason: "bad_hash" };
  }

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  const age = Date.now() / 1000 - authDate;
  if (!authDate || age > MAX_AGE_SEC) {
    return { ok: false, reason: `stale (${Math.round(age / 3600)}h old)` };
  }

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false, reason: "no_user" };
  try {
    const user = JSON.parse(userRaw);
    return { ok: true, telegramId: user.id };
  } catch {
    return { ok: false, reason: "bad_user_json" };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS_HEADERS });

  try {
    if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !TELEGRAM_BOT_TOKEN) {
      console.error("telegram-miniapp-auth: missing secrets");
      return json({ error: "server_misconfigured" }, 500);
    }

    const { initData } = await req.json();
    if (typeof initData !== "string" || !initData) return json({ error: "missing_init_data" }, 400);

    const check = await verifyInitData(initData);
    if (!check.ok) {
      // Logged so a silent fallback to the login form can be diagnosed later.
      console.error(`telegram-miniapp-auth: rejected initData (${check.reason})`);
      return json({ error: "invalid_signature", reason: check.reason }, 401);
    }

    const { data: link } = await supabase
      .from("telegram_links")
      .select("user_id")
      .eq("telegram_chat_id", check.telegramId)
      .maybeSingle();
    if (!link) {
      console.error(`telegram-miniapp-auth: telegram id ${check.telegramId} is not linked`);
      return json({ error: "not_linked" }, 404);
    }

    const { data: userData, error: userErr } = await supabase.auth.admin.getUserById(link.user_id);
    if (userErr || !userData?.user?.email) {
      console.error("telegram-miniapp-auth: user lookup failed", userErr);
      return json({ error: "user_lookup_failed" }, 500);
    }

    const { data: linkData, error: linkErr } = await supabase.auth.admin.generateLink({
      type: "magiclink",
      email: userData.user.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error("telegram-miniapp-auth: generateLink failed", linkErr);
      return json({ error: "link_generation_failed" }, 500);
    }

    return json({ email: userData.user.email, token: linkData.properties.hashed_token });
  } catch (e) {
    console.error(e);
    return json({ error: "internal_error" }, 500);
  }
});
