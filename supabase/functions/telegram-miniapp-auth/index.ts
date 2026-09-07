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

  // Telegram's docs say to exclude both `hash` and `signature` from the
  // data-check-string, but real clients disagree: Telegram Desktop signs with
  // `signature` included. Try it included first, then excluded, so launches
  // from either behaviour verify. Both are HMACs under the bot token, so
  // accepting either does not weaken the check.
  params.delete("hash");
  const withSig = Array.from(params.keys()).sort();
  const withoutSig = withSig.filter((k) => k !== "signature");
  const build = (keys: string[]) => keys.map((k) => `${k}=${params.get(k)}`).join("\n");

  // Telegram writes the derivation as HMAC_SHA256(<bot_token>, "WebAppData"),
  // where their first argument is the DATA and the second is the KEY - the same
  // order as the line that follows it, HMAC_SHA256(data_check_string,
  // secret_key). So the key is the literal "WebAppData", not the token.
  const secretKey = await hmacSha256("WebAppData", TELEGRAM_BOT_TOKEN);

  let matched = false;
  for (const keys of [withSig, withoutSig]) {
    if (toHex(await hmacSha256(secretKey, build(keys))) === hash) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    // Field names only - never the user's profile data.
    console.error(
      `telegram-miniapp-auth: hash mismatch; fields=[${withSig.join(",")}] ` +
        `len=${build(withSig).length} got=${hash.slice(0, 8)}`
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
