import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FOREGROUND_SYNC_INTERVAL_MS, startForegroundSync } from "./foreground-sync";

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T00:00:00Z")); });
afterEach(() => { vi.useRealTimers(); });
function setup() {
  const window = new EventTarget();
  const target = new EventTarget();
  let visible = true;
  let idle = true;
  const document = {
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target),
    get visibilityState(): DocumentVisibilityState { return visible ? "visible" : "hidden"; },
  };
  const sync = vi.fn(async () => {});
  const stop = startForegroundSync({ window, document, sync, canSync: () => idle });
  return { window, target, sync, stop, setVisible(value: boolean) { visible = value; target.dispatchEvent(new Event("visibilitychange")); }, setIdle(value: boolean) { idle = value; } };
}
describe("foreground state synchronization", () => {
  it("coalesces focus and visibility events and delays return sync until writes are finished", async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(5_000);
    s.setIdle(false);
    s.setVisible(false); s.setVisible(true); s.window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.sync).not.toHaveBeenCalled();
    s.setIdle(true);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(s.sync).toHaveBeenCalledTimes(1);
    s.window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.sync).toHaveBeenCalledTimes(1);
    s.stop();
  });
  it("polls only visible views and removes timers and listeners on dispose", async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(s.sync).toHaveBeenCalledTimes(1);
    s.setVisible(false);
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS * 3);
    expect(s.sync).toHaveBeenCalledTimes(1);
    s.setVisible(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(s.sync).toHaveBeenCalledTimes(2);
    s.stop();
    s.window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS * 2);
    expect(s.sync).toHaveBeenCalledTimes(2);
  });
  it("does not overlap a slow sync or spin on request failures", async () => {
    const s = setup();
    let finish!: () => void;
    s.sync.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    s.window.dispatchEvent(new Event("focus"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(s.sync).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(1_000);
    s.sync.mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(FOREGROUND_SYNC_INTERVAL_MS);
    expect(s.sync).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(s.sync).toHaveBeenCalledTimes(2);
    s.stop();
  });
});
