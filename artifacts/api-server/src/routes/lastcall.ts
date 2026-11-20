import { Router, type IRouter, type RequestHandler } from "express";
import { timingSafeEqual } from "node:crypto";
import { pool } from "@workspace/db";
import { LogSurplusBody, ConfirmPickupBody, DeclinePantryDonationBody, GetStatsResponse, GetDonationsResponse, GetNetworkResponse, GetBusinessesResponse } from "@workspace/api-zod";
import { callsConfigured, CO2E_KG_PER_KG_FOOD, matchRecipient, queueCall } from "../lib/matching";
import { normalizeWebhookInput, webhookValidationError } from "../lib/webhook-input";
import { updatePickup } from "../lib/pickups";
import { createDonation } from "../lib/donation-intake";
import { InputError, pacificNow } from "../lib/food-time";
import { donationSelect, serializeDonation, event } from "../lib/donation-records";

const router: IRouter = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
const webhookAuth: RequestHandler = (req, res, next) => {
  const expected = process.env.WEBHOOK_SECRET;
  const supplied = req.get("x-api-key");
  if (!expected || !supplied || Buffer.byteLength(expected) !== Buffer.byteLength(supplied) ||
      !timingSafeEqual(Buffer.from(expected), Buffer.from(supplied))) {
    res.status(401).json({ error: "Unauthorized" }); return;
  }
  next();
};

router.get("/stats", async (_req, res): Promise<void> => {
  const { rows: [row] } = await pool.query(`SELECT coalesce(sum(estimated_pounds) FILTER(WHERE status IN ('confirmed','picked_up')),0)::float8 AS pounds_saved,count(*)::int AS donations_count FROM donations`);
  res.json(GetStatsResponse.parse({ ...row, meals: row.pounds_saved / 1.2, co2e_kg: row.pounds_saved * 0.4536 * CO2E_KG_PER_KG_FOOD }));
});

router.get("/donations", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`${donationSelect} ORDER BY d.created_at DESC,d.id DESC`);
  res.json(GetDonationsResponse.parse(rows.map(serializeDonation)));
});

router.get("/network", async (_req, res): Promise<void> => {
  const [b, r] = await Promise.all([
    pool.query("SELECT id,name,address,lat,lng FROM businesses ORDER BY id"),
    pool.query("SELECT id,name,type,address,lat,lng,accepts,open_until FROM recipients ORDER BY id"),
  ]);
  res.json(GetNetworkResponse.parse({ businesses: b.rows, recipients: r.rows, public_phone_number: null, calls_configured: callsConfigured(), calling_mode: "browser" }));
});

router.get("/businesses", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT b.id,b.name,b.address,b.lat,b.lng,
    coalesce(sum(d.estimated_pounds),0)::float8 AS monthly_pounds,count(d.id)::int AS monthly_donations
    FROM businesses b LEFT JOIN donations d ON b.id=d.business_id AND d.status IN ('confirmed','picked_up')
    AND date_trunc('month',d.created_at AT TIME ZONE 'America/Los_Angeles')=date_trunc('month',now() AT TIME ZONE 'America/Los_Angeles')
    GROUP BY b.id ORDER BY b.id`);
  const { rows: days } = await pool.query(`SELECT business_id,
    (created_at AT TIME ZONE 'America/Los_Angeles')::date::text AS day
    FROM donations WHERE status IN ('confirmed','picked_up') GROUP BY business_id,day`);
  const now = pacificNow().startOf("day");
  res.json(GetBusinessesResponse.parse(rows.map(b => {
    const dates = new Set(days.filter(d => d.business_id === b.id).map(d => d.day));
    let date = dates.has(now.toISODate()) ? now : now.minus({ days: 1 }), streak = 0;
    while (dates.has(date.toISODate())) { streak++; date = date.minus({ days: 1 }); }
    return { ...b, monthly_meals: b.monthly_pounds / 1.2,
      monthly_co2e_kg: b.monthly_pounds * 0.4536 * CO2E_KG_PER_KG_FOOD, streak_days: streak };
  })));
});

router.post("/log_surplus", webhookAuth, async (req, res): Promise<void> => {
  const parsed = LogSurplusBody.safeParse(normalizeWebhookInput(req.body, "estimated_pounds"));
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  try {
    res.json(await createDonation(parsed.data));
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    res.status(err.status).json({ error: err.message });
  }
});

router.post("/confirm_pickup", webhookAuth, async (req, res): Promise<void> => {
  const parsed = ConfirmPickupBody.safeParse(normalizeWebhookInput(req.body, "donation_id"));
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  const result = await updatePickup({ ...parsed.data, accepted: parsed.data.accepted === true });
  res.status(result.status).json(result.body);
});

router.post("/pantry/decline", async (req, res): Promise<void> => {
  const parsed = DeclinePantryDonationBody.safeParse(normalizeWebhookInput(req.body, "donation_id"));
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  const result = await updatePickup({ ...parsed.data, accepted: false });
  res.status(result.status).json(result.body);
});

router.post("/demo/reset", webhookAuth, async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Same lock as simulation; table locks also serialize active callback/log writes.
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    await client.query("LOCK TABLE donations, call_attempts, donation_events IN EXCLUSIVE MODE");
    await client.query("DELETE FROM call_attempts");
    await client.query("DELETE FROM donations");
    // Do not reset sequences: browser-session handled IDs must not hide new calls.
    await client.query("COMMIT");
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
  res.json({ ok: true });
});

router.post("/demo/simulate", async (_req, res): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize public simulations and enforce a global cooldown across instances.
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    const { rows: [recent] } = await client.query("SELECT id FROM donations WHERE is_demo AND created_at>now()-interval '5 seconds' LIMIT 1");
    if (recent) { await client.query("ROLLBACK"); res.status(429).json({ error: "A simulation is already running. Please wait a few seconds." }); return; }
    const { rows: [business] } = await client.query("SELECT * FROM businesses ORDER BY random() LIMIT 1");
    const demo = business.name === "Golden Wok"
      ? ["Vegetable fried rice & fresh stir-fry", 18, "prepared"]
      : business.name === "Telegraph Bagels" ? ["Fresh bagels & sourdough rounds", 12, "bakery"]
      : ["Sourdough loaves & assorted pastries", 24, "bakery"];
    const { rows: [donation] } = await client.query(`INSERT INTO donations(business_id,items_description,estimated_pounds,category,allergens,pickup_deadline,is_demo,pickup_deadline_at,source,items)
      VALUES($1,$2,$3,$4,$5,'Within 45 minutes',true,$6,'simulation',$7) RETURNING *`,
    [business.id, ...demo, demo[2] === "prepared" ? "soy" : "wheat", pacificNow().plus({ minutes: 45 }).toJSDate(),
      JSON.stringify([{ name: demo[0], quantity: 1, unit: "batch", est_pounds: demo[1] }])]);
    await event(client, donation.id, "logged", "Illustrative demo donation logged");
    const recipient = await matchRecipient(donation, business, client);
    await client.query("COMMIT");
    res.json({ donation_id: donation.id, recipient_name: recipient?.name ?? null, distance_miles: recipient?.distance_miles ?? null,
      match_reason: recipient?.match_reason ?? null,
      message: recipient ? "Demo donation created. Open the pantry volunteer line and go on duty to answer the browser call." : "No matching recipient before this deadline." });
    queueCall(donation, recipient, business);
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
});

export default router;
