import { Box, Group, Stack, Text } from "@mantine/core";
import { type ReactNode, useEffect } from "react";
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
// Deleting and removing are neutral: undo or a confirm step guards them, and a
// red button that isn't a failure would teach that red can mean anything.
/**
 * Orange text, for a short title or label only — never a paragraph: orange
 * dark enough to read on white (shade 9) in light, and a pale one in dark.
 * Set in needs-you.module.css.
 */
export const NEEDS_YOU_TEXT = "var(--needs-you-text)";

/**
 * A dialog's buttons: in a row at the end on a wide screen; on a phone,
 * stacked full width with the main action (last in the markup) on top.
 * Not "needs you" as such, but one rule for every dialog lives here with the
 * others the reviews settled.
 */
export const dialogActions = classes.dialogActions;

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
 * The one shape for "this waits on you, and here's what to do": the same
 * border and wash as a marked card, an orange title, a line or two, and its
 * actions — the main one a filled button, as everywhere else. Every such
 * message in the app is one of these, so it's learned once.
 */
export function NeedsYouCallout({
  title,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  children?: ReactNode;
  /** Buttons, the main one first. */
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <Box role="alert" className={[classes.card, classes.callout, className].filter(Boolean).join(" ")}>
      <Stack gap="xs">
        <Text fw={600} c={NEEDS_YOU_TEXT}>
          {title}
        </Text>
        {children && (
          <Text size="sm" component="div">
            {children}
          </Text>
        )}
        {actions && (
          <Group gap="sm" align="flex-start">
            {actions}
          </Group>
        )}
      </Stack>
    </Box>
  );
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
      const behavior = smooth ? "smooth" : "auto";
      // If it's on the first screen with the page at the top, stay there: the
      // day's name stays in view, which is half of "what's wrong, where".
      // Otherwise its top, not its middle — a card taller than half a phone
      // screen, centred, put its title under the sticky header. The card's
      // scroll-margin keeps it clear of that header.
      const bottom = target.getBoundingClientRect().bottom + window.scrollY;
      if (bottom <= window.innerHeight) window.scrollTo({ top: 0, behavior });
      else target.scrollIntoView({ block: "start", behavior });
      target.focus({ preventScroll: true });
      target.setAttribute("data-arrived", "");
      window.setTimeout(() => target.removeAttribute("data-arrived"), 2400);
    });
    return () => cancelAnimationFrame(frame);
  }, [ready, hash, key]);
}
