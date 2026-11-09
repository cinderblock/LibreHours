import { useEffect } from "react";
import { useLocation } from "react-router";

import classes from "./needs-you.module.css";

/**
 * One color for "this is waiting on you", used the same way everywhere.
 *
 * The app used yellow for some of these and orange for others, and a person
 * following "Go to <day>" from a warning couldn't tell what on that day was
 * wrong. Now there are two meanings and two colors:
 *
 *   - NEEDS_YOU (orange): something here waits on the person — notes not yet
 *     hours on a day gone by, time not submitted, time held against the
 *     accounting system's own, a job with two lines.
 *   - FAILED (red): something went wrong — a refused save, a sync error.
 *
 * Everything else — a status, a hint, offline — stays neutral.
 */
export const NEEDS_YOU = "orange";
export const FAILED = "red";
/** Text saying what needs doing, in the same color, readable light or dark. */
export const NEEDS_YOU_TEXT = "var(--mantine-color-orange-light-color)";

/** The fragment a link to a problem carries: the page lands on what's marked. */
export const NEEDS_YOU_HASH = "#needs-you";

/** A link to a day (or any page) that lands on what needs the person there. */
export function toProblem(href: string): string {
  return `${href.split("#")[0]}${NEEDS_YOU_HASH}`;
}

/**
 * Props for the thing on a page that needs the person: the attention outline,
 * and the mark a `toProblem` link lands on. `className` is the element's own,
 * kept either way; `on` false adds nothing to it.
 */
export function needsYou(on: boolean, kind: "card" | "row" = "card", className?: string) {
  if (!on) return { className };
  return {
    "data-needs-you": "",
    className: [className, kind === "card" ? classes.card : classes.row].filter(Boolean).join(" "),
    tabIndex: -1,
  };
}

/**
 * Arriving by a `toProblem` link: once the page has drawn, the first thing
 * marked as needing the person is scrolled to the middle of the screen,
 * takes focus (so a screen reader says what it is), and pulses briefly.
 * `ready` false waits — the day may still be loading.
 */
export function useArriveAtProblem(ready: boolean) {
  const { hash, key } = useLocation();
  useEffect(() => {
    if (!ready || hash !== NEEDS_YOU_HASH) return;
    // After the paint: the day's cards appear with an entrance, and scrolling
    // to where one will be before it's laid out lands short.
    const frame = requestAnimationFrame(() => {
      const target = document.querySelector<HTMLElement>("[data-needs-you]");
      if (!target) return;
      const smooth = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ block: "center", behavior: smooth ? "smooth" : "auto" });
      target.focus({ preventScroll: true });
      target.setAttribute("data-arrived", "");
      window.setTimeout(() => target.removeAttribute("data-arrived"), 2400);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, hash, key]);
}
