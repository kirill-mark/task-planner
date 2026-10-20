import assert from "node:assert/strict";
import { test } from "node:test";
import { createRecoveryFlow, recoveryAuthOptions } from "../js/recovery-flow.js";
import { renderAuth } from "../js/ui/views.js";
import { build } from "esbuild";
import vm from "node:vm";

const validLink = "#type=recovery&access_token=synthetic-access&refresh_token=synthetic-refresh";
function fakeAuth(overrides = {}) {
  const calls = [];
  return {
    calls,
    async setSession(tokens) { calls.push(["session", tokens]); return { data: { session: { user: { id: "synthetic-user" } } } }; },
    async updateUser(value) { calls.push(["update", value]); return { data: { user: { id: "synthetic-user" } } }; },
    async signOut(value) { calls.push(["logout", value]); return {}; },
    ...overrides,
  };
}

test("recovery never reads or persists the planner session", () => {
  assert.equal(recoveryAuthOptions.persistSession, false);
  assert.equal(recoveryAuthOptions.autoRefreshToken, false);
  assert.equal(recoveryAuthOptions.detectSessionInUrl, false);
  assert.equal(recoveryAuthOptions.storageKey, "mark-password-recovery");
});

test("missing, incomplete, expired and non-recovery links do not authorize a reset", async () => {
  for (const hash of ["", "#type=signup&access_token=a&refresh_token=b", "#type=recovery&access_token=a", "#error=access_denied&error_code=otp_expired", validLink + "&error=denied"]) {
    const auth = fakeAuth();
    const flow = createRecoveryFlow(auth);
    assert.equal((await flow.initialize(hash)).ok, false);
    assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
    assert.deepEqual(auth.calls, []);
  }
});

test("rejected recovery session cannot change a password", async () => {
  const auth = fakeAuth({ async setSession() { return { error: { message: "expired" } }; } });
  const flow = createRecoveryFlow(auth);
  assert.equal((await flow.initialize(validLink)).ok, false);
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
  assert.deepEqual(auth.calls, []);
});

test("network failure validating a link gives a recoverable error", async () => {
  const auth = fakeAuth({ async setSession() { throw new Error("offline"); } });
  const flow = createRecoveryFlow(auth);
  assert.match((await flow.initialize(validLink)).message, /интернет/);
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
});

test("short and mismatched passwords never reach Auth", async () => {
  const auth = fakeAuth();
  const flow = createRecoveryFlow(auth);
  assert.equal((await flow.initialize(validLink)).ok, true);
  assert.equal((await flow.changePassword("short", "short")).ok, false);
  assert.equal((await flow.changePassword("eight123", "different")).ok, false);
  assert.equal(auth.calls.length, 1);
});

test("successful reset revokes only the temporary session and rejects repeat submits", async () => {
  const auth = fakeAuth();
  const flow = createRecoveryFlow(auth);
  await flow.initialize(validLink);
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, true);
  assert.deepEqual(auth.calls, [
    ["session", { access_token: "synthetic-access", refresh_token: "synthetic-refresh" }],
    ["update", { password: "eight123" }],
    ["logout", { scope: "local" }],
  ]);
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
  assert.equal(auth.calls.length, 3);
});

test("rejected or failed password update permits a retry without reporting success", async () => {
  for (const throws of [false, true]) {
    let attempts = 0;
    const auth = fakeAuth({ async updateUser() {
      if (++attempts === 1) {
        if (throws) throw new Error("offline");
        return { error: { message: "policy" } };
      }
      return { data: { user: { id: "synthetic-user" } } };
    } });
    const flow = createRecoveryFlow(auth);
    await flow.initialize(validLink);
    assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
    assert.equal((await flow.changePassword("eight123", "eight123")).ok, true);
  }
});

test("double submit cannot issue two simultaneous password changes", async () => {
  let finish;
  let updates = 0;
  const auth = fakeAuth({ async updateUser() {
    updates++;
    return new Promise(resolve => { finish = resolve; });
  } });
  const flow = createRecoveryFlow(auth);
  await flow.initialize(validLink);
  const pending = flow.changePassword("eight123", "eight123");
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, false);
  assert.equal(updates, 1);
  finish({ data: { user: { id: "synthetic-user" } } });
  assert.equal((await pending).ok, true);
});

test("temporary logout failure does not turn a saved password into a failure", async () => {
  const flow = createRecoveryFlow(fakeAuth({ async signOut() { throw new Error("offline"); } }));
  await flow.initialize(validLink);
  assert.equal((await flow.changePassword("eight123", "eight123")).ok, true);
});

test("recovery form requests email only and escapes the saved draft", () => {
  const html = renderAuth({ mode: "recover", email: '\"><script>alert(1)</script>', busy: true });
  assert.match(html, /Восстановление пароля/);
  assert.match(html, /Отправить письмо|Подождите/);
  assert.doesNotMatch(html, /type="password"/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /data-action="auth-toggle" disabled/);
});

test("normal sign-in has recovery and registration links", () => {
  const html = renderAuth({ mode: "signin", email: "" });
  assert.match(html, /Забыли пароль\?/);
  assert.match(html, /type="password"/);
  assert.match(html, /Зарегистрироваться/);
});

test("real reset request uses the fixed HTTPS page without sending a password", async () => {
  const bundled = await build({
    entryPoints: ["js/sync.js"], bundle: true, write: false, format: "iife", globalName: "Sync",
    plugins: [{ name: "fake-auth", setup(b) {
      b.onResolve({ filter: /^https:\/\/cdn\.jsdelivr/ }, () => ({ path: "fake-auth", namespace: "fake" }));
      b.onLoad({ filter: /.*/, namespace: "fake" }, () => ({ contents: `export function createClient() { return { auth: { resetPasswordForEmail(...args) { globalThis.captured = args; return Promise.resolve({data:{}, error:null}); } } }; }` }));
    } }],
  });
  const context = vm.createContext({});
  vm.runInContext(bundled.outputFiles[0].text, context);
  await context.Sync.requestPasswordReset("synthetic@example.invalid");
  assert.deepEqual(JSON.parse(JSON.stringify(context.captured)), ["synthetic@example.invalid", {
    redirectTo: "https://kirill-mark.github.io/task-planner/recover.html",
  }]);
});
