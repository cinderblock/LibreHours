import { Anchor, Button, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { Link, useFetcher } from "react-router";

import { formatWorkDate } from "../../src/time.ts";
import appear from "../components/appear.module.css";
import { NeedsYouCallout, toProblem } from "../components/needs-you.tsx";
import { useTracker } from "./context.tsx";

/** One day's reasons as a sentence: "A note isn't in the hours, and not submitted." */
function sentence(reasons: string[]): string {
  const text = reasons.join(", and ");
  return `${text[0]!.toUpperCase()}${text.slice(1)}.`;
}

/** How many days are listed before "and N more". */
const SHOWN = 5;

/**
 * Earlier days that wait on the person, in one place under the day header,
 * oldest first: notes not in the hours, time not submitted, time the
 * accounting system already has. Each says what's wrong with it and goes
 * there; the day itself marks the thing to fix.
 *
 * These used to be three cards in three places — the notes column, the time
 * column and the top — each worded and ordered its own way, and on a phone
 * one sat far below the others. Reviewers couldn't tell which came first,
 * and neither could the person.
 *
 * With the notes hold on, the oldest unfinished day also holds this one's
 * notes back; that's said here too, with the way to turn the hold off.
 */
export function EarlierDaysNeedYou() {
  const { model, hrefFor, dispatchAll, pending, actingFor } = useTracker();
  const [asking, setAsking] = useState(false);
  const isToday = model.workDate === model.today;
  const notesMode = model.mode === "notes";
  const writable = notesMode && model.workDate <= model.today;
  const unfinished = writable ? (model.notesToRollUp ?? null) : null;
  const heldBy = unfinished && model.notesHold ? unfinished : null;

  const reasons = new Map<string, string[]>();
  const add = (date: string, why: string) => reasons.set(date, [...(reasons.get(date) ?? []), why]);
  if (unfinished) {
    add(unfinished.date, unfinished.count === 1 ? "a note isn't in the hours" : `${unfinished.count} notes aren't in the hours`);
  }
  for (const date of model.unsubmittedDays) add(date, "not submitted");
  for (const date of model.heldDays ?? []) add(date, "QuickBooks already has time for it");
  const days = [...reasons.keys()].sort();
  if (days.length === 0) return null;

  const unsubmitted = model.unsubmittedDays;
  const withNotes = (model.unsubmittedWithNotes ?? []).filter((d) => unsubmitted.includes(d));
  const submitAll = () => {
    setAsking(false);
    void dispatchAll(unsubmitted.map((workDate) => ({ type: "day.submit" as const, payload: { workDate } })));
  };

  return (
    <NeedsYouCallout
      className={appear.appear}
      title={days.length === 1 ? `${formatWorkDate(days[0]!)} isn't finished` : `${days.length} earlier days aren't finished`}
    >
      <Stack gap="sm">
        <Stack gap={6} component="ul" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {days.slice(0, SHOWN).map((date) => (
            <Stack key={date} component="li" gap={6} align="flex-start">
              <Text size="sm">
                {days.length === 1 ? (
                  sentence(reasons.get(date)!)
                ) : (
                  <>
                    <Text span inherit fw={600}>
                      {formatWorkDate(date)}
                    </Text>
                    : {reasons.get(date)!.join(", and ")}.
                  </>
                )}
              </Text>
              {/* Every day's the same: its line, then its button under it. */}
              <Button component={Link} to={toProblem(hrefFor(date))} size="sm" variant="default">
                Go to {formatWorkDate(date)}
              </Button>
            </Stack>
          ))}
        </Stack>
        {days.length > SHOWN && (
          <Text size="sm" c="dimmed">
            And {days.length - SHOWN} more before those.
          </Text>
        )}

        {heldBy && (
          <Stack gap={4}>
            <Text size="sm">
              <Text span inherit fw={600}>
                You can't add notes {isToday ? "today" : "on this day"}
              </Text>{" "}
              until {formatWorkDate(heldBy.date)} is finished.
            </Text>
            {/* The setting is the person's own; an admin acting for them can't change it here. */}
            {!actingFor && <StopHolding />}
          </Stack>
        )}

        {unsubmitted.length > 1 && (
          <Stack gap={4}>
            <Group gap="sm">
              <Button
                size="xs"
                variant={asking ? "subtle" : "default"}
                color={asking ? "gray" : undefined}
                onClick={withNotes.length > 0 && !asking ? () => setAsking(true) : submitAll}
                loading={pending}
              >
                {asking ? "Submit anyway" : `Submit all ${unsubmitted.length} not submitted`}
              </Button>
              {asking && (
                <Button size="xs" variant="default" onClick={() => setAsking(false)}>
                  Not yet
                </Button>
              )}
            </Group>
            {asking && (
              <Text size="sm">
                Notes on{" "}
                {withNotes.map((date, i) => (
                  <span key={date}>
                    {i > 0 && ", "}
                    <Anchor component={Link} to={toProblem(hrefFor(date))} size="sm">
                      {formatWorkDate(date)}
                    </Anchor>
                  </span>
                ))}{" "}
                aren't in the hours yet. Turn them into hours or leave them out first, or submit anyway.
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    </NeedsYouCallout>
  );
}

/**
 * Turn the hold off from where it bites: from here on an unfinished day is a
 * reminder rather than a wall. Said plainly that it's a setting, not a
 * one-off; the Account page has the same switch, to turn it back on.
 */
function StopHolding() {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <Stack gap={2} align="flex-start">
      <Button
        size="xs"
        variant="default"
        loading={busy}
        onClick={() => fetcher.submit({ intent: "notes-hold", hold: "0" }, { method: "post", action: "/account" })}
      >
        Let me add notes anyway
      </Button>
      <Text size="xs" c="dimmed">
        This changes a setting: from now on an unfinished day only reminds you. You can change it back under Your
        account.
      </Text>
      {fetcher.data && !fetcher.data.ok && (
        <Text size="xs" c="red" role="alert">
          {fetcher.data.error ?? "That didn't save. Try again when you're online."}
        </Text>
      )}
    </Stack>
  );
}
