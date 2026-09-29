// Единственный путь записи в целевую модель.
//
// Владелец определяется проверенной сессией Supabase Auth, а не значением из
// тела запроса: подделать чужой user_id нельзя, даже зная его. Сама запись идёт
// транзакционной функцией mark_apply_operations, которая проверяет версии,
// допустимость полей и повторы.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Пакет ограничен: один запрос не должен уметь занять обработчик надолго.
const MAX_OPS = 200;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  try {
    const auth = req.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);

    // Клиент с токеном вызывающего: getUser проверяет подпись и срок действия.
    const asCaller = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: auth } },
    });
    const { data: userData, error: userErr } = await asCaller.auth.getUser();
    if (userErr || !userData?.user) return json({ error: "unauthorized" }, 401);
    const userId = userData.user.id;

    const body = await req.json().catch(() => null);
    const ops = body?.operations;
    if (!Array.isArray(ops)) return json({ error: "operations_required" }, 400);
    if (ops.length === 0) return json({ results: [], server_seq: null });
    if (ops.length > MAX_OPS) return json({ error: "too_many_operations", max: MAX_OPS }, 400);

    const source = body?.source === "miniapp" ? "miniapp" : "web";

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data, error } = await admin.rpc("mark_apply_operations", {
      p_user: userId,       // из проверенной сессии, не из тела запроса
      p_source: source,
      p_ops: ops,
    });
    if (error) {
      // аккаунт ещё живёт в старой модели: клиент должен перейти на неё, а не
      // повторять запись
      if (error.message.includes("account_not_switched")) {
        return json({ error: "account_not_switched", message: "account_not_switched" }, 409);
      }
      console.error("mark-ops: apply failed", error.message);
      return json({ error: "apply_failed", message: error.message }, 500);
    }

    return json(data);
  } catch (e) {
    console.error("mark-ops:", e);
    return json({ error: "internal_error" }, 500);
  }
});
