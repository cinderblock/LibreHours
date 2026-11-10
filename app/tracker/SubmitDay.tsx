import { Anchor, Button, Card, Group, Stack, Text } from "@mantine/core";
import { useState } from "react";
import { Link } from "react-router";

import { isOwnerReopenable } from "../../src/entry-status.ts";
import { formatWorkDate } from "../../src/time.ts";
import appear from "../components/appear.module.css";
import { NEEDS_YOU_TEXT, NeedsYouCallout, needsYou, toProblem } from "../components/needs-you.tsx";
import { useTracker } from "./context.tsx";
import { isPendingNote } from "./model.ts";

/**
 * Submitting a day: the person saying their time is done.
 *
 * This is the step that freezes each entry's rate, locks it, and — unless the
 * organisation requires approval — hands it to the accounting system. Nothing
 * else does it and nothing does it automatically, so this card also carries
 * the reminder about earlier days still waiting.
 *
 * Taking a day back is offered whenever it's the person's own submission to
 * withdraw. Once an admin has approved an entry it stays put, and the card
 * says who to ask.
 *
 * A day with notes not yet turned into hours asks first: submitting says the
 * day is done, and those notes would otherwise only be noticed later, as an
 * unfinished day. Turn them into hours, leave them out, or submit anyway.
 */
export function SubmitDay() {
  const { model, dispatch, dispatchAll, pending, actingFor, hrefFor } = useTracker();
  const stopped = model.entries.filter((e) => e.status !== "open");
  const unsubmitted = stopped.filter((e) => e.status === "draft");
  const mine = stopped.filter((e) => isOwnerReopenable(e.status, e.adminApproved));
  const approved = stopped.filter((e) => e.adminApproved);
  const running = model.entries.some((e) => e.status === "open");
  const who = actingFor ? actingFor.name : "you";
  // Jobs on this day with notes still to become hours; and earlier days, waiting
  // to be submitted, that have some.
  const jobsWithNotes = new Set(model.notes.filter(isPendingNote).map((n) => n.jobId)).size;
  const earlierWithNotes = (model.unsubmittedWithNotes ?? []).filter((d) => model.unsubmittedDays.includes(d));
  const [asking, setAsking] = useState<"day" | "earlier" | null>(null);
  // Written notes on this day that never made it into its hours.
  const loose = model.notes.filter((n) => isPendingNote(n) && n.kind === "note").length;
  // Not submitted on a day gone by: that's what's waiting on this day.
  const overdue = unsubmitted.length > 0 && model.workDate < model.today;

  // A day with nothing on it has nothing to say — except about other days.
  if (stopped.length === 0 && model.unsubmittedDays.length === 0) return null;

  const submitDay = () => {
    setAsking(null);
    void dispatch("day.submit", { workDate: model.workDate });
  };
  const takeBack = () => void dispatch("day.unsubmit", { workDate: model.workDate });
  const submitEarlier = () => {
    setAsking(null);
    void dispatchAll(model.unsubmittedDays.map((workDate) => ({ type: "day.submit" as const, payload: { workDate } })));
  };

  return (
    <Stack gap="sm">
      {stopped.length > 0 && (
        <Card withBorder padding="md" {...needsYou(overdue, "card", appear.appear)}>
          <Stack gap="xs">
            {unsubmitted.length > 0 ? (
              <>
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <Text fw={overdue ? 600 : 500} c={overdue ? NEEDS_YOU_TEXT : undefined}>
                    {unsubmitted.length} {unsubmitted.length === 1 ? "entry" : "entries"} not submitted
                  </Text>
                  <Button
                    onClick={jobsWithNotes > 0 ? () => setAsking("day") : submitDay}
                    loading={pending}
                    disabled={running || asking === "day"}
                  >
                    Submit this day
                  </Button>
                </Group>
                {asking === "day" && (
                  <NeedsYouCallout
                    title="Some notes aren't in the hours yet"
                    className={appear.appear}
                    actions={
                      <>
                        <Button size="sm" variant="default" onClick={() => setAsking(null)}>
                          Not yet
                        </Button>
                        <Button size="sm" variant="subtle" color="gray" onClick={submitDay}>
                          Submit anyway
                        </Button>
                      </>
                    }
                  >
                    {jobsWithNotes === 1 ? "A job" : `${jobsWithNotes} jobs`} on this day still{" "}
                    {jobsWithNotes === 1 ? "has" : "have"} notes not in the hours. Turn them into hours, or leave them
                    out if their time was billed some other way. Submitting without them leaves them waiting.
                  </NeedsYouCallout>
                )}
                <Text size="sm" c="dimmed">
                  {running
                    ? "Stop the timer first — a running timer can't be submitted."
                    : model.requireApproval
                      ? "Submitting locks this time and sends it for approval. You can take it back until an admin approves it."
                      : model.sendsToAccounting
                        ? "Submitting locks this time and sends it to accounting. You can take it back if you need to fix something."
                        : "Submitting locks this time. You can take it back if you need to fix something."}
                </Text>
              </>
            ) : (
              <>
                <Group justify="space-between" wrap="wrap" gap="sm">
                  <Text fw={500}>
                    {approved.length > 0 ? "Approved" : "Submitted"} — {stopped.length}{" "}
                    {stopped.length === 1 ? "entry" : "entries"}
                  </Text>
                  {mine.length > 0 && (
                    <Button variant="default" onClick={takeBack} loading={pending}>
                      Take the day back
                    </Button>
                  )}
                </Group>
                <Text size="sm" c="dimmed">
                  {mine.length === 0
                    ? `An admin has approved this day, so it can't be changed here. Ask them to reopen it if ${who === "you" ? "you need" : `${who} needs`} to fix something.`
                    : loose > 0
                      ? `${loose === 1 ? "A note" : `${loose} notes`} on this day ${loose === 1 ? "isn't" : "aren't"} in the hours (see Notes). Take the day back to add ${loose === 1 ? "it" : "them"}, then submit it again.`
                      : "This day is done. Take it back to change anything, then submit it again."}
                </Text>
              </>
            )}
          </Stack>
        </Card>
      )}

      {model.unsubmittedDays.length > 0 && (
        <NeedsYouCallout
          className={appear.appear}
          title={`${model.unsubmittedDays.length} earlier ${model.unsubmittedDays.length === 1 ? "day" : "days"} not submitted`}
        >
          <Stack gap="xs">
            <Text size="sm">
              {model.unsubmittedDays.slice(0, 5).map((date, i) => (
                <span key={date}>
                  {i > 0 && ", "}
                  <Anchor component={Link} to={toProblem(hrefFor(date))} size="sm">
                    {formatWorkDate(date)}
                  </Anchor>
                </span>
              ))}
              {model.unsubmittedDays.length > 5 && ` and ${model.unsubmittedDays.length - 5} more`}.
            </Text>
            <Group gap="sm">
              <Button
                size="sm"
                variant={asking === "earlier" ? "subtle" : "filled"}
                color={asking === "earlier" ? "gray" : undefined}
                onClick={earlierWithNotes.length > 0 && asking !== "earlier" ? () => setAsking("earlier") : submitEarlier}
                loading={pending}
              >
                {asking === "earlier"
                  ? "Submit anyway"
                  : model.unsubmittedDays.length === 1
                    ? `Submit ${formatWorkDate(model.unsubmittedDays[0]!)}`
                    : `Submit all ${model.unsubmittedDays.length}`}
              </Button>
              {asking === "earlier" && (
                <Button size="sm" variant="default" onClick={() => setAsking(null)}>
                  Not yet
                </Button>
              )}
            </Group>
            {asking === "earlier" && (
              <Text size="sm">
                Notes on{" "}
                {earlierWithNotes.map((date, i) => (
                  <span key={date}>
                    {i > 0 && ", "}
                    <Anchor component={Link} to={toProblem(hrefFor(date))} size="sm">
                      {formatWorkDate(date)}
                    </Anchor>
                  </span>
                ))}{" "}
                aren't hours yet. Turn them into hours or leave them out first, or submit anyway.
              </Text>
            )}
          </Stack>
        </NeedsYouCallout>
      )}
    </Stack>
  );
}
