import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import ModuleScheduler from "./moduleScheduler";
import type { ModuleProps } from "../types/modules";

// ─── Fixtures ──────────────────────────────────────────────────────────────

const routine = (duration = 10_000): ModuleProps =>
  ({ type: "Routine", duration } as ModuleProps);

const chat = (duration = 10_000): ModuleProps =>
  ({ type: "Chat", duration, audio: false, module_id: "m1" } as ModuleProps);

const time = (interval: 15 | 30 | 60 = 15, duration = 5_000): ModuleProps =>
  ({ type: "Time", interval, duration } as ModuleProps);

// ─── Test helpers ──────────────────────────────────────────────────────────

/**
 * Creates a fresh set of mock dependencies for each test.
 * - showModule: captures every module that gets passed to the display layer
 * - scheduleAtInterval: captures the callbacks so tests can fire them manually
 */
function makeDeps() {
  const showModule = vi.fn<[ModuleProps], void>();
  const clearModule = vi.fn<[], void>();

  // keeps track of each interval callback so tests can fire them on demand
  const intervalCallbacks: Array<() => void> = [];
  const intervalStops: Array<ReturnType<typeof vi.fn>> = [];

  const scheduleAtInterval = vi.fn((_minutes: number, cb: () => void) => {
    intervalCallbacks.push(cb);
    const stop = vi.fn();
    intervalStops.push(stop);
    return stop;
  });

  return { showModule, clearModule, scheduleAtInterval, intervalCallbacks, intervalStops };
}

/**
 * Returns the props that were passed to showModule on its nth call (0-based).
 * Includes the injected onShutdownRequest / onModuleDone callbacks.
 */
function shownAt(showModule: ReturnType<typeof vi.fn>, index = -1) {
  const calls = showModule.mock.calls;
  const i = index < 0 ? calls.length + index : index;
  return calls[i]?.[0] as ModuleProps & {
    onShutdownRequest?: (trigger: () => void) => void;
    onModuleDone?: () => void;
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("ModuleScheduler", () => {

  // ── Fake timers (needed for duration-based tests) ──────────────────────

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());


  // ── Rotating modules ───────────────────────────────────────────────────

  describe("rotating modules", () => {

    it("shows the first rotating module on start()", () => {
      // Basic smoke test: the scheduler immediately displays the first module.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start();

      expect(deps.showModule).toHaveBeenCalledOnce();
      expect(shownAt(deps.showModule, 0).type).toBe("Routine");
    });

    it("advances to the next module after onModuleDone", () => {
      // After the current module signals it is done, the next one should show.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start();

      shownAt(deps.showModule).onModuleDone?.();

      expect(deps.showModule).toHaveBeenCalledTimes(2);
      expect(shownAt(deps.showModule, 1).type).toBe("Chat");
    });

    it("wraps around to the first module after the last one", () => {
      // Round-robin: once all modules have shown, it cycles back to index 0.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start();

      shownAt(deps.showModule).onModuleDone?.(); // Routine → Chat
      shownAt(deps.showModule).onModuleDone?.(); // Chat → Routine

      expect(deps.showModule).toHaveBeenCalledTimes(3);
      expect(shownAt(deps.showModule, 2).type).toBe("Routine");
    });

    it("does nothing if there are no rotating modules", () => {
      // Scheduler should sit idle when the config contains only interval modules.
      const deps = makeDeps();
      const s = new ModuleScheduler([time()], deps);
      s.start();

      expect(deps.showModule).not.toHaveBeenCalled();
    });

  });


  // ── Duration timer ─────────────────────────────────────────────────────

  describe("duration timer", () => {

    it("fires DurationExpired after the module's duration has elapsed", () => {
      // The scheduler sets a setTimeout equal to module.duration.
      // When it fires it should begin shutdown and then advance.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(5_000), chat()], deps);
      s.start();

      vi.advanceTimersByTime(5_000);

      // Routine has no shutdown trigger registered → immediate advance
      expect(deps.showModule).toHaveBeenCalledTimes(2);
      expect(shownAt(deps.showModule, 1).type).toBe("Chat");
    });

    it("clears the duration timer when onModuleDone fires early", () => {
      // If a module self-terminates before the timer fires, the timer must be
      // cancelled so it doesn't cause a spurious advance later.
      // The second module has no duration so it never sets its own timer.
      const noDuration = { type: "Chat", audio: false, module_id: "m1" } as ModuleProps;
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(10_000), noDuration], deps);
      s.start();

      // Module done early — before the 10s timer
      shownAt(deps.showModule).onModuleDone?.();
      expect(deps.showModule).toHaveBeenCalledTimes(2); // advanced once

      // Routine's cancelled timer fires — should be a no-op (Chat has no timer either)
      vi.advanceTimersByTime(10_000);
      expect(deps.showModule).toHaveBeenCalledTimes(2); // still 2, not 3
    });

  });


  // ── Interval modules ───────────────────────────────────────────────────

  describe("interval modules", () => {

    it("registers a clock schedule for each interval module on start()", () => {
      // scheduleAtInterval should be called once per interval module.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), time(15)], deps);
      s.start();

      expect(deps.scheduleAtInterval).toHaveBeenCalledOnce();
      expect(deps.scheduleAtInterval).toHaveBeenCalledWith(15, expect.any(Function));
    });

    it("shows the interval module immediately when its clock fires while IDLE", () => {
      // If no rotating module is currently showing, an interval fire should
      // display the interval module right away.
      const deps = makeDeps();
      const s = new ModuleScheduler([time(15)], deps); // no rotating modules
      s.start();

      deps.intervalCallbacks[0](); // simulate clock tick

      expect(deps.showModule).toHaveBeenCalledOnce();
      expect(shownAt(deps.showModule).type).toBe("Time");
    });

    it("preempts the current rotating module when the interval fires", () => {
      // IntervalDue while SHOWING → graceful shutdown of current → show interval module.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), time(15)], deps);
      s.start(); // shows Routine

      // Routine registers a cleanup function with the scheduler via onShutdownRequest.
      // When the scheduler triggers shutdown it calls this function; the module
      // then calls onModuleDone once its cleanup is complete.
      let shutdownCalled = false;
      shownAt(deps.showModule).onShutdownRequest?.(() => {
        shutdownCalled = true;
        shownAt(deps.showModule).onModuleDone?.();
      });

      deps.intervalCallbacks[0](); // interval fires — should begin shutdown

      expect(shutdownCalled).toBe(true);
      expect(deps.showModule).toHaveBeenCalledTimes(2);
      expect(shownAt(deps.showModule, 1).type).toBe("Time");
    });

  });


  // ── ConfigChanged ──────────────────────────────────────────────────────

  describe("ConfigChanged", () => {

    it("applies new config immediately when IDLE", () => {
      // updateConfig while nothing is showing → switch to the new module list.
      const deps = makeDeps();
      const s = new ModuleScheduler([], deps);
      s.start(); // IDLE — nothing to show

      s.updateConfig([chat()]);

      expect(deps.showModule).toHaveBeenCalledOnce();
      expect(shownAt(deps.showModule).type).toBe("Chat");
    });

    it("gracefully shuts down the current module before switching config", () => {
      // ConfigChanged while SHOWING → trigger shutdown on current module →
      // once done, start showing from the new config.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine()], deps);
      s.start();

      let shutdownCalled = false;
      shownAt(deps.showModule).onShutdownRequest?.(() => {
        shutdownCalled = true;
        shownAt(deps.showModule).onModuleDone?.();
      });

      s.updateConfig([chat()]);

      expect(shutdownCalled).toBe(true);
      expect(deps.showModule).toHaveBeenCalledTimes(2);
      expect(shownAt(deps.showModule, 1).type).toBe("Chat");
    });

    it("queues ConfigChanged while SHUTTING_DOWN and applies it after done", () => {
      // If we're already shutting down (e.g. DurationExpired), a second
      // ConfigChanged must wait until the current shutdown completes.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine()], deps);
      s.start();

      // Routine registers a cleanup function — it won't self-complete,
      // so we control exactly when onModuleDone fires.
      let shutdownCalled = false;
      shownAt(deps.showModule).onShutdownRequest?.(() => {
        shutdownCalled = true;
        // intentionally NOT calling onModuleDone yet
      });

      // DurationExpired → begins shutdown, calls our cleanup fn
      vi.advanceTimersByTime(10_000);
      expect(shutdownCalled).toBe(true); // shutdown was triggered

      // ConfigChanged arrives while SHUTTING_DOWN — must be queued
      s.updateConfig([chat()]);
      expect(deps.showModule).toHaveBeenCalledTimes(1); // nothing new yet

      // Shutdown completes — scheduler should now apply the queued ConfigChanged
      shownAt(deps.showModule).onModuleDone?.();

      expect(shownAt(deps.showModule, 1).type).toBe("Chat");
    });

    it("restarts interval schedules when config changes", () => {
      // Old interval schedules must be stopped, new ones started.
      const deps = makeDeps();
      const s = new ModuleScheduler([time(15)], deps);
      s.start();

      const firstStop = deps.intervalStops[0];

      s.updateConfig([time(30)]); // replace with a different interval

      expect(firstStop).toHaveBeenCalled(); // old schedule stopped
      expect(deps.scheduleAtInterval).toHaveBeenCalledTimes(2); // new one registered
      expect(deps.scheduleAtInterval).toHaveBeenLastCalledWith(30, expect.any(Function));
    });

    it("resets the module index when config changes", () => {
      // After a config change the rotation should restart from position 0.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start();

      shownAt(deps.showModule).onModuleDone?.(); // advance to Chat (index 1)
      expect(shownAt(deps.showModule, 1).type).toBe("Chat");

      // Config change → should reset to index 0 of new list
      s.updateConfig([chat(), routine()]);
      shownAt(deps.showModule).onModuleDone?.(); // finish Chat, get next

      expect(shownAt(deps.showModule, 2).type).toBe("Chat"); // new list[0]
    });

  });


  // ── Event priority ─────────────────────────────────────────────────────

  describe("event priority", () => {

    it("ConfigChanged beats IntervalDue when both are queued", () => {
      // Both events arrive while SHUTTING_DOWN. consumeHighest must pick
      // ConfigChanged (priority 1) over IntervalDue (priority 2).
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), time(15)], deps);
      s.start();

      // Routine registers a cleanup — intentionally does NOT call onModuleDone,
      // so we stay in SHUTTING_DOWN long enough to queue both events.
      shownAt(deps.showModule).onShutdownRequest?.(() => { /* cleanup, holds off onModuleDone */ });

      // Fire DurationExpired to enter SHUTTING_DOWN
      vi.advanceTimersByTime(10_000);

      // While shutting down, queue both
      deps.intervalCallbacks[0](); // IntervalDue
      s.updateConfig([chat()]);    // ConfigChanged

      // Complete the shutdown
      shownAt(deps.showModule).onModuleDone?.();

      // ConfigChanged should win — Chat from new config, not Time
      expect(shownAt(deps.showModule, 1).type).toBe("Chat");
    });

  });


  // ── Multiple intervals ────────────────────────────────────────────────

  describe("multiple interval modules", () => {

    it("shows both interval modules sequentially when both fire simultaneously", () => {
      // Two distinct interval modules firing while SHUTTING_DOWN must each get
      // their own slot in the queue — neither should overwrite the other.
      // After shutdown: first is shown, then second is consumed from the queue.
      const timeA = time(15);
      const timeB = time(30);
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), timeA, timeB], deps);
      s.start();

      // Hold the scheduler in SHUTTING_DOWN
      shownAt(deps.showModule).onShutdownRequest?.(() => { /* holds off onModuleDone */ });
      vi.advanceTimersByTime(10_000); // DurationExpired → SHUTTING_DOWN

      // Both interval callbacks fire while stuck in SHUTTING_DOWN
      deps.intervalCallbacks[0](); // timeA → IntervalDue(timeA)
      deps.intervalCallbacks[1](); // timeB → IntervalDue(timeB) — separate slot, not overwritten

      // Complete shutdown — timeA is shown first (first pushed, equal priority)
      shownAt(deps.showModule).onModuleDone?.();
      expect(deps.showModule).toHaveBeenCalledTimes(2);
      expect(shownAt(deps.showModule, 1).interval).toBe(15); // timeA

      // After timeA's duration — timeB is still in queue and gets shown
      vi.advanceTimersByTime(5_000);
      expect(deps.showModule).toHaveBeenCalledTimes(3);
      expect(shownAt(deps.showModule, 2).interval).toBe(30); // timeB
    });

  });


  // ── forceStop() ────────────────────────────────────────────────────────

  describe("forceStop()", () => {

    it("immediately stops without advancing to the next module", () => {
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start(); // shows Routine

      s.forceStop();

      expect(deps.showModule).toHaveBeenCalledTimes(1);
      expect(deps.clearModule).not.toHaveBeenCalled();
    });

    it("ignores late onModuleDone after forceStop", () => {
      // A module's cleanup callback (e.g. TTS onend) may fire after forceStop.
      // It must not trigger an advance or show a new module.
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), chat()], deps);
      s.start();

      const { onModuleDone } = shownAt(deps.showModule);
      s.forceStop();
      onModuleDone?.();

      expect(deps.showModule).toHaveBeenCalledTimes(1);
    });

    it("cancels the duration timer — no advance fires after the timer would have elapsed", () => {
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(5_000), chat()], deps);
      s.start();

      s.forceStop();
      vi.advanceTimersByTime(5_000);

      expect(deps.showModule).toHaveBeenCalledTimes(1);
    });

    it("stops all interval schedules", () => {
      const deps = makeDeps();
      const s = new ModuleScheduler([routine(), time(15)], deps);
      s.start();

      s.forceStop();

      for (const stop of deps.intervalStops) {
        expect(stop).toHaveBeenCalled();
      }
    });

    it("ignores interval callbacks that fire after forceStop", () => {
      // The mock stop() is a no-op so the callback reference stays live.
      // The stopped flag in handleEvent must silence it.
      const deps = makeDeps();
      const s = new ModuleScheduler([time(15)], deps);
      s.start();

      s.forceStop();
      deps.intervalCallbacks[0]?.();

      expect(deps.showModule).not.toHaveBeenCalled();
    });

  });


});
