import { describe, expect, test } from "bun:test";

import { SEND_AFTER_MS, createLeaveWatch } from "./send-when-left.ts";

describe("a note box left with words in it", () => {
  test("waits, counting down, then goes with the time it was left", () => {
    const w = createLeaveWatch();
    expect(w.secondsLeft(1_000)).toBeNull();
    w.left(1_000);
    expect(w.secondsLeft(1_000)).toBe(30);
    expect(w.secondsLeft(1_000 + 10_500)).toBe(20);
    expect(w.due(1_000 + SEND_AFTER_MS - 1)).toBeNull();
    expect(w.due(1_000 + SEND_AFTER_MS)).toBe(1_000);
    // Once only.
    expect(w.due(1_000 + SEND_AFTER_MS + 5_000)).toBeNull();
    expect(w.secondsLeft(1_000 + SEND_AFTER_MS + 5_000)).toBeNull();
  });

  test("coming back in time calls it off", () => {
    const w = createLeaveWatch();
    w.left(0);
    expect(w.back(20_000)).toBeNull();
    expect(w.due(60_000)).toBeNull();
  });

  test("coming back to a page that slept through the wait still sends it, at the time it was left", () => {
    const w = createLeaveWatch();
    w.left(5_000);
    expect(w.back(5_000 + 10 * 60_000)).toBe(5_000);
    expect(w.leftAt).toBeNull();
  });

  test("leaving twice keeps the first time: the window going after the field did", () => {
    const w = createLeaveWatch();
    w.left(0);
    w.left(25_000);
    expect(w.due(SEND_AFTER_MS)).toBe(0);
  });

  test("emptied, nothing waits", () => {
    const w = createLeaveWatch();
    w.left(0);
    w.reset();
    expect(w.due(SEND_AFTER_MS)).toBeNull();
  });
});
