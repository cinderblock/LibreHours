import { config } from "../../src/config.server.ts";
import { othersDay } from "../../src/reports.ts";
import { WORK_DATE_PATTERN, addDays, today } from "../../src/time.ts";
import { getAuth } from "../auth.server.ts";
import type { Route } from "./+types/api.admin.day.$date";

/**
 * GET /api/admin/day/:date — everyone else's time on one day, for the panel on
 * an admin's own day screen (app/tracker/EveryoneElse.tsx). Never kept on the
 * device: the service worker passes /api/ straight through, and the day screen
 * stores only the signed-in person's own day.
 */
export function loader({ context, params }: Route.LoaderArgs) {
  const auth = getAuth(context);
  if (!auth) return Response.json({ error: "Signed out.", code: "signed_out" }, { status: 401 });
  if (auth.user.role !== "admin") {
    return Response.json({ error: "Only admins can see everyone's time.", code: "forbidden" }, { status: 403 });
  }
  const date = params.date;
  // Round-tripping through addDays rejects impossible dates like 2026-02-30.
  if (!WORK_DATE_PATTERN.test(date) || addDays(date, 0) !== date || date > today(config.timezone)) {
    return Response.json({ error: "That isn't a day with time on it.", code: "not_found" }, { status: 404 });
  }
  const now = Date.now();
  return Response.json(
    { workDate: date, now, people: othersDay(date, auth.user.id, now) },
    { headers: { "Cache-Control": "no-store" } },
  );
}
