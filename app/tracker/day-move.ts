import { addDays } from "../../src/time.ts";

/**
 * Which way a navigation moves the day, written where CSS can see it.
 *
 * Moving within the week shown is a move of the day — the highlight slides
 * along the strip to the new date — and moving to a day outside it is a move
 * of the week, where the whole strip slides out and the new one in. The
 * animation in `day-move.css` needs to know which of the four it is. React
 * Router starts the view transition as it commits the navigation, and a
 * link's `onClick` runs before that — so this is set from the click, and the
 * attribute is already on `<html>` by the time the old frame is captured.
 */

export type DayMove = "day-later" | "day-earlier" | "week-later" | "week-earlier";

/**
 * The move from `from` to `to`, given the first day of the week on screen.
 * A step of one day off the end of the strip is a week move too: the strip
 * has to change, and a highlight sliding from one edge to the other would
 * say the opposite of what happened.
 */
export function moveBetween(from: string, to: string, weekStart: string): DayMove {
  const later = to > from;
  const inWeek = to >= weekStart && to <= addDays(weekStart, 6);
  return `${inWeek ? "day" : "week"}-${later ? "later" : "earlier"}`;
}

let current = 0;

/**
 * How long a move waits for its transition to begin before giving up on it —
 * a navigation that failed, or one cut short, never starts one. Generous,
 * because the transition only begins once the new day has loaded.
 */
const GIVE_UP_MS = 10_000;

const isSlide = (a: Animation) => (a.effect as KeyframeEffect | null)?.pseudoElement?.startsWith("::view-transition") ?? false;

/**
 * Marks the move, and takes the mark off once the transition it starts has
 * finished.
 *
 * The mark has to last exactly as long as that transition: the animations in
 * `day-move.css` hang off it, and taking it off part-way swaps them for the
 * browser's own mid-flight — the day fades in a second time, the highlight
 * changes speed — and drags the transition out past the next move. And it has
 * to go afterwards, because the browser's back and forward replay a view
 * transition too, and would play this direction for them.
 *
 * The transition starts only when the new day has loaded, however long that
 * takes, so its end can't be timed from the click. React Router starts it
 * and doesn't hand it out; its parts' animations are on the document,
 * though, and the ones that weren't there at the click are this move's. The
 * mark comes off once those are gone from the document — not merely
 * finished: finished, they hold their last frame until the browser takes the
 * transition down, and changing what drives them in that moment starts the
 * browser's own over again. A newer move owns the mark from the moment it's
 * made, so an older one never takes it off.
 */
export function markDayMove(move: DayMove): void {
  const root = document.documentElement;
  root.dataset.dayMove = move;
  const mine = ++current;
  const clear = () => {
    if (current === mine) delete root.dataset.dayMove;
  };
  // Already running when the click came: a move this one interrupts.
  const before = new Set(document.getAnimations().filter(isSlide));
  const giveUpAt = performance.now() + GIVE_UP_MS;
  let slide: Animation[] = [];
  const watch = () => {
    if (current !== mine) return;
    const now = document.getAnimations().filter(isSlide);
    if (!slide.length) {
      // Every part's animation starts together, when the transition does.
      slide = now.filter((a) => !before.has(a));
      if (!slide.length && performance.now() > giveUpAt) return clear();
    } else if (!slide.some((a) => now.includes(a))) {
      return clear();
    }
    requestAnimationFrame(watch);
  };
  requestAnimationFrame(watch);
}
