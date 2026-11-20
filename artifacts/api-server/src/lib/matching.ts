import { pool } from "@workspace/db";
import { DateTime } from "luxon";
import { logger } from "./logger";
import { openBeforeDeadline, pacificNow, ZONE } from "./food-time";
import { event, type Row, type Queryable } from "./donation-records";

// Unsourced demo estimate; do not report as audited environmental impact.
export const CO2E_KG_PER_KG_FOOD = 2.5;
export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const rad = (n: number) => n * Math.PI / 180;
  const a = Math.sin(rad(lat2 - lat1) / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(rad(lng2 - lng1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(Math.max(0, 1 - a)));
}
export const callsConfigured = () => true;

/** Callers hold the shared advisory transaction lock before reserving capacity. */
export async function matchRecipient(donation: Row, business: Row, client: Queryable = pool) {
  const deadline = donation.pickup_deadline_at ? new Date(donation.pickup_deadline_at) : pacificNow().plus({ minutes: 45 }).toJSDate();
  const day = DateTime.fromJSDate(deadline).setZone(ZONE).toISODate();
  const { rows } = await client.query(`SELECT r.*,greatest(0,r.capacity_lbs-coalesce(used.lbs,0))::float8 AS capacity_left_lbs
    FROM recipients r LEFT JOIN LATERAL (
      SELECT sum(d.estimated_pounds) AS lbs FROM donations d WHERE d.recipient_id=r.id
      AND d.id<>$2 AND d.status IN ('calling','confirmed','picked_up')
      AND (coalesce(d.pickup_deadline_at,d.created_at) AT TIME ZONE 'America/Los_Angeles')::date=$3::date
    ) used ON true WHERE $1=ANY(r.accepts)
    AND NOT EXISTS(SELECT 1 FROM call_attempts a WHERE a.donation_id=$2 AND a.recipient_id=r.id AND a.result='declined')`,
  [donation.category, donation.id, day]);
  const words = `${donation.items_description} ${donation.category}`.toLowerCase();
  const aliases: Record<string, RegExp> = {
    bread: /bread|bagel|sourdough|loaf|loaves|bakery|pastr/,
    protein: /protein|chicken|meat|tofu|bean|lentil|egg/,
    vegetables: /vegetable|produce|salad|greens|stir.fry/,
    fruit: /fruit|apple|orange|banana|produce/,
    dairy: /dairy|milk|cheese|yogurt/,
    meals: /prepared|meal|rice|pasta|soup/,
    packaged: /packaged|canned|sealed/,
  };
  const ranked = rows.map((r: Row): Row => {
    const distance_miles = distanceMiles(business.lat, business.lng, r.lat, r.lng);
    const need = (r.current_needs as string[]).find(n => {
      const normalized = n.toLowerCase().replace(/^needs?\s+/, "");
      return aliases[normalized]?.test(words) || words.includes(normalized);
    });
    const eligible = r.capacity_left_lbs >= Number(donation.estimated_pounds)
      && (!(["prepared", "dairy"].includes(donation.category)) || r.has_refrigeration)
      && openBeforeDeadline(r, deadline, 5 + distance_miles * 3);
    return { ...r, distance_miles, need, eligible,
      score: 100 - distance_miles * 6 + (need ? 24 : 0) + Math.min(8, r.capacity_left_lbs / 40) };
  }).filter(r => r.eligible).sort((a, b) => b.score - a.score || a.id - b.id);
  const recipient = ranked[0];
  const close = recipient ? DateTime.fromFormat(recipient.open_until.slice(0, 5), "HH:mm").toFormat("h:mma").toLowerCase() : "";
  const reason = recipient
    ? `${recipient.distance_miles.toFixed(1)} mi · open till ${close}${recipient.need ? ` · needs ${recipient.need.replace(/^needs?\s+/i, "")}` : ""} · ${Math.round(recipient.capacity_left_lbs)} lb capacity left${["prepared", "dairy"].includes(donation.category) ? " · refrigerated" : ""}`
    : "No eligible recipient before this deadline with the required category, capacity and refrigeration. All recipients that declined are excluded.";
  await client.query(`UPDATE donations SET recipient_id=$1,status=$2,match_reason=$3,distance_miles=$4,
    matched_at=CASE WHEN $1::integer IS NOT NULL THEN now() ELSE matched_at END,updated_at=now() WHERE id=$5`,
  [recipient?.id ?? null, recipient ? "calling" : "no_match", reason, recipient?.distance_miles ?? null, donation.id]);
  if (recipient) {
    if (donation.recipient_id && donation.recipient_id !== recipient.id)
      await event(client, donation.id, "rerouted", `Rerouted to ${recipient.name}`, recipient.id);
    await event(client, donation.id, "matched", reason, recipient.id);
    await event(client, donation.id, "calling", `Browser volunteer line notified: ${recipient.name}`, recipient.id);
  } else await event(client, donation.id, "no_match", reason);
  if (recipient) recipient.match_reason = reason;
  return recipient as Row | undefined;
}

export async function triggerPantryCall(donation: Row, recipient: Row, business: Row) {
  logger.info({ donation_id: donation.id, recipient_id: recipient.id, business_id: business.id }, "browser calling mode");
}
export function queueCall(donation: Row, recipient: Row | undefined, business: Row) {
  if (recipient) setImmediate(() => void triggerPantryCall(donation, recipient, business).catch(() => logger.error("Failed to record browser call")));
}
