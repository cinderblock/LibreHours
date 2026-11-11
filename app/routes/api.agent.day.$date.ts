import { config } from "../../src/config.server.ts";
import { WORK_DATE_PATTERN, addDays, today } from "../../src/time.ts";
import { agentJson, requireApiToken } from "../agent-auth.server.ts";
import { loadDay } from "../tracker.server.ts";
import type { Route } from "./+types/api.agent.day.$date";

/**
 * GET /api/agent/day/:date — the token's person's day: the same model the day
 * screen is drawn from (app/tracker.server.ts), cut down to what a script
 * needs to read the day and add hours to it. Today's date works too.
 */
export function loader({ request, params }: Route.LoaderArgs) {
  const { user } = requireApiToken(request);
  const date = params.date;
  // Round-tripping through addDays rejects impossible dates like 2026-02-30.
  if (!WORK_DATE_PATTERN.test(date) || addDays(date, 0) !== date) {
    return agentJson({ error: "That isn't a date. Use YYYY-MM-DD.", code: "invalid" }, { status: 400 });
  }
  if (date > today(config.timezone)) {
    return agentJson({ error: "That day hasn't happened yet.", code: "not_found" }, { status: 404 });
  }
  const day = loadDay(user.id, date);
  return agentJson({
    workDate: day.workDate,
    today: day.today,
    timezone: day.timezone,
    mode: day.mode,
    entries: day.entries,
    notes: day.notes,
    // Open jobs only, as the day screen offers them. `bookable` says which take hours.
    jobs: day.jobs,
    // A running timer, wherever its day is.
    open: day.open,
    // Ids an op named that now stand for one of these lines (their time joined it).
    aliases: day.aliases,
  });
}
