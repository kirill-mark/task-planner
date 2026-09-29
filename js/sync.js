import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://ofgicgqsmjvpsrvzefib.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZ2ljZ3FzbWp2cHNydnplZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODUyMTAsImV4cCI6MjEwMzc2MTIxMH0._N5Dpuz1ySkBwgypp8gSOPF7U3DnwV0XGIaPAGa3y34";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// --- auth ---
export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthChange(cb) {
  supabase.auth.onAuthStateChange((_event, session) => cb(session));
}

export async function signUp(email, password) {
  return supabase.auth.signUp({ email, password });
}

export async function signIn(email, password) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function telegramMiniAppSignIn(initData) {
  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/telegram-miniapp-auth`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ initData }),
    });
    const body = await res.json();
    if (!res.ok) return { ok: false, reason: body.error || "unknown" };
    const { error } = await supabase.auth.verifyOtp({ token_hash: body.token, type: "magiclink" });
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  } catch (e) {
    console.warn("telegram mini app sign-in failed", e);
    return { ok: false, reason: "network" };
  }
}

export async function updateDisplayName(name) {
  return supabase.auth.updateUser({ data: { display_name: name } });
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}

// --- account timezone (drives when reminders fire) ---

export function deviceTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

// Every sign-in used to write this device's timezone into the account, so two
// devices in different zones kept overwriting each other - and the reminder
// times with them (D09). Now the device's zone is written only into an account
// that has none; otherwise the caller learns about the difference and asks.
export async function reconcileTimezone(userId) {
  const device = deviceTimezone();
  const { data, error } = await supabase
    .from("user_settings")
    .select("timezone, timezone_source")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { status: "error", message: error.message };
  if (!data) {
    if (!device) return { status: "unknown" };
    const { error: insErr } = await supabase
      .from("user_settings")
      .insert({ user_id: userId, timezone: device, timezone_source: "device", updated_at: new Date().toISOString() });
    return insErr ? { status: "error", message: insErr.message } : { status: "set", account: device, device };
  }
  if (!device || data.timezone === device) return { status: "same", account: data.timezone, device };
  return { status: "differs", account: data.timezone, device, source: data.timezone_source };
}

export async function setAccountTimezone(userId, timezone) {
  const { error } = await supabase
    .from("user_settings")
    .update({ timezone, timezone_source: "confirmed", updated_at: new Date().toISOString() })
    .eq("user_id", userId);
  return error ? { ok: false, message: error.message } : { ok: true };
}

// --- planner state, scoped per user ---

// Returns an explicit outcome instead of null-for-everything. A failed read and
// an account with no row look identical otherwise, and the caller used to treat
// both as "server is empty" and push the local copy over the top of real data.
export async function fetchRemoteState(userId) {
  const { data, error } = await supabase
    .from("planner_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("sync: fetch failed", error.message);
    return { status: "error", message: error.message, state: null };
  }
  if (!data) return { status: "empty", state: null };
  return { status: "ok", state: data.data };
}

export async function pushRemoteState(userId, state) {
  const { error } = await supabase
    .from("planner_state")
    .upsert(
      { user_id: userId, data: state, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) {
    console.warn("sync: push failed", error.message);
    return { ok: false, message: error.message };
  }
  return { ok: true };
}

export function subscribeRemote(userId, onChange, onStatus) {
  return supabase
    .channel(`planner_state_${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "planner_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.new && payload.new.data) onChange(payload.new.data);
      }
    )
    // Reconnects are silent otherwise, and anything changed while the socket was
    // down never arrives - the caller re-reads on this signal.
    .subscribe((status) => { if (onStatus) onStatus(status); });
}

// --- telegram linking ---
const TELEGRAM_BOT_USERNAME = "markplanner_bot";

// Cryptographically random (R4): Math.random is predictable. 32 symbols divide
// 256 evenly, so taking a byte modulo 32 introduces no bias. The code also
// lives only ten minutes - the database sets that, not this client.
function randomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

// An explicit outcome: a failed read must not look like "not linked" and offer
// to link again (D10).
export async function fetchTelegramLink(userId) {
  const { data, error } = await supabase
    .from("telegram_links")
    .select("telegram_username, linked_at")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("telegram: fetch link failed", error.message);
    return { status: "error", message: error.message };
  }
  return data ? { status: "linked", link: data } : { status: "none" };
}

export async function createLinkCode(userId) {
  const code = randomCode();
  const { error } = await supabase.from("link_codes").insert({ code, user_id: userId });
  if (error) {
    console.warn("telegram: create code failed", error.message);
    return null;
  }
  return { code, url: `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${code}` };
}

export async function unlinkTelegram(userId) {
  const { error } = await supabase.from("telegram_links").delete().eq("user_id", userId);
  if (error) console.warn("telegram: unlink failed", error.message);
  return !error;
}

export function subscribeTelegramLink(userId, onChange) {
  return supabase
    .channel(`telegram_link_${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "telegram_links", filter: `user_id=eq.${userId}` },
      () => onChange()
    )
    .subscribe();
}
