let speech = null;
export const setDeviceSpeech = (value) => { speech = value; };
export const getDeviceSpeech = () => speech;

// Audio stays in the native bridge. Only recognition text reaches the draft.
export function createDeviceSpeech(plugin) {
  const subscribers = new Set();
  let state = { phase: "idle", text: "", error: "", available: true };
  let generation = 0;
  const publish = (next) => { state = { ...state, ...next }; subscribers.forEach((fn) => fn(state)); };
  return {
    getState: () => state,
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    async listen() {
      await plugin.addListener("speech", (event) => {
        if (event.generation !== generation) return;
        publish({ phase: event.phase, text: event.text || "", error: event.error || "" });
      });
    },
    async start() {
      const current = ++generation;
      publish({ phase: "starting", text: "", error: "" });
      try { await plugin.start({ generation: current }); }
      catch { if (generation === current) publish({ phase: "idle", error: "Не удалось включить диктовку. Проверь разрешения для MARK в настройках iPhone." }); }
    },
    async stop() { await plugin.stop(); },
    async cancel() {
      ++generation;
      publish({ phase: "idle", text: "", error: "" });
      await plugin.cancel().catch(() => {});
    },
    setScreenActive(active) { plugin.setScreenActive({ active }).catch(() => {}); },
  };
}
