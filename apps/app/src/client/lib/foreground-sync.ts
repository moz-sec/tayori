export const FOREGROUND_SYNC_INTERVAL_MS = 5 * 60 * 1000;
const EVENT_COOLDOWN_MS = 3_000;

/** Coalesces focus/visibility events and refreshes visible, idle views every five minutes. */
export function startForegroundSync(options: {
  window: Pick<Window, "addEventListener" | "removeEventListener">;
  document: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState">;
  canSync: () => boolean;
  sync: () => Promise<unknown>;
}) {
  let disposed = false;
  let running = false;
  let pending = false;
  let lastStarted = Date.now();
  let nextPoll = lastStarted + FOREGROUND_SYNC_INTERVAL_MS;
  let timer: ReturnType<typeof setTimeout>;

  const schedule = (delay: number) => {
    clearTimeout(timer);
    if (!disposed) timer = setTimeout(drain, delay);
  };
  const drain = () => {
    if (disposed) return;
    if (options.document.visibilityState !== "visible") return;
    if (Date.now() >= nextPoll) pending = true;
    if (!pending) {
      schedule(Math.max(1, nextPoll - Date.now()));
      return;
    }
    if (running || !options.canSync() || Date.now() - lastStarted < EVENT_COOLDOWN_MS) {
      schedule(1_000);
      return;
    }
    pending = false;
    running = true;
    lastStarted = Date.now();
    nextPoll = lastStarted + FOREGROUND_SYNC_INTERVAL_MS;
    // The caller reports request failures. Keep event handlers free of rejected promises.
    void Promise.resolve()
      .then(() => {
        if (!disposed && options.document.visibilityState === "visible" && options.canSync())
          return options.sync();
        pending = true;
      })
      .catch(() => {})
      .finally(() => {
        running = false;
        schedule(pending ? 1_000 : Math.max(1, nextPoll - Date.now()));
      });
  };
  const onReturn = () => {
    if (options.document.visibilityState !== "visible") {
      clearTimeout(timer);
      return;
    }
    // A focus and visibility event commonly arrive together; one refresh covers both.
    if (Date.now() - lastStarted >= EVENT_COOLDOWN_MS) pending = true;
    drain();
  };
  options.window.addEventListener("focus", onReturn);
  options.document.addEventListener("visibilitychange", onReturn);
  if (options.document.visibilityState === "visible") schedule(FOREGROUND_SYNC_INTERVAL_MS);
  return () => {
    disposed = true;
    clearTimeout(timer);
    options.window.removeEventListener("focus", onReturn);
    options.document.removeEventListener("visibilitychange", onReturn);
  };
}
