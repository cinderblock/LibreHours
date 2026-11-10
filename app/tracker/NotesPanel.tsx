import {
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Modal,
  Stack,
  Text,
  TextInput,
  Textarea,
  Title,
  UnstyledButton,
} from "@mantine/core";
import { TimeInput } from "@mantine/dates";
import { useMediaQuery } from "@mantine/hooks";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useFetcher } from "react-router";

import { jobLabel, jobPath } from "../../src/job-names.ts";
import { NOTE_MAX_LENGTH } from "../../src/limits.ts";
import { joinNotes, proposeRollup, rollupProblems } from "../../src/rollup.ts";
import {
  formatClock,
  formatDurationHuman,
  formatDurationInput,
  formatWorkDate,
  parseDuration,
  zonedTimeInput,
} from "../../src/time.ts";
import { uuidv7 } from "../../src/uuid.ts";
import { SIGNED_OFF_STATUSES, isEditable, isOwnerReopenable } from "../../src/entry-status.ts";
import { DurationInput } from "../components/duration-input.tsx";
import { lineOf } from "../offline/reducer.ts";
import { useTracker, useUndoToast } from "./context.tsx";
import { useFlight, whereItIs } from "./flight.tsx";
import { JobSelect, RecentJobButtons } from "./JobPicker.tsx";
import { type NoteView, isPendingNote, pendingNotesNeedYou } from "./model.ts";
import { latestTimeOn, noteTimeOn } from "./note-time.ts";
import { SEND_AFTER_MS, useSendWhenLeft } from "./send-when-left.ts";
import { useTrackerDraft } from "./tracker-draft.ts";
import appear from "../components/appear.module.css";
import { NEEDS_YOU, NEEDS_YOU_TEXT, NeedsYouCallout, needsYou, toProblem } from "../components/needs-you.tsx";
import classes from "./notes.module.css";

/**
 * Notes mode, by job. Adding a job to the day marks being on it from that
 * moment; notes then go under that job as the work happens. At the end of
 * the day each job's notes are turned into hours — one entry per job, its
 * notes as the description. A past day can be written up afterwards the same
 * way, each note saying when. By default a day's notes must all be hours
 * before the next day can start; a person can turn that hold off (it's offered
 * in the alert itself), and then an unfinished day is still called out, but
 * doesn't block.
 *
 * In timer mode the panel only shows a day's leftover notes (from before a
 * switch), so they can still be turned into hours.
 *
 * Notes that won't become hours — billed some other way, or not work — can be
 * left out instead: settled, kept as a record, and no longer waited on. A
 * submitted day takes no new notes or hours until it's taken back, but its
 * leftover notes can still be left out, since that changes no time.
 */
export function NotesPanel() {
  const { model, hrefFor, actingFor } = useTracker();
  const isToday = model.workDate === model.today;
  const notesMode = model.mode === "notes";
  // Today, or a day gone by being written up; never a day still to come.
  const writable = notesMode && model.workDate <= model.today;
  // An earlier day's notes come first. With the hold on, this day takes none
  // until they're hours; with it off, it's called out but doesn't wait.
  const unfinished = writable ? (model.notesToRollUp ?? null) : null;
  const heldBy = unfinished && model.notesHold ? unfinished : null;
  // A submitted day is done: new notes or hours wait until it's taken back.
  const submitted = model.entries.length > 0 && model.entries.every((e) => SIGNED_OFF_STATUSES.has(e.status));
  const canAdd = writable && !heldBy && !submitted;
  const thisDay = isToday ? "today" : formatWorkDate(model.workDate);
  const sections = useMemo(() => groupByJob(model.notes), [model.notes]);
  // Notes not hours on a day gone by, or a submitted one: marked where they are.
  const notesNeedYou = pendingNotesNeedYou(model);
  // The section whose note box should take the cursor next.
  const [focusJob, setFocusJob] = useState<string | null>(null);
  const clearFocus = useCallback(() => setFocusJob(null), []);

  if (!notesMode && model.notes.length === 0) return null;

  return (
    <Stack gap="sm">
      <Title order={3}>Notes</Title>
      {heldBy && (
        <NeedsYouCallout
          title={`${formatWorkDate(heldBy.date)} isn't finished`}
          actions={
            <>
              <Button component={Link} to={toProblem(hrefFor(heldBy.date))} size="sm">
                Go to {formatWorkDate(heldBy.date)}
              </Button>
              {/* The setting is the person's own; an admin acting for them can't change it here. */}
              {!actingFor && <StartAnyway />}
            </>
          }
        >
          {heldBy.count === 1 ? "A note there isn't" : `${heldBy.count} notes there aren't`} in the hours yet. Sort{" "}
          {heldBy.count === 1 ? "it" : "them"} out there before {isToday ? "today's notes" : `notes on ${thisDay}`} start.
        </NeedsYouCallout>
      )}
      {/* Not holding anything back doesn't make it less unfinished: still the
          warning, just without the wall. */}
      {unfinished && !heldBy && (
        <NeedsYouCallout
          title={`${formatWorkDate(unfinished.date)} isn't finished`}
          actions={
            <Button component={Link} to={toProblem(hrefFor(unfinished.date))} size="sm">
              Go to {formatWorkDate(unfinished.date)}
            </Button>
          }
        >
          {unfinished.count === 1 ? "A note there isn't" : `${unfinished.count} notes there aren't`} in the hours yet.{" "}
          {isToday ? "Today's notes" : "This day's notes"} don't have to wait for it.
        </NeedsYouCallout>
      )}
      {/* Said by the marked card instead, when a note here is what's left. */}
      {submitted && writable && !sections.some((s) => s.pending.length > 0) && (
        <Text c="dimmed" size="sm">
          This day is submitted. Take it back to add notes or turn them into hours.
        </Text>
      )}
      {canAdd && <AddJob sections={sections} onAdded={setFocusJob} />}
      {sections.length === 0
        ? !heldBy && (
            <Text c="dimmed" size="sm">
              {model.partial
                ? "Notes for this day aren't on this device."
                : canAdd
                  ? isToday
                    ? "Add the job you're on, then jot what you do as you go. At the end of the day, turn each job's notes into hours."
                    : "Write this day up: add each job you were on and when you started it, then what you did and when. Then turn each job's notes into hours."
                  : "No notes on this day."}
            </Text>
          )
        : sections.map((s) => (
            <JobSection
              key={s.key}
              section={s}
              canAdd={canAdd}
              canTurn={!submitted}
              problem={notesNeedYou && s.pending.length > 0}
              focused={focusJob != null && focusJob === s.jobId}
              onFocused={clearFocus}
            />
          ))}
    </Stack>
  );
}

/**
 * Turn the hold off from where it bites: today starts now, and from here on an
 * unfinished day is a reminder rather than a wall. The Account page has the
 * same switch, to turn it back on.
 */
function StartAnyway() {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const busy = fetcher.state !== "idle";
  return (
    <Stack gap={2} align="flex-start">
      <Button
        size="sm"
        variant="default"
        loading={busy}
        onClick={() => fetcher.submit({ intent: "notes-hold", hold: "0" }, { method: "post", action: "/account" })}
      >
        Let new days start anyway
      </Button>
      <Text size="xs" c="dimmed">
        From now on an unfinished day only reminds you. Turn it back on under Your account.
      </Text>
      {fetcher.data && !fetcher.data.ok && (
        <Text size="xs" c="red" role="alert">
          {fetcher.data.error ?? "That didn't save. Try again when you're online."}
        </Text>
      )}
    </Stack>
  );
}

interface Section {
  key: string;
  jobId: string | null;
  jobName: string | null;
  /** In time order; the first is usually the start marker. */
  notes: NoteView[];
  startedAt: number;
  pending: NoteView[];
  /** Left out of the hours by the person; can be brought back. */
  leftOut: NoteView[];
}

/** The day's notes by job, sections in the order the jobs were started. */
function groupByJob(notes: readonly NoteView[]): Section[] {
  const byJob = new Map<string | null, NoteView[]>();
  for (const n of notes) {
    const list = byJob.get(n.jobId) ?? [];
    list.push(n);
    byJob.set(n.jobId, list);
  }
  return [...byJob.entries()]
    .map(([jobId, list]) => ({
      key: jobId ?? "none",
      jobId,
      jobName: list[0]!.jobName,
      notes: list,
      startedAt: list[0]!.at,
      pending: list.filter(isPendingNote),
      leftOut: list.filter((n) => n.settled === "left_out"),
    }))
    .sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Pick a job to be on from now. One already on the day just takes the cursor.
 *
 * Writing up an earlier day, a tap starts the job where the day's notes leave
 * off — its start can be re-timed after, like any note. A day with no notes
 * yet has nothing to go on, so the job's card opens asking when it started.
 */
function AddJob({ sections, onAdded }: { sections: Section[]; onAdded: (jobId: string) => void }) {
  const { model, dispatch, location, pending } = useTracker();
  const isToday = model.workDate === model.today;
  const [value, setValue] = useState<string | null>(null);
  // A job picked on an empty earlier day, waiting for its time.
  const [waiting, setWaiting, dropWaiting] = useTrackerDraft<string | null>(
    isToday ? null : `start-waiting:${model.workDate}`,
    null,
  );

  async function start(jobId: string, at: number) {
    const result = await dispatch("note.create", {
      noteId: uuidv7(),
      at,
      kind: "start",
      jobId,
      // Where the device is now says nothing about where an earlier day was.
      location: isToday ? location() : null,
    });
    if (result.ok) onAdded(jobId);
    return result.ok;
  }

  function pick(jobId: string | null) {
    setValue(null);
    if (!jobId) return;
    if (sections.some((s) => s.jobId === jobId)) {
      onAdded(jobId);
      return;
    }
    if (isToday) {
      void start(jobId, Date.now());
      return;
    }
    // The day's latest note to the millisecond: the start sorts after it (a
    // new id is the later one on a tie), where a typed minute could fall
    // just before it and cut that note's run short.
    if (model.notes.length === 0) {
      setWaiting(jobId);
      return;
    }
    void start(jobId, Math.max(...model.notes.map((n) => n.at)));
  }

  // The buttons are the fast way onto a job you've been on lately — the same
  // one tap that starts a timer. One already on the day is still worth a
  // button: tapping it is how you say you're back on it.
  return (
    <Stack gap="xs">
      <RecentJobButtons onPick={(job) => pick(job.id)} disabled={pending} />
      <JobSelect
        value={value}
        onChange={pick}
        placeholder={isToday ? "Add a job for today — type to search" : "Add a job you were on — type to search"}
      />
      {waiting && model.notes.length === 0 && (
        <WhenStarted
          key={waiting}
          jobId={waiting}
          onStart={async (at) => {
            if (await start(waiting, at)) dropWaiting();
          }}
          onCancel={dropWaiting}
        />
      )}
    </Stack>
  );
}

/**
 * A job picked on an earlier day with nothing written on it yet: its card,
 * asking when it began. The hours are worked out from that, so it isn't
 * guessed.
 */
function WhenStarted({
  jobId,
  onStart,
  onCancel,
}: {
  jobId: string;
  onStart: (at: number) => Promise<void>;
  onCancel: () => void;
}) {
  const { model, pending } = useTracker();
  const name = model.jobs.find((j) => j.id === jobId)?.fullName ?? "Unknown job";
  const { name: title, above: place } = jobPath(name);
  const [time, setTime] = useTrackerDraft(`start-waiting-at:${model.workDate}:${jobId}`, "");
  const [problem, setProblem] = useState<string | null>(null);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const when = noteTimeOn(model.workDate, time, model.timezone, Date.now());
    if (!when.ok) {
      setProblem(when.problem);
      return;
    }
    void onStart(when.at);
  }

  return (
    <Card withBorder padding="sm" role="group" aria-label={jobLabel(name)} className={appear.appear}>
      <form onSubmit={submit}>
        <Stack gap="xs">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600}>{title}</Text>
            {place && (
              <Text size="xs" c="dimmed">
                {place}
              </Text>
            )}
          </Stack>
          <Group gap="xs" align="end" wrap="nowrap">
            <TimeInput
              label="Started at"
              value={time}
              onChange={(e) => {
                setTime(e.currentTarget.value);
                setProblem(null);
              }}
              error={problem}
              data-draft
              autoFocus
              w={130}
            />
            <Button type="submit" disabled={pending}>
              Start
            </Button>
            <Button variant="default" onClick={onCancel}>
              Cancel
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

function JobSection({
  section,
  canAdd,
  canTurn,
  problem,
  focused,
  onFocused,
}: {
  section: Section;
  canAdd: boolean;
  /** Its notes can become hours here: not while the day is submitted. */
  canTurn: boolean;
  /** Its notes not yet hours are waiting on the person: marked, and said what to do. */
  problem: boolean;
  focused: boolean;
  onFocused: () => void;
}) {
  const { model, dispatch, pending: busy } = useTracker();
  const undoToast = useUndoToast();
  // Open or not survives a reload, with what was typed in it (HoursDialog).
  const [hours, setHours] = useTrackerDraft(section.jobId ? `hours-open:${model.workDate}:${section.jobId}` : null, false);
  // Where this job's hours fly from when its notes become time.
  const card = useRef<HTMLDivElement>(null);
  const name = section.jobId ? (section.jobName ?? "Unknown job") : null;
  const { name: title, above: place } = jobPath(name ?? "");
  // The note box's text lives here, not in the box: turning the notes into
  // hours takes a note still typed in it along (one was once left behind).
  const box = useNoteBox(canAdd ? section.jobId : null, section.notes);
  const unsent = box.text.trim() !== "";
  const written = section.pending.filter((n) => n.kind === "note").length + (unsent ? 1 : 0);

  async function leaveOut() {
    const result = await dispatch("notes.leave_out", { noteIds: section.pending.map((n) => n.id), at: Date.now() });
    if (result.ok) undoToast(section.pending.length === 1 ? "Note left out." : "Notes left out.");
  }

  // A loose note whose words were typed into the job's hours by hand (how
  // the first one of these came about): the hours already say it.
  const line = section.jobId ? model.entries.find((e) => e.jobId === section.jobId) : undefined;
  const wordsAlreadyThere =
    line?.note != null &&
    section.pending.some((n) => n.kind === "note") &&
    section.pending.every((n) => n.kind !== "note" || squash(line.note!).includes(squash(n.text)));
  // A submitted day: taking it back is how a note joins its hours.
  const reopenable = model.entries.some((e) => isOwnerReopenable(e.status, e.adminApproved));
  const takeBack = () => dispatch("day.unsubmit", { workDate: model.workDate });
  // The hold is what keeps the next day shut; say so where it's being fixed.
  const heldHere = model.mode === "notes" && model.notesHold && model.workDate < model.today;

  async function bringBack() {
    await dispatch("notes.bring_back", { noteIds: section.leftOut.map((n) => n.id), at: Date.now() });
  }

  return (
    <Card
      ref={card}
      withBorder
      padding="sm"
      role="group"
      aria-label={name ? jobLabel(name) : "No job yet"}
      {...needsYou(problem, "card", appear.appear)}
    >
      <Stack gap="xs">
        <Group justify="space-between" align="start" wrap="nowrap">
          <Stack gap={0} style={{ minWidth: 0 }}>
            <Text fw={600}>{name ? title : "No job yet"}</Text>
            {place && (
              <Text size="xs" c="dimmed">
                {place}
              </Text>
            )}
          </Stack>
          <Text size="xs" c="dimmed" style={{ whiteSpace: "nowrap" }}>
            since {formatClock(section.startedAt, model.timezone)}
          </Text>
        </Group>

        {problem && (
          <Text size="sm">
            <Text span inherit fw={600} c={NEEDS_YOU_TEXT}>
              {section.pending.filter((n) => n.kind === "note").length === 1
                ? "A note here isn't in the hours."
                : section.pending.some((n) => n.kind === "note")
                  ? `${section.pending.filter((n) => n.kind === "note").length} notes here aren't in the hours.`
                  : "This job's time isn't in the hours."}
            </Text>{" "}
            {wordsAlreadyThere &&
              `Its words are already in ${title}'s hours, typed there by hand, so leaving it out only tidies up. `}
            {!section.jobId
              ? "Give it a job, then turn it into hours or leave it out."
              : canTurn
                ? "Turn it into hours, or leave it out if it was billed some other way."
                : reopenable
                  ? "Take the day back to add it to the hours, or leave it out if it was billed some other way."
                  : "Leave it out if it was billed some other way, or ask an admin to reopen the day."}
            {heldHere && " The next day opens once it's done."}
          </Text>
        )}

        {section.notes.map((n) => (
          <NoteRow key={n.id} note={n} problem={problem && isPendingNote(n)} />
        ))}

        {section.jobId ? (
          canAdd && (
            <NoteBox jobName={name!} box={box} paused={hours} autoFocus={focused} onFocused={onFocused} />
          )
        ) : (
          !problem && (
            <Text size="sm" c="dimmed">
              Give these notes a job (edit each one) to turn them into hours.
            </Text>
          )
        )}

        {(section.pending.length > 0 || unsent) && (
          <Group>
            {section.jobId && canTurn && (
              // The way out of the problem is the main action on a marked card.
              <Button size="sm" variant={problem ? "filled" : "light"} onClick={() => setHours(true)}>
                {written > 0 ? `Turn ${written} note${written === 1 ? "" : "s"} into hours` : "Turn into hours"}
              </Button>
            )}
            {problem && !canTurn && reopenable && (
              <Button size="sm" onClick={() => void takeBack()} disabled={busy}>
                Take the day back
              </Button>
            )}
            {/* Time billed some other way, or that wasn't work: settled without hours. */}
            {section.pending.length > 0 && (
              <Button size="sm" variant="subtle" color="gray" onClick={() => void leaveOut()} disabled={busy}>
                Leave out
              </Button>
            )}
          </Group>
        )}
        {section.leftOut.length > 0 && (
          <Group>
            <Button size="compact-sm" variant="subtle" color="gray" onClick={() => void bringBack()} disabled={busy}>
              Bring back
            </Button>
          </Group>
        )}
        {section.jobId && (
          <HoursDialog
            opened={hours}
            onClose={() => setHours(false)}
            jobId={section.jobId}
            jobName={name!}
            pending={section.pending}
            unsent={canAdd ? box : null}
            from={card}
          />
        )}
      </Stack>
    </Card>
  );
}

type NoteBoxState = ReturnType<typeof useNoteBox>;

/** Text compared loosely: case, spacing and punctuation aside. */
const squash = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Stands in for a note still typed in its box, until it's added. */
const UNSENT_ID = "unsent";

/**
 * One job's note box: what's typed, and, writing up an earlier day, when it
 * happened. Kept on the device as it's typed, so an update or a crash puts it
 * back. `jobId` null keeps nothing (the card has no box).
 */
function useNoteBox(jobId: string | null, notes: readonly NoteView[]) {
  const { model, dispatch, location } = useTracker();
  const isToday = model.workDate === model.today;
  const [text, setText] = useTrackerDraft(jobId ? `note-box:${model.workDate}:${jobId}` : null, "");
  // Writing up an earlier day, each note says when. Untouched, the time follows
  // this job's latest note — not the day's: a note after another job's start
  // would mean being back on this one, and reshape both jobs' hours.
  const [time, setTime] = useTrackerDraft<string | null>(
    jobId && !isToday ? `note-box-at:${model.workDate}:${jobId}` : null,
    null,
  );
  const shownTime = time ?? latestTimeOn(notes, model.timezone);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** When a note written at `now` is stamped: `now` today; the box's time on an earlier day. */
  function whenFor(now: number): ReturnType<typeof noteTimeOn> {
    return isToday ? { ok: true, at: now } : noteTimeOn(model.workDate, shownTime, model.timezone, now);
  }

  /**
   * Add what's typed as a note written at `now` (Add pressed, or the box left).
   * Its id, or null when there was nothing to add or it wasn't taken — the
   * reason is then in `problem`.
   */
  async function add(now: number): Promise<string | null> {
    const written = text.trim();
    if (!written || !jobId) return null;
    const when = whenFor(now);
    if (!when.ok) {
      setProblem(when.problem);
      return null;
    }
    setProblem(null);
    // Empty the field now rather than when the dispatch answers. The note is
    // already in the list by then — the outbox takes it whether or not there
    // is a connection — and someone jotting a day's work types the next one
    // straight away. Clearing late wipes what they typed in between, and
    // leaves Add disabled over a field with words still in it.
    setText("");
    setBusy(true);
    const noteId = uuidv7();
    const result = await dispatch("note.create", {
      noteId,
      at: when.at,
      text: written,
      jobId,
      // Where the device is now says nothing about where an earlier day was.
      location: isToday ? location() : null,
    });
    setBusy(false);
    // Hand it back if it was refused — but not over a note begun since, which
    // would be the same mistake pointing the other way.
    if (!result.ok) {
      setText((current) => (current === "" ? written : current));
      return null;
    }
    // The time typed stays for the next note: writing a day up, the next one
    // is usually a little later, and that's the person's to say.
    return noteId;
  }

  return { text, setText, shownTime, setTime, problem, setProblem, busy, whenFor, add };
}

/**
 * A note for one job, written as the work happens — or, writing up an earlier
 * day, with the time it happened.
 */
function NoteBox({
  jobName,
  box,
  paused,
  autoFocus,
  onFocused,
}: {
  jobName: string;
  box: NoteBoxState;
  /** The job's hours dialog is open: it takes what's typed along itself. */
  paused: boolean;
  autoFocus: boolean;
  onFocused: () => void;
}) {
  const { model } = useTracker();
  const isToday = model.workDate === model.today;
  const { text, setText, shownTime, setTime, problem, setProblem, busy, add } = box;
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!autoFocus) return;
    ref.current?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  // Typed and never added: it goes by itself a little after the box is left —
  // but not while the hours dialog that will add it is open.
  const { secondsLeft, keepWriting, boxProps } = useSendWhenLeft(
    text.trim() !== "" && !paused,
    (leftAt) => void add(leftAt),
    ref,
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    void add(Date.now());
  }

  return (
    <form onSubmit={submit} {...boxProps}>
      <Group gap="xs" align="start" wrap="nowrap">
        {!isToday && (
          <TimeInput
            aria-label={`Time of the note for ${jobLabel(jobName)}`}
            value={shownTime}
            onChange={(e) => {
              setTime(e.currentTarget.value);
              setProblem(null);
            }}
            error={problem}
            data-draft
            w={130}
          />
        )}
        <TextInput
          ref={ref}
          placeholder="What did you do?"
          aria-label={`Note for ${jobLabel(jobName)}`}
          data-draft
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          maxLength={NOTE_MAX_LENGTH}
          style={{ flex: 1 }}
        />
        <Button type="submit" loading={busy} disabled={!text.trim()}>
          Add
        </Button>
      </Group>
      {/* Said up front, beside Add, so a note going by itself is never a surprise. */}
      {text.trim() !== "" && secondsLeft === null && (
        <Text size="xs" className={classes.autoAdd}>
          Not added yet — it adds itself {SEND_AFTER_MS / 1000} s after you leave this box.
        </Text>
      )}
      {secondsLeft !== null && (
        <Text size="xs" className={classes.autoAdd} data-waiting role="status">
          Adding this note in {secondsLeft} s.{" "}
          <Anchor
            component="button"
            type="button"
            size="xs"
            // Focus landing on this link would already call it off and take
            // the link away before its click arrives: go straight to the field.
            onMouseDown={(e) => e.preventDefault()}
            onClick={keepWriting}
          >
            Keep writing
          </Anchor>
        </Text>
      )}
    </form>
  );
}

/**
 * One line of the day. A note that hasn't become hours yet opens for editing
 * from anywhere on its row — the whole row is the tap target, as an entry's
 * is — with a pencil to say so: drawn on a touch device, where there is no
 * other clue, and faded in on hover where there's a mouse. A job's start
 * opens the same way, for its time or its job — it has no words to change.
 * A rolled-up note is just a record.
 */
function NoteRow({ note, problem }: { note: NoteView; /** Not hours, and waiting on the person. */ problem: boolean }) {
  const { model, dispatch, pending } = useTracker();
  const undoToast = useUndoToast();
  // Part of an entry, or settled without one: a record either way.
  const rolled = !isPendingNote(note);
  // An edit under way is kept on the device — open, with what's been typed —
  // so an update or a crash brings it back as it was.
  const [edit, setEdit, discardEdit] = useTrackerDraft<{ text: string; jobId: string | null; time?: string } | null>(
    rolled ? null : `note-edit:${note.id}`,
    null,
  );
  const editing = edit != null;
  const noteTime = zonedTimeInput(note.at, model.timezone);
  const text = edit ? edit.text : note.text;
  const jobId = edit ? edit.jobId : note.jobId;
  const time = edit?.time ?? noteTime;
  const setEditing = (open: boolean) => (open ? setEdit({ text: note.text, jobId: note.jobId }) : discardEdit());
  const setText = (value: string) => setEdit((e) => ({ ...e, text: value, jobId: e ? e.jobId : note.jobId }));
  const setJobId = (value: string | null) => setEdit((e) => ({ ...e, text: e ? e.text : note.text, jobId: value }));
  const setTime = (value: string) =>
    setEdit((e) => ({ text: e ? e.text : note.text, jobId: e ? e.jobId : note.jobId, time: value }));
  const start = note.kind === "start";
  // Untouched, the time stays to the second; typed, it's that minute on the
  // note's own day, and not later than now.
  const retimed = time === noteTime ? null : noteTimeOn(model.workDate, time, model.timezone, Date.now());

  async function save() {
    if (retimed && !retimed.ok) return;
    const result = await dispatch("note.update", {
      noteId: note.id,
      text: text.trim() !== note.text ? text.trim() : undefined,
      jobId: jobId !== note.jobId ? jobId : undefined,
      at: retimed?.ok ? retimed.at : undefined,
    });
    if (result.ok) setEditing(false);
  }

  async function remove() {
    const result = await dispatch("note.delete", { noteId: note.id, at: Date.now() });
    if (result.ok) {
      undoToast(start ? "Start removed." : "Note deleted.");
    }
  }

  if (editing) {
    return (
      <Card withBorder padding="sm">
        <Stack gap="xs">
          {!start && (
            <Textarea
              value={text}
              onChange={(e) => setText(e.currentTarget.value)}
              maxLength={NOTE_MAX_LENGTH}
              autosize
              aria-label="Note text"
              data-draft
            />
          )}
          <Group gap="xs" align="start" wrap="nowrap">
            <TimeInput
              aria-label={start ? "Started at" : "Time of the note"}
              value={time}
              onChange={(e) => setTime(e.currentTarget.value)}
              error={retimed && !retimed.ok ? retimed.problem : null}
              data-draft
              w={130}
            />
            <div style={{ flex: 1, minWidth: 0 }}>
              <JobSelect value={jobId} onChange={setJobId} placeholder="Job" required />
            </div>
          </Group>
          <Group justify="space-between">
            <Button variant="subtle" color="gray" size="xs" onClick={() => void remove()} disabled={pending}>
              {start ? "Remove" : "Delete"}
            </Button>
            <Group gap="xs">
              <Button variant="default" size="xs" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <Button
                size="xs"
                onClick={() => void save()}
                disabled={(!start && !text.trim()) || (retimed != null && !retimed.ok) || pending}
              >
                Save
              </Button>
            </Group>
          </Group>
        </Stack>
      </Card>
    );
  }

  const when = (
    <Text size="sm" c="dimmed" style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
      {formatClock(note.at, model.timezone)}
    </Text>
  );
  // `overflowWrap` so one long unbroken word shrinks with the row rather than
  // pushing the action off the end of it.
  // Where the note stands, said at the end of its text, flowing with it like
  // a word: on a narrow screen it drops to the next line rather than
  // squeezing the note into a column one word wide.
  const status = rolled
    ? { color: "gray", label: note.settled === "kept_in_accounting" ? "kept in accounting" : note.settled === "left_out" ? "left out" : "in the hours" }
    : problem && note.kind === "note"
      ? { color: NEEDS_YOU, label: "not in the hours" }
      : null;
  const what = (
    <Text size="sm" style={{ minWidth: 0, overflowWrap: "anywhere" }}>
      <Text span inherit c={start ? "dimmed" : undefined} fs={start ? "italic" : undefined}>
        {start ? "Started" : note.text}
      </Text>
      {status && (
        <>
          {" "}
          <Badge component="span" size="sm" variant="light" color={status.color} className={classes.status}>
            {status.label}
          </Badge>
        </>
      )}
    </Text>
  );

  return (
    <Group
      {...needsYou(problem, "row", `${classes.row} ${appear.appear}`)}
      justify="space-between"
      wrap="nowrap"
      align="start"
      opacity={rolled ? 0.6 : 1}
    >
      {rolled ? (
        <Group gap="xs" wrap="nowrap" align="start" style={{ minWidth: 0 }}>
          {when}
          {what}
        </Group>
      ) : (
        <UnstyledButton
          className={classes.opener}
          onClick={() => setEditing(true)}
          aria-label={start ? "Edit the start" : `Edit ${note.text}`}
          style={{ flex: 1, minWidth: 0 }}
        >
          <Group gap="xs" wrap="nowrap" align="start">
            {when}
            {what}
            <PencilIcon />
          </Group>
        </UnstyledButton>
      )}
    </Group>
  );
}

/**
 * The hint that a note opens for editing, drawn here rather than taking on an
 * icon set for one glyph. Decorative: the row around it carries the label.
 */
function PencilIcon() {
  return (
    <svg
      className={classes.pencil}
      viewBox="0 0 24 24"
      width="16"
      height="16"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M3 21l1-4L16 5l3 3L7 20l-4 1z" />
      <path d="M14 7l3 3" />
    </svg>
  );
}

/**
 * Turn one job's pending notes into hours: the timeline over the whole day
 * suggests them (this job's runs, each until the next note of another job),
 * the person confirms or changes them, and one duration entry is made with
 * the notes as its description. When the job already has hours that day the
 * notes join them — one line per job per day — and what's asked is the new
 * total; leaving it as it was attaches the notes to hours already counted.
 */
function HoursDialog({
  opened,
  onClose,
  jobId,
  jobName,
  pending,
  unsent: box,
  from,
}: {
  opened: boolean;
  onClose: () => void;
  jobId: string;
  jobName: string;
  pending: NoteView[];
  /**
   * The job's note box, when it has one. A note still typed in it, not yet
   * added, is added and goes into the hours with the rest — it used to be left
   * behind, a loose note keeping the day "unfinished" after it was submitted.
   */
  unsent: NoteBoxState | null;
  /** The job's card: where its hours are seen to leave from. */
  from: React.RefObject<HTMLDivElement | null>;
}) {
  const { model, dispatch } = useTracker();
  const { flyToEntry } = useFlight();
  const narrow = useMediaQuery("(max-width: 36em)");
  const tz = model.timezone;
  const date = model.workDate;
  const isToday = date === model.today;
  const { name: title } = jobPath(jobName);
  // When the dialog opened: where today's last run is taken to end.
  const [openedAt, setOpenedAt] = useState(0);
  // What the person typed over the suggestions, kept on the device so an
  // update or a crash brings the dialog back as it was. Untyped, each field
  // follows its suggestion.
  const [draft, setDraft, discardDraft] = useTrackerDraft<{ duration?: string; note?: string } | null>(
    `hours:${date}:${jobId}`,
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // A note still typed in the job's box, as the note it's about to become:
  // written now today, or at the box's time on an earlier day.
  const unsentText = box?.text.trim() ?? "";
  const unsentWhen = unsentText && box ? box.whenFor(openedAt || Date.now()) : null;
  const unsentNote: NoteView | null =
    unsentWhen?.ok === true
      ? {
          id: UNSENT_ID,
          at: unsentWhen.at,
          kind: "note",
          text: unsentText,
          jobId,
          jobName,
          rolledIntoEntryId: null,
          settled: null,
        }
      : null;
  const dayNotes = unsentNote ? [...model.notes, unsentNote] : model.notes;
  const withUnsent = unsentNote ? [...pending, unsentNote] : pending;

  const lastAt = dayNotes.length ? Math.max(...dayNotes.map((n) => n.at)) : 0;

  // Fresh each time it opens — and only then. Read through refs: the model is
  // rebuilt on every data refresh, which must not wipe what's been typed.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  // The job's hours already on the day, read when the suggestion is made.
  const alreadyRef = useRef(0);
  alreadyRef.current = lineOf(model, jobId, model.workDate)?.durationSeconds ?? 0;
  useEffect(() => {
    if (!opened) return;
    setOpenedAt(Date.now());
    setError(null);
    setBusy(false);
  }, [opened]);

  // Where the day's last run ends: now, today; on an earlier day, its last note
  // — the notes say no more than that, and the person corrects the total. (A
  // "worked until" field used to ask; it confused more than it helped.)
  const endAt = isToday ? Math.max(openedAt, lastAt) : lastAt;

  // This job's runs, over the whole day's notes; only their pending part counts.
  const spans = useMemo(() => {
    const pendingIds = new Set(withUnsent.map((n) => n.id));
    const byId = new Map(dayNotes.map((n) => [n.id, n]));
    const out: { startedAt: number; endedAt: number }[] = [];
    for (const line of proposeRollup(dayNotes, endAt)) {
      if (line.jobId !== jobId) continue;
      const mine = line.noteIds.filter((id) => pendingIds.has(id));
      if (mine.length === 0) continue;
      const startedAt = mine.length === line.noteIds.length ? line.startedAt : byId.get(mine[0]!)!.at;
      if (line.endedAt > startedAt) out.push({ startedAt, endedAt: line.endedAt });
    }
    return out;
  }, [dayNotes, withUnsent, jobId, endAt]);
  const suggested = spans.reduce((sum, s) => sum + Math.round((s.endedAt - s.startedAt) / 1000), 0);

  // The notes' own seconds are noise here — nobody means "2:07:43".
  const duration = draft?.duration ?? formatDurationInput(Math.round(suggested / 60) * 60 + alreadyRef.current);
  const note = draft?.note ?? joinNotes(withUnsent.map((n) => n.text));
  /** Close, forgetting what was typed: cancelled, or saved. */
  const close = () => {
    discardDraft();
    onClose();
  };

  // The job's hours already on the day, which these join.
  const line = lineOf(model, jobId, date);
  const already = line?.durationSeconds ?? 0;
  const typed = parseDuration(duration) ?? 0;
  // With a line, the field is the day's total and what's added is the difference.
  const seconds = line ? typed - already : typed;
  const locked = line != null && !isEditable(line.status);
  const lockedForGood = locked && !isOwnerReopenable(line.status, line.adminApproved);
  const problems =
    unsentWhen && !unsentWhen.ok
      ? [`The note you're still writing has a time that won't work (${unsentWhen.problem}). Fix it in the note box first.`]
      : line && seconds < 0
        ? ["That's less than the hours already there. To lower those, edit them."]
        : lockedForGood
          ? ["These hours are approved; an admin can reopen them to add more."]
          : rollupProblems([{ jobId, durationSeconds: seconds, joinsLine: line != null }]);

  async function commit() {
    setBusy(true);
    setError(null);
    const noteIds = pending.map((n) => n.id);
    if (unsentNote && box) {
      // Added first, as Add would, then turned into hours with the rest.
      const added = await box.add(openedAt || Date.now());
      if (!added) {
        setBusy(false);
        setError("The note you were writing couldn't be added, so nothing was changed. Try again.");
        return;
      }
      noteIds.push(added);
    }
    const entryId = uuidv7();
    const leaves = whereItIs(from.current);
    const result = await dispatch(
      "rollup.commit",
      {
        workDate: date,
        lines: [
          {
            entryId,
            jobId,
            durationSeconds: seconds,
            note: note.trim() || null,
            noteIds,
          },
        ],
      },
      { quiet: true },
    );
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    // The row is already on the other side of the screen; show it getting there.
    flyToEntry(line?.id ?? entryId, seconds > 0 ? formatDurationHuman(seconds) : "notes", leaves);
    close();
  }

  return (
    <Modal opened={opened} onClose={close} title={`Hours for ${jobLabel(jobName)}`} centered fullScreen={narrow}>
      <Stack gap="md">
        <Text size="sm" c="dimmed">
          From the notes, {title} ran{" "}
          {spans.length === 0
            ? "for no time at all"
            : spans
                .map((s) => `${formatClock(s.startedAt, tz)} – ${formatClock(s.endedAt, tz)}`)
                .join(" and ")}
          {spans.length > 0 ? `: ${formatDurationHuman(suggested)}` : ""}. Change it if that's not right.
        </Text>
        {line && (
          <Text size="sm">
            {title} already has {formatDurationHuman(already)} {isToday ? "today" : `on ${formatWorkDate(date)}`}; these
            notes join those hours, as one line.
            {locked && !lockedForGood ? " They're submitted, so they'll be taken back — submit the day again after." : ""}
          </Text>
        )}
        <div data-draft>
          <DurationInput
            label={line ? "Total for the day" : "Time worked"}
            value={duration}
            onChange={(v) => {
              setDraft((t) => ({ ...t, duration: v }));
            }}
          />
        </div>
        <Textarea
          label="Note"
          description="Goes with the hours, to accounting."
          value={note}
          onChange={(e) => {
            const v = e.currentTarget.value;
            setDraft((t) => ({ ...t, note: v }));
          }}
          data-draft
          maxLength={NOTE_MAX_LENGTH}
          autosize
          minRows={2}
          maxRows={6}
        />
        {unsentNote && (
          <Text size="sm" data-testid="unsent-included">
            Your note “{unsentNote.text}” wasn't added yet. It goes in with these hours.
          </Text>
        )}
        {(line || (unsentWhen && !unsentWhen.ok)) && problems.length > 0 && (
          <Text size="sm" c="red">
            {problems[0]}
          </Text>
        )}
        {error && (
          <Alert color="red" role="alert">
            {error}
          </Alert>
        )}
        {/* On a phone the main action goes on top, full width, where a thumb is. */}
        <Group justify="flex-end" gap="sm" style={narrow ? { flexDirection: "column-reverse", alignItems: "stretch" } : undefined}>
          <Button variant="default" onClick={close}>
            Cancel
          </Button>
          <Button onClick={() => void commit()} loading={busy} disabled={problems.length > 0}>
            {line && seconds === 0 ? `Attach the notes to ${title}` : `Add ${formatDurationHuman(Math.max(0, seconds))} to ${title}`}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
