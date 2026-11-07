import { useCallback, useEffect, useRef, useState } from "react";

/**
 * A note typed and never sent goes by itself this long after its box is
 * left: tabbing to another app, putting the phone down, or clicking
 * elsewhere on the page. Long enough to come back and finish a thought,
 * short enough that the note still lands near when it was written.
 */
export const SEND_AFTER_MS = 30_000;

/**
 * The clock for one box: when it was left, and whether that was long enough
 * ago. Pure, so the rules are tested without a page.
 */
export function createLeaveWatch(delayMs = SEND_AFTER_MS) {
  let leftAt: number | null = null;
  return {
    get leftAt() {
      return leftAt;
    },
    /** The box was left. Leaving again before coming back keeps the first time. */
    left(now: number) {
      if (leftAt === null) leftAt = now;
    },
    /** Nothing to send any more (the box emptied, or the note went). */
    reset() {
      leftAt = null;
    },
    /** Whole seconds until it goes, or null when it isn't waiting. */
    secondsLeft(now: number): number | null {
      if (leftAt === null) return null;
      return Math.max(0, Math.ceil((leftAt + delayMs - now) / 1000));
    },
    /**
     * When it's due: the time the box was left (the note's time), and the
     * watch stops. Otherwise null.
     */
    due(now: number): number | null {
      if (leftAt === null || now - leftAt < delayMs) return null;
      const at = leftAt;
      leftAt = null;
      return at;
    },
    /**
     * Back in the box. That calls it off — unless it was already due: a phone
     * that froze the page while it was put away runs nothing until it's
     * picked up again, and focus coming back is the first thing that page
     * sees. Then it still goes, with the time the box was left.
     */
    back(now: number): number | null {
      const at = this.due(now);
      leftAt = null;
      return at;
    },
  };
}

/**
 * Sends a box's text by itself once the box has been left for
 * `SEND_AFTER_MS`. Spread `boxProps` on the element around everything that
 * counts as the box (the field, its Add button, its time) — moving between
 * those isn't leaving. `send` gets the time the box was left.
 *
 * Returns the seconds left while it's waiting, to say so, and `keepWriting`
 * to call it off and put the cursor back.
 */
export function useSendWhenLeft(hasText: boolean, send: (leftAt: number) => void, field: { current: HTMLElement | null }) {
  const watch = useRef(createLeaveWatch());
  const box = useRef<HTMLElement | null>(null);
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  // The latest `send`, so a timer set a while ago sends what's in the box now.
  const sendRef = useRef(send);
  sendRef.current = send;
  const hasTextRef = useRef(hasText);
  hasTextRef.current = hasText;

  const fire = useCallback((at: number | null) => {
    setSecondsLeft(null);
    if (at !== null && hasTextRef.current) sendRef.current(at);
  }, []);

  const leave = useCallback(() => {
    if (!hasTextRef.current) return;
    const now = Date.now();
    watch.current.left(now);
    setSecondsLeft(watch.current.secondsLeft(now));
  }, []);

  // Emptied, or sent: nothing waits.
  useEffect(() => {
    if (hasText) return;
    watch.current.reset();
    setSecondsLeft(null);
  }, [hasText]);

  const waiting = secondsLeft !== null;
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      const now = Date.now();
      const at = watch.current.due(now);
      if (at !== null) fire(at);
      else setSecondsLeft(watch.current.secondsLeft(now));
    };
    // Hidden pages run timers late (or not at all); on coming back, look at
    // once rather than on the next tick.
    const onVisible = () => {
      if (document.visibilityState === "visible") tick();
    };
    const timer = window.setInterval(tick, 1000);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [waiting, fire]);

  // Put away with the cursor still in the box: some browsers don't move
  // focus out of a page that's going to the background.
  useEffect(() => {
    const onHidden = () => {
      if (document.visibilityState === "hidden" && box.current?.contains(document.activeElement)) leave();
    };
    document.addEventListener("visibilitychange", onHidden);
    return () => document.removeEventListener("visibilitychange", onHidden);
  }, [leave]);

  const boxProps = {
    ref: (el: HTMLElement | null) => {
      box.current = el;
    },
    onFocus: () => {
      const at = watch.current.back(Date.now());
      fire(at);
    },
    onBlur: (event: React.FocusEvent<HTMLElement>) => {
      // Focus moving within the box (the field to Add, the time to the field)
      // isn't leaving it. A window losing focus has nowhere to go: null.
      const to = event.relatedTarget as Node | null;
      if (to && event.currentTarget.contains(to)) return;
      leave();
    },
  };

  const keepWriting = useCallback(() => {
    watch.current.reset();
    setSecondsLeft(null);
    field.current?.focus();
  }, [field]);

  return { secondsLeft, keepWriting, boxProps };
}
