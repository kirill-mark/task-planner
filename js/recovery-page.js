import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./mark/transport.js";
import { createRecoveryFlow, recoveryAuthOptions } from "./recovery-flow.js";

const hash = location.hash;
// Credentials stay in memory for this page only, and disappear from the URL.
history.replaceState(null, "", location.pathname);
const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: recoveryAuthOptions });
const flow = createRecoveryFlow(client.auth);
const form = document.getElementById("recovery-form");
const message = document.getElementById("recovery-message");
const button = form.querySelector("button");
const result = await flow.initialize(hash);
if (result.ok) {
  message.textContent = "Задайте новый пароль для аккаунта MARK.";
  form.hidden = false;
} else {
  message.textContent = result.message;
  message.classList.add("bad");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (button.disabled) return;
  const fields = new FormData(form);
  button.disabled = true;
  button.textContent = "Сохраняется…";
  message.classList.remove("bad");
  const result = await flow.changePassword(String(fields.get("password") || ""), String(fields.get("confirmation") || ""));
  form.reset();
  if (result.ok) {
    form.hidden = true;
    message.textContent = "Пароль изменён. Вернитесь в приложение MARK и войдите с новым паролем.";
  } else {
    message.textContent = result.message;
    message.classList.add("bad");
  }
  button.disabled = false;
  button.textContent = "Сохранить пароль";
});
