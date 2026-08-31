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

export async function updateDisplayName(name) {
  return supabase.auth.updateUser({ data: { display_name: name } });
}

export async function updatePassword(password) {
  return supabase.auth.updateUser({ password });
}

// --- planner state, scoped per user ---
export async function fetchRemoteState(userId) {
  const { data, error } = await supabase
    .from("planner_state")
    .select("data")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.warn("sync: fetch failed", error.message);
    return null;
  }
  return data ? data.data : null;
}

export async function pushRemoteState(userId, state) {
  const { error } = await supabase
    .from("planner_state")
    .upsert(
      { user_id: userId, data: state, updated_at: new Date().toISOString() },
      { onConflict: "user_id" }
    );
  if (error) console.warn("sync: push failed", error.message);
}

export function subscribeRemote(userId, onChange) {
  return supabase
    .channel(`planner_state_${userId}`)
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "planner_state", filter: `user_id=eq.${userId}` },
      (payload) => {
        if (payload.new && payload.new.data) onChange(payload.new.data);
      }
    )
    .subscribe();
}
