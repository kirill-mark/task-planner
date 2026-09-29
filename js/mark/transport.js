// Связь с сервером для движка синхронизации: отправка операций в mark-ops и
// чтение состояния через mark_get_state.
//
// Каждый ответ сведён к одному из исходов, потому что движок обязан их
// различать (раздел 11 ТЗ): нет сети, нужна повторная авторизация, временный
// сбой сервера, окончательный отказ. Ошибка чтения никогда не выглядит как
// пустой аккаунт.

export const SUPABASE_URL = "https://ofgicgqsmjvpsrvzefib.supabase.co";
export const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im9mZ2ljZ3FzbWp2cHNydnplZmliIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODUyMTAsImV4cCI6MjEwMzc2MTIxMH0._N5Dpuz1ySkBwgypp8gSOPF7U3DnwV0XGIaPAGa3y34";

const REQUEST_TIMEOUT_MS = 20000;

// getAccessToken — функция, а не строка: токен обновляется, и каждый запрос
// должен брать актуальный. fetchImpl подменяется в тестах.
export function createTransport({ getAccessToken, fetchImpl = (...a) => fetch(...a), url = SUPABASE_URL, anonKey = SUPABASE_ANON_KEY }) {
  async function request(path, body) {
    const token = await getAccessToken();
    if (!token) return { kind: "auth" };

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), REQUEST_TIMEOUT_MS);
    let res;
    try {
      res = await fetchImpl(`${url}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: anonKey, Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
        cache: "no-store",
        signal: ctrl.signal,
      });
    } catch (e) {
      // сеть недоступна или запрос не дождался ответа: результат неизвестен,
      // поэтому операция остаётся в очереди и уйдёт повторно с тем же id
      return { kind: "offline", message: String(e && e.message || e) };
    } finally {
      clearTimeout(timer);
    }

    let data = null;
    try { data = await res.json(); } catch { /* тело не JSON */ }
    if (res.ok) return { kind: "ok", data };
    if (res.status === 401 || res.status === 403) return { kind: "auth", message: data?.message || data?.error };
    if (res.status === 426) return { kind: "outdated", message: data?.message };
    if (res.status >= 500 || res.status === 429 || res.status === 408) {
      return { kind: "retry", message: data?.message || data?.error || `HTTP ${res.status}` };
    }
    return { kind: "fatal", message: data?.message || data?.error || `HTTP ${res.status}` };
  }

  return {
    async sendOps(operations, source) {
      const r = await request("/functions/v1/mark-ops", { operations, source });
      if (r.kind !== "ok") return r;
      if (!Array.isArray(r.data?.results)) return { kind: "retry", message: "ответ без результатов" };
      return { kind: "ok", results: r.data.results };
    },

    async getState(userId, since) {
      const r = await request("/rest/v1/rpc/mark_get_state", { p_user: userId, p_since: since ?? null });
      if (r.kind !== "ok") return r;
      if (!r.data || typeof r.data.cursor !== "number") return { kind: "retry", message: "неполный ответ" };
      return { kind: "ok", state: r.data };
    },
  };
}
