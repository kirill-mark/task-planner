import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";

const SUPABASE_URL = "https://ofgicgqsmjvpsrvzefib.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZ2ljZ3FzbWp2cHNydnplZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODUyMTAsImV4cCI6MjEwMzc2MTIxMH0._N5Dpuz1ySkBwgypp8gSOPF7U3DnwV0XGIaPAGa3y34";
const ROW_ID = "main";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export async function fetchRemoteState() {
  const { data, error } = await supabase
    .from("planner_state")
    .select("data")
    .eq("id", ROW_ID)
    .maybeSingle();
  if (error) {
    console.warn("sync: fetch failed", error.message);
    return null;
  }
  return data ? data.data : null;
}

export async function pushRemoteState(state) {
  const { error } = await supabase
    .from("planner_state")
    .upsert({ id: ROW_ID, data: state, updated_at: new Date().toISOString() });
  if (error) console.warn("sync: push failed", error.message);
}

export function subscribeRemote(onChange) {
  return supabase
    .channel("planner_state_changes")
    .on(
      "postgres_changes",
      { event: "*", schema: "public", table: "planner_state", filter: `id=eq.${ROW_ID}` },
      (payload) => {
        if (payload.new && payload.new.data) onChange(payload.new.data);
      }
    )
    .subscribe();
}
