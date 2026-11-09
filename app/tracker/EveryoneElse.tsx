import { Anchor, Badge, Card, Group, Stack, Text, Title, UnstyledButton } from "@mantine/core";
import { useEffect, useState } from "react";
import { Link, useRouteLoaderData } from "react-router";

import { SIGNED_OFF_STATUSES } from "../../src/entry-status.ts";
import { jobLabel } from "../../src/job-names.ts";
import type { OthersDayPerson } from "../../src/reports.ts";
import { formatClock, formatDurationHuman } from "../../src/time.ts";
import { Chevron } from "../components/chevron.tsx";
import { personColor } from "../components/person-color.ts";
import type { loader as appLoader } from "../routes/_app.tsx";
import { useNow, useTracker } from "./context.tsx";

/**
 * Everyone else's time on the day shown, under an admin's own: who is working,
 * on what, since when, and how much they have so far. Admins only, and only on
 * their own day — never while acting for someone.
 *
 * It's fetched on its own (GET /api/admin/day/:date), never part of the day
 * model, which is kept on the device: other people's time isn't. Offline it
 * says so instead of showing an old copy. See plans/everyone-else-today.md.
 */
export function EveryoneElse() {
  const app = useRouteLoaderData<typeof appLoader>("routes/_app");
  const { model, actingFor } = useTracker();
  if (app?.user.role !== "admin" || actingFor) return null;
  return <Panel date={model.workDate} today={model.today} timezone={model.timezone} />;
}

const REFRESH_MS = 60_000;
const OPEN_KEY = "tt.everyone-else.open";

interface Answer {
  workDate: string;
  people: OthersDayPerson[];
  /** This device's clock when the answer arrived, for counting running timers on. */
  receivedAt: number;
}

type Problem = "offline" | "failed" | null;

/** The day's answer from the server, kept fresh while the page is in view. */
function useOthersDay(date: string): { answer: Answer | null; problem: Problem } {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<Problem>(null);

  useEffect(() => {
    let controller: AbortController | null = null;
    let stopped = false;
    setProblem(null);

    async function load() {
      controller?.abort();
      const mine = new AbortController();
      controller = mine;
      try {
        const res = await fetch(`/api/admin/day/${date}`, {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
          signal: mine.signal,
        });
        // A proxy answering for an app that's down is as good as offline.
        if (res.status === 502 || res.status === 503 || res.status === 504) throw new TypeError("unreachable");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { workDate: string; people: OthersDayPerson[] };
        if (stopped || mine.signal.aborted) return;
        setAnswer({ workDate: body.workDate, people: body.people, receivedAt: Date.now() });
        setProblem(null);
      } catch (err) {
        if (stopped || mine.signal.aborted) return;
        setProblem(err instanceof TypeError || navigator.onLine === false ? "offline" : "failed");
      }
    }

    const visible = () => document.visibilityState === "visible";
    void load();
    const timer = setInterval(() => {
      if (visible()) void load();
    }, REFRESH_MS);
    const onVisible = () => {
      if (visible()) void load();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => {
      stopped = true;
      controller?.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("online", onVisible);
    };
  }, [date]);

  // An answer for another day doesn't belong on this one.
  return { answer: answer?.workDate === date ? answer : null, problem };
}

/** Whether the panel is open, remembered on this device. Open unless closed. */
function useOpen(): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem(OPEN_KEY) === "0") setOpen(false);
    } catch {
      // Storage blocked: it just stays open.
    }
  }, []);
  return [
    open,
    (next) => {
      setOpen(next);
      try {
        localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      } catch {
        // Not remembered, but still changed.
      }
    },
  ];
}

function Panel({ date, today, timezone }: { date: string; today: string; timezone: string }) {
  const { answer, problem } = useOthersDay(date);
  const [open, setOpen] = useOpen();
  const now = useNow(30_000);
  const isToday = date === today;

  const busy = answer?.people.filter((p) => p.lines.length > 0 || p.pendingNotes) ?? [];
  const idle = answer?.people.filter((p) => p.lines.length === 0 && !p.pendingNotes) ?? [];
  const working = busy.filter((p) => p.runningSince != null).length;
  const summary = !answer
    ? null
    : busy.length === 0
      ? "Nobody else has time yet"
      : `${busy.length} with time${isToday && working > 0 ? `, ${working} on the clock` : ""}`;

  return (
    <Stack gap="sm" component="section" aria-labelledby="everyone-else-title">
      <UnstyledButton onClick={() => setOpen(!open)} aria-expanded={open} aria-controls="everyone-else-body">
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Stack gap={0}>
            <Title order={3} id="everyone-else-title">
              Everyone else
            </Title>
            <Text size="xs" c="dimmed">
              {summary ?? (problem === "offline" ? "Needs a connection." : "Their time on this day.")}
            </Text>
          </Stack>
          {/* Right when closed, down when open. */}
          <span style={{ display: "inline-flex", transform: open ? "rotate(90deg)" : undefined, transition: "transform 150ms" }}>
            <Chevron towards="right" size={18} />
          </span>
        </Group>
      </UnstyledButton>

      {open && (
        <Stack gap="sm" id="everyone-else-body">
          {problem && (
            <Text size="sm" c="dimmed">
              {problem === "offline"
                ? answer
                  ? "Offline — this is how it looked when last loaded."
                  : "Other people's time isn't kept on this device; it shows when you're back online."
                : "Couldn't load everyone's time. It tries again every minute."}
            </Text>
          )}
          {busy.map((p) => (
            <PersonCard key={p.userId} person={p} answer={answer!} now={now} date={date} today={today} timezone={timezone} />
          ))}
          {idle.length > 0 && (
            <Text size="sm" c="dimmed">
              Nothing {isToday ? "yet" : "this day"}:{" "}
              {idle.map((p, i) => (
                <span key={p.userId}>
                  {i > 0 && ", "}
                  <Anchor component={Link} to={personDay(p.userId, date, today)} size="sm" c="dimmed" underline="always">
                    {p.name}
                  </Anchor>
                </span>
              ))}
            </Text>
          )}
        </Stack>
      )}
    </Stack>
  );
}

const personDay = (userId: number, date: string, today: string) =>
  `/admin/people/${userId}/time${date === today ? "" : `/${date}`}`;

/** Seconds counted on from when the answer arrived, for a timer still going. */
const live = (seconds: number, running: boolean, answer: Answer, now: number | undefined) =>
  running && now !== undefined ? seconds + Math.max(0, Math.round((now - answer.receivedAt) / 1000)) : seconds;

function PersonCard({
  person: p,
  answer,
  now,
  date,
  today,
  timezone,
}: {
  person: OthersDayPerson;
  answer: Answer;
  now: number | undefined;
  date: string;
  today: string;
  timezone: string;
}) {
  const color = personColor(p.userId);
  const running = p.runningSince != null;
  const status = p.approved
    ? "Approved"
    : p.submitted === "all"
      ? "Submitted"
      : p.submitted === "some"
        ? "Partly submitted"
        : null;

  return (
    <Card withBorder padding="sm" style={{ borderLeft: `4px solid var(--mantine-color-${color}-filled)` }}>
      <Stack gap={6}>
        <Group justify="space-between" align="baseline" wrap="nowrap">
          <Group gap="xs" wrap="wrap">
            <Anchor component={Link} to={personDay(p.userId, date, today)} fw={600} c="inherit">
              {p.name}
            </Anchor>
            {running && (
              <Badge size="sm" variant="light" color="green">
                On the clock
              </Badge>
            )}
            {status && (
              <Badge size="sm" variant="light" color={p.approved ? "teal" : "gray"}>
                {status}
              </Badge>
            )}
            {!p.active && (
              <Badge size="sm" variant="outline" color="gray">
                Deactivated
              </Badge>
            )}
          </Group>
          <Text fw={600} style={{ whiteSpace: "nowrap" }}>
            {formatDurationHuman(live(p.seconds, running, answer, now))}
          </Text>
        </Group>

        {p.lines.map((l) => {
          const going = l.runningSince != null;
          return (
            <Group key={l.entryId} justify="space-between" align="baseline" wrap="nowrap" gap="sm">
              <Stack gap={0} style={{ minWidth: 0 }}>
                <Text size="sm" truncate>
                  {jobLabel(l.jobName)}
                </Text>
                <Text size="xs" c="dimmed">
                  {lineTimes(l, timezone)}
                  {SIGNED_OFF_STATUSES.has(l.status) && p.submitted === "some" ? " · submitted" : ""}
                </Text>
              </Stack>
              <Text size="sm" style={{ whiteSpace: "nowrap" }}>
                {formatDurationHuman(live(l.seconds, going, answer, now))}
              </Text>
            </Group>
          );
        })}

        {p.pendingNotes && (
          <Text size="xs" c="dimmed">
            {p.pendingNotes.count === 1 ? "1 note" : `${p.pendingNotes.count} notes`} not yet hours · latest{" "}
            {formatClock(p.pendingNotes.lastAt, timezone)}
          </Text>
        )}
      </Stack>
    </Card>
  );
}

/** "7:30 AM – now", "7:30 AM – paused", "8:00 AM – 12:00 PM, plus 30m without times". */
function lineTimes(l: OthersDayPerson["lines"][number], timezone: string): string {
  if (l.startedAt == null) return "No start or end time";
  const paused = l.status === "open" && l.runningSince == null;
  const end = paused ? "paused" : l.runningSince != null || l.endedAt == null ? "now" : formatClock(l.endedAt, timezone);
  const span = `${formatClock(l.startedAt, timezone)} – ${end}`;
  return l.untimedSeconds > 0 ? `${span}, plus ${formatDurationHuman(l.untimedSeconds)} without times` : span;
}
