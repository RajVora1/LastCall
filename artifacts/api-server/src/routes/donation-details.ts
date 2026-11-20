import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { GetDonationParams, GetDonationResponse, MarkPickedUpParams, MarkPickedUpBody, MarkPickedUpResponse,
  GetRecipientsResponse, UpdateRecipientNeedsParams, UpdateRecipientNeedsBody, UpdateRecipientNeedsResponse,
  GetLeaderboardResponse } from "@workspace/api-zod";
import { donationSelect, serializeDonation, receipt, event, recipientsWithCapacity } from "../lib/donation-records";
import { webhookValidationError } from "../lib/webhook-input";

const router: IRouter = Router();
router.get("/donations/:id", async (req, res): Promise<void> => {
  const params = GetDonationParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "id must be a positive integer donation ID." }); return; }
  const { rows: [donation] } = await pool.query(`${donationSelect} WHERE d.id=$1`, [params.data.id]);
  if (!donation) { res.status(404).json({ error: "Donation not found" }); return; }
  const { rows: events } = await pool.query(`SELECT e.id,e.type,e.description,e.created_at,r.name AS recipient_name
    FROM donation_events e LEFT JOIN recipients r ON e.recipient_id=r.id WHERE e.donation_id=$1 ORDER BY e.created_at,e.id`, [donation.id]);
  // Old donations have only known recorded timestamps, explicitly described as legacy.
  if (!events.length) events.push({ id: 0, type: "logged", description: "Legacy donation recorded; earlier lifecycle timestamps were not captured.",
    created_at: donation.created_at, recipient_name: null });
  res.json(GetDonationResponse.parse({ ...serializeDonation(donation),
    events: events.map(e => ({ ...e, created_at: e.created_at.toISOString() })), receipt: receipt(donation) }));
});
router.post("/donations/:id/picked-up", async (req, res): Promise<void> => {
  const params = MarkPickedUpParams.safeParse(req.params), parsed = MarkPickedUpBody.safeParse(req.body);
  if (!params.success || !parsed.success) { res.status(400).json({ error: "id and recipient_id must be valid positive integer IDs." }); return; }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(817235)");
    const { rows: [d] } = await client.query("SELECT * FROM donations WHERE id=$1 FOR UPDATE", [params.data.id]);
    if (!d) { await client.query("ROLLBACK"); res.status(404).json({ error: "Donation not found" }); return; }
    if (parsed.data.recipient_id && parsed.data.recipient_id !== d.recipient_id) {
      await client.query("ROLLBACK"); res.status(409).json({ error: "This donation belongs to a different recipient." }); return;
    }
    if (!["confirmed", "picked_up"].includes(d.status)) {
      await client.query("ROLLBACK"); res.status(409).json({ error: "A pickup can only be completed after it has been confirmed." }); return;
    }
    if (d.status !== "picked_up") {
      await client.query("UPDATE donations SET status='picked_up',picked_up_at=now(),updated_at=now() WHERE id=$1", [d.id]);
      await event(client, d.id, "picked_up", "Volunteer marked the food picked up", d.recipient_id);
    }
    await client.query("COMMIT");
    res.json(MarkPickedUpResponse.parse({ ok: true }));
  } catch (err) { await client.query("ROLLBACK"); throw err; }
  finally { client.release(); }
});
router.get("/recipients", async (_req, res): Promise<void> => {
  res.json(GetRecipientsResponse.parse(await recipientsWithCapacity()));
});
router.patch("/recipients/:id/needs", async (req, res): Promise<void> => {
  const params = UpdateRecipientNeedsParams.safeParse(req.params), parsed = UpdateRecipientNeedsBody.safeParse(req.body);
  if (!params.success) { res.status(400).json({ error: "id must be a positive integer recipient ID." }); return; }
  if (!parsed.success) { res.status(400).json(webhookValidationError(parsed.error.issues)); return; }
  const needs = [...new Set(parsed.data.current_needs.map(n => n.trim().toLowerCase()).filter(Boolean))];
  const { rowCount } = await pool.query("UPDATE recipients SET current_needs=$1,needs_initialized=true WHERE id=$2", [needs, params.data.id]);
  if (!rowCount) { res.status(404).json({ error: "Recipient not found" }); return; }
  const r = (await recipientsWithCapacity()).find(r => r.id === params.data.id);
  res.json(UpdateRecipientNeedsResponse.parse(r));
});
router.get("/leaderboard", async (_req, res): Promise<void> => {
  const { rows } = await pool.query(`SELECT b.id,b.name,coalesce(sum(d.estimated_pounds),0)::float8 AS weekly_pounds,count(d.id)::int AS weekly_donations
    FROM businesses b LEFT JOIN donations d ON d.business_id=b.id AND d.status IN ('confirmed','picked_up')
    AND d.created_at AT TIME ZONE 'America/Los_Angeles' >= date_trunc('week',now() AT TIME ZONE 'America/Los_Angeles')
    GROUP BY b.id ORDER BY weekly_pounds DESC,weekly_donations DESC,b.name ASC`);
  res.json(GetLeaderboardResponse.parse(rows));
});
export default router;
