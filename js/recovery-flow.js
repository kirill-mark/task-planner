// This controller receives a separate, non-persistent Auth client. Never use
// the planner's saved session as authority to reset a forgotten password.
export const recoveryAuthOptions = {
  persistSession: false,
  autoRefreshToken: false,
  detectSessionInUrl: false,
  storageKey: "mark-password-recovery",
};

const invalidLink = "Ссылка недействительна или устарела. Запросите новое письмо через «Забыли пароль?» в Mark.";

export function createRecoveryFlow(auth) {
  let ready = false;
  let busy = false;
  return {
    async initialize(hash) {
      ready = false;
      const params = new URLSearchParams(hash.replace(/^#/, ""));
      if (params.get("type") !== "recovery" || !params.get("access_token") || !params.get("refresh_token") || params.has("error")) {
        return { ok: false, message: invalidLink };
      }
      try {
        const { data, error } = await auth.setSession({
          access_token: params.get("access_token"),
          refresh_token: params.get("refresh_token"),
        });
        ready = !error && !!data?.session;
        return ready ? { ok: true } : { ok: false, message: invalidLink };
      } catch {
        return { ok: false, message: "Не удалось проверить ссылку. Проверьте интернет и откройте её из письма снова." };
      }
    },
    async changePassword(password, confirmation) {
      if (!ready) return { ok: false, message: invalidLink };
      if (busy) return { ok: false, message: "Подождите завершения запроса." };
      if (password.length < 8) return { ok: false, message: "Используйте не менее 8 символов." };
      if (password !== confirmation) return { ok: false, message: "Пароли не совпадают." };
      busy = true;
      try {
        const { data, error } = await auth.updateUser({ password });
        if (error || !data?.user) return { ok: false, message: "Не удалось изменить пароль. Попробуйте другой пароль или запросите новую ссылку." };
        ready = false;
        // Revoke only the temporary recovery session, never all user's devices.
        try { await auth.signOut({ scope: "local" }); } catch { /* password already saved */ }
        return { ok: true };
      } catch {
        return { ok: false, message: "Не удалось связаться с сервером. Проверьте интернет и попробуйте снова." };
      } finally {
        busy = false;
      }
    },
  };
}
