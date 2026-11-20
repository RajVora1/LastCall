import { DateTime } from "luxon";

export const ZONE = "America/Los_Angeles";
export const pacificNow = () => DateTime.now().setZone(ZONE);
export class InputError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}

/** Voice tools use conversational times; browser intake sends an ISO instant. */
export function resolveDeadline(text: string, now = pacificNow()): Date {
  const raw = text.trim().toLowerCase();
  let deadline: DateTime | undefined;
  if (/^\d{4}-\d{2}-\d{2}[t ]/.test(raw)) {
    deadline = DateTime.fromISO(text.trim().replace(" ", "T"), { zone: ZONE });
  } else {
    const relative = raw.match(/(?:in|within)\s+(\d+)\s*(minutes?|mins?|hours?|hrs?)/);
    if (relative) deadline = now.plus({ minutes: Number(relative[1]) * (/^h/.test(relative[2]) ? 60 : 1) });
    else if (/^(asap|soon|now)$/.test(raw)) deadline = now.plus({ minutes: 30 });
    else {
      const clock = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/);
      const military = raw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      if (clock) {
        const hour = Number(clock[1]), minute = Number(clock[2] || 0);
        if (hour >= 1 && hour <= 12 && minute < 60) deadline = now.startOf("day").plus({
          days: raw.includes("tomorrow") ? 1 : 0,
          hours: hour % 12 + (clock[3] === "pm" ? 12 : 0), minutes: minute,
        });
      } else if (military) deadline = now.startOf("day").plus({
        days: raw.includes("tomorrow") ? 1 : 0, hours: Number(military[1]), minutes: Number(military[2]),
      });
    }
  }
  if (!deadline?.isValid || deadline.toMillis() <= now.toMillis())
    throw new InputError("pickup_deadline must be a future time, for example 'In 30 min', 'By 8pm', or an ISO date/time. Times are Pacific.");
  if (deadline.toMillis() > now.plus({ hours: 24 }).toMillis())
    throw new InputError("pickup_deadline must be within the next 24 hours.");
  return deadline.toJSDate();
}

export function openBeforeDeadline(recipient: Record<string, any>, deadline: Date, travelMinutes: number, now = pacificNow()) {
  const [oh, om] = recipient.open_from.split(":").map(Number);
  const [ch, cm] = recipient.open_until.split(":").map(Number);
  for (const offset of [-1, 0, 1]) {
    const start = now.startOf("day").plus({ days: offset, hours: oh, minutes: om });
    let end = now.startOf("day").plus({ days: offset, hours: ch, minutes: cm });
    if (end <= start) end = end.plus({ days: 1 });
    const earliest = Math.max(now.plus({ minutes: travelMinutes }).toMillis(), start.toMillis());
    if (earliest < end.toMillis() && earliest <= deadline.getTime()) return true;
  }
  return false;
}
