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
async function verifyInitData(initData: string): Promise<{ ok: boolean; telegramId?: number }> {
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false };
  params.delete("hash");

  const keys = Array.from(params.keys()).sort();
  const dataCheckString = keys.map((k) => `${k}=${params.get(k)}`).join("\n");

  const secretKey = await hmacSha256(TELEGRAM_BOT_TOKEN, "WebAppData");
  const computed = toHex(await hmacSha256(secretKey, dataCheckString));
  if (computed !== hash) return { ok: false };

  const authDate = parseInt(params.get("auth_date") || "0", 10);
  if (!authDate || Date.now() / 1000 - authDate > 86400) return { ok: false };

  const userRaw = params.get("user");
  if (!userRaw) return { ok: false };
  try {
    const user = JSON.parse(userRaw);
    return { ok: true, telegramId: user.id };
  } catch {
    return { ok: false };
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
    if (!check.ok) return json({ error: "invalid_signature" }, 401);

    const { data: link } = await supabase
      .from("telegram_links")
      .select("user_id")
      .eq("telegram_chat_id", check.telegramId)
      .maybeSingle();
    if (!link) return json({ error: "not_linked" }, 404);

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
